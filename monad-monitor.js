// Focused timeout monitor (Telegram + optional PagerDuty/Discord)
// ENV (required): TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, MY_VALIDATOR_KEY
// ENV (PagerDuty, optional): PAGERDUTY_ROUTING_KEY, PAGERDUTY_EVENTS_URL
// ENV (Discord, optional): DISCORD_TOKEN, DISCORD_CHANNEL_ID or DISCORD_WEBHOOK_ID_FILTER

import dotenv from "dotenv";
dotenv.config();

import fetch from "node-fetch";
import { spawn } from "child_process";
import { Client, GatewayIntentBits, Partials } from "discord.js";

// ---------- ENV ----------
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

const PD_ROUTING_KEY = (process.env.PAGERDUTY_ROUTING_KEY || "").trim();
const PD_ENABLED = !!PD_ROUTING_KEY;
const PD_SOURCE = process.env.PD_SOURCE || "monad-testnet-validatorr";
const PD_EVENTS_URL = (process.env.PAGERDUTY_EVENTS_URL || "").trim();
if (PD_ENABLED && !PD_EVENTS_URL) process.exit(console.error("❌ ERROR: PAGERDUTY_EVENTS_URL is required when PD is enabled."));
const JOURNAL_UNIT = (process.env.JOURNAL_UNIT || "monad-ledger-tail").trim();

const TIMEOUT_THRESHOLD = Number(process.env.TIMEOUT_THRESHOLD || 5);

const LOG_SILENCE_TG_SEC = Number(process.env.LOG_SILENCE_TG_SEC || 60);
const LOG_SILENCE_PD_SEC = Number(process.env.LOG_SILENCE_PD_SEC || 300);

const CHAIN_SILENCE_SEC = Number(process.env.CHAIN_SILENCE_SEC || 0);

// Discord (optional)
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const RAW_CHANNEL_IDS = (process.env.DISCORD_CHANNEL_ID || process.env.DISCORD_CHANNEL_IDS || "").trim();
const CHANNEL_IDS = RAW_CHANNEL_IDS ? RAW_CHANNEL_IDS.split(",").map(s => s.trim()) : [];
const DISCORD_WEBHOOK_ID_FILTER = (process.env.DISCORD_WEBHOOK_ID_FILTER || "").trim() || null;

// ---------- Helpers ----------
function normalizeAddr(a) {
  if (!a) return "";
  let x = a.trim().toLowerCase();
  if (x.startsWith("0x")) x = x.slice(2);
  return x;
}
function escapeHtml(s = "") { return s.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
async function tgSend(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: false }),
    });
    return res.ok;
  } catch { return false; }
}

// PagerDuty (optional)
async function pdEnqueue(body) {
  if (!PD_ENABLED) return false;
  try {
    const res = await fetch(PD_EVENTS_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return res.ok;
  } catch { return false; }
}
async function pdTrigger(dedupKey, summary, severity = "critical", custom = {}) {
  return pdEnqueue({
    routing_key: PD_ROUTING_KEY, event_action: "trigger", dedup_key: dedupKey,
    payload: { summary, source: PD_SOURCE, severity, component: "validator", group: "monad", class: "monitor", custom_details: custom }
  });
}
async function pdResolve(dedupKey, summary = "Recovered") {
  return pdEnqueue({
    routing_key: PD_ROUTING_KEY, event_action: "resolve", dedup_key: dedupKey,
    payload: { summary, source: PD_SOURCE, severity: "info", component: "validator", group: "monad", class: "monitor" }
  });
}

// ---------- UI ----------
const ui = {
  started: (tgSec, pdSec, thr, chainSec) =>
    `🟢 <b>Monitor Online</b>\n` +
    `• Watching: <code>timeout</code>\n` +
    `• Silence → TG: <b>${tgSec}s</b>, PD: <b>${pdSec}s</b>\n` +
    (chainSec > 0 ? `• Chain silence: <b>${chainSec}s</b>\n` : ``) +
    `• Timeout threshold: <b>${thr}</b>\n` +
    `• Started: <i>${new Date().toLocaleString()}</i>`,

  timeout: (count, thr, round, author) =>
    `⛔ Timeout detected (#${count}/${thr})\n` +
    `• Round: ${round}\n` +
    `• Validator: ${escapeHtml((author || '').slice(0, 24))}...\n` +
    `• When: ${new Date().toLocaleString()}`,

  timeoutRecovered: (round, had) =>
    `✅ <b>Recovered</b>\n` +
    `• Finalized observed on round <b>${round}</b>\n` +
    `• Previous timeout streak: <b>${had}</b>`,

  logSilenceWarn: (sec) =>
    `🚨 <b>No ledger-tail logs</b>\n` +
    `• Silent for <b>${sec}s</b>\n` +
    `• Check: <code>${escapeHtml(JOURNAL_UNIT)}</code> service`,

  logSilenceResolved: () => `🟩 <b>Logs resumed</b>\n• ledger-tail activity detected again`,

  chainSilentWarn: (sec) =>
    `🕒 <b>No new blocks on chain</b>\n` +
    `• ~<b>${Math.floor(sec/60) || 1} min</b> without proposed/finalized\n` +
    `• Your node is logging, but chain looks quiet`,

  chainSilentResolved: () =>
    `🟩 <b>Chain activity resumed</b>\n` +
    `• New proposed/finalized observed`,

  crash: (code) => `🔴 <b>Monitoring stopped</b>\n• journalctl exited with code <b>${code}</b>`,
};

// ---------- Monitor ----------
const MY_VALIDATOR_KEY = (process.env.MY_VALIDATOR_KEY || "").trim();
if (!MY_VALIDATOR_KEY) {
  console.error("❌ ERROR: MY_VALIDATOR_KEY is required in .env");
  process.exit(1);
}
const MY_KEY_NORM = normalizeAddr(MY_VALIDATOR_KEY);

class TimeoutMonitor {
  constructor() {
    this.lastLogTimestamp = Date.now();
    this.debugMode = true;
    this.chunkBuffer = "";

    this.timeoutCount = 0;
    this.lastTimeoutAt = 0;
    this.lastTimeoutRound = -1;

    this.dedupeTTLms = Number(process.env.DEDUPE_TTL_MS || 120000);
    this.seen = new Map();

    this.timeoutIncidentOpen = false;
    this.timeoutDedupKey = `timeout-streak-${MY_KEY_NORM || "unknown"}`;

    this.logSilenceAlerted = false;
    this.silenceIncidentOpen = false;
    this.silenceDedupKey = `ledger-tail-silence-${PD_SOURCE}`;

    this.lastChainActivity = Date.now();
    this.chainSilenceAlerted = false;
    this.chainSilenceIncidentOpen = false;
    this.chainSilenceDedupKey = `chain-silence-${PD_SOURCE}`;
  }

  markSeen(key) {
    const now = Date.now();
    const exp = this.seen.get(key);
    if (exp && exp > now) return false;
    this.seen.set(key, now + this.dedupeTTLms);
    if (this.seen.size > 4000) {
      for (const [k, v] of this.seen) { if (v < now) this.seen.delete(k); }
    }
    return true;
  }

  async sendAlert(message) { return tgSend(message); }

  parseLogLine(line) {
    try {
      const jl = JSON.parse((line || "").trim());
      const f = jl?.fields || {};
      let kind = f?.message || null;
      let round = f?.round ?? f?.height ?? f?.round_number ?? null;
      let author = f?.author ?? f?.validator ?? "";
      let authorAddr = f?.author_address ?? f?.author_dns ?? "";
      let ts = jl.timestamp || f.timestamp || jl.__REALTIME_TIMESTAMP || "";

      const M = (jl?.MESSAGE || "").toString().trim();
      if (!kind && M.startsWith("{")) {
        try {
          const inner = JSON.parse(M); const g = inner?.fields || {};
          kind = g?.message ?? inner?.message ?? kind;
          round = round ?? g?.round ?? g?.height ?? g?.round_number ?? inner?.round;
          author = author || g?.author || g?.validator || inner?.author || "";
          authorAddr = authorAddr || g?.author_address || inner?.author_address || "";
          ts = ts || inner?.timestamp || "";
        } catch {}
      }

      if (kind !== "timeout" && kind !== "finalized_block" && kind !== "proposed_block") return null;
      const r = round != null ? Number(round) : -1;
      const authorNorm = normalizeAddr(String(author));

      if (this.debugMode && authorNorm === MY_KEY_NORM) {
        console.log("🔍 DEBUG (mine):", { msg: kind, round: r, author, authorAddr, ts });
      }

      return { type: kind, round: r, author: String(author), authorAddr: String(authorAddr), authorNorm, timestamp: ts };
    } catch { return null; }
  }

  async handleParsed(log) {
    const now = Date.now();
    this.lastLogTimestamp = now;

    if (log.type === "proposed_block" || log.type === "finalized_block") {
      this.lastChainActivity = now;

      if (this.chainSilenceIncidentOpen) {
        await pdResolve(this.chainSilenceDedupKey, "Chain activity resumed");
        this.chainSilenceIncidentOpen = false;
      }
      if (this.chainSilenceAlerted) {
        this.chainSilenceAlerted = false;
        await this.sendAlert(ui.chainSilentResolved());
      }
    }

    if (this.silenceIncidentOpen) {
      await pdResolve(this.silenceDedupKey, "log activity restored");
      this.silenceIncidentOpen = false;
      if (this.logSilenceAlerted) {
        this.logSilenceAlerted = false;
        await this.sendAlert(ui.logSilenceResolved());
      }
    }

    if (!this.markSeen(`${log.type}:${log.round}`)) return;

    if (log.type === "timeout") {
      if (log.round === this.lastTimeoutRound) return;
      this.lastTimeoutRound = log.round;

      if (log.authorNorm === MY_KEY_NORM && MY_KEY_NORM) {
        this.timeoutCount += 1; this.lastTimeoutAt = now;
        await this.sendAlert(ui.timeout(this.timeoutCount, TIMEOUT_THRESHOLD, log.round, log.author));

        if (PD_ENABLED && this.timeoutCount >= TIMEOUT_THRESHOLD && !this.timeoutIncidentOpen) {
          const summary = `Timeout streak ≥ ${TIMEOUT_THRESHOLD} for validator ${log.author.slice(0, 12)}…`;
          await pdTrigger(this.timeoutDedupKey, summary, "critical", { count: this.timeoutCount, round: log.round, validator: log.author, address: log.authorAddr || "" });
          this.timeoutIncidentOpen = true;
        }
      }
      return;
    }

    if (log.type === "finalized_block" && log.authorNorm === MY_KEY_NORM && MY_KEY_NORM) {
      if (this.timeoutCount > 0) {
        await this.sendAlert(ui.timeoutRecovered(log.round, this.timeoutCount));
        this.timeoutCount = 0;
      }
      if (PD_ENABLED && this.timeoutIncidentOpen) {
        await pdResolve(this.timeoutDedupKey, "Timeout streak recovered (finalized observed).");
        this.timeoutIncidentOpen = false;
      }
    }
  }

  startSilenceWatchdog() {
    setInterval(async () => {
      const now = Date.now();
      const deltaSecNode = Math.floor((now - this.lastLogTimestamp) / 1000);

      if (deltaSecNode > LOG_SILENCE_TG_SEC && !this.logSilenceAlerted) {
        this.logSilenceAlerted = true;
        await this.sendAlert(ui.logSilenceWarn(deltaSecNode));
      }
      if (
        PD_ENABLED &&
        deltaSecNode > LOG_SILENCE_PD_SEC &&
        !this.silenceIncidentOpen
      ) {
        await pdTrigger(
          this.silenceDedupKey,
          `No logs from ${JOURNAL_UNIT} for ${deltaSecNode}s`,
          "critical",
          { silence_seconds: deltaSecNode }
        );
        this.silenceIncidentOpen = true;
      }

      if (CHAIN_SILENCE_SEC > 0 && deltaSecNode <= LOG_SILENCE_TG_SEC) {
        const deltaSecChain = Math.floor((now - this.lastChainActivity) / 1000);
        if (deltaSecChain >= CHAIN_SILENCE_SEC && !this.chainSilenceAlerted) {
          this.chainSilenceAlerted = true;
          await this.sendAlert(ui.chainSilentWarn(deltaSecChain));
          if (PD_ENABLED && !this.chainSilenceIncidentOpen) {
            await pdTrigger(this.chainSilenceDedupKey, `Chain has no new blocks for ~${Math.floor(deltaSecChain/60) || 1} min`, "warning", { silence_seconds: deltaSecChain });
            this.chainSilenceIncidentOpen = true;
          }
        }
      }
    }, 30_000).unref?.();
  }

  async start() {
    console.log("🚀 Timeout Monitor starting…");
    console.log(`🔑 Validator: ${MY_VALIDATOR_KEY ? MY_VALIDATOR_KEY.substring(0,20)+"…" : "(not set)"}`);
    console.log(`☎️ PD: ${PD_ENABLED ? "ENABLED" : "DISABLED"} | Timeout threshold: ${TIMEOUT_THRESHOLD}`);
    console.log(`🔭 unit: ${JOURNAL_UNIT} | silence TG: ${LOG_SILENCE_TG_SEC}s, PD: ${LOG_SILENCE_PD_SEC}s | chain silence: ${CHAIN_SILENCE_SEC || 0}s`);

    await this.sendAlert(ui.started(LOG_SILENCE_TG_SEC, LOG_SILENCE_PD_SEC, TIMEOUT_THRESHOLD, CHAIN_SILENCE_SEC));

    let jc;
    try {
      jc = spawn("journalctl", ["-u", JOURNAL_UNIT, "--no-pager", "-o", "json", "--since", "now", "--follow"], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      await this.sendAlert(`❌ <b>FAILED TO START</b>\nCannot start journalctl: ${escapeHtml(e.message)}`);
      return;
    }

    const onData = (data) => {
      this.lastLogTimestamp = Date.now();
      this.chunkBuffer += data.toString();
      const lines = this.chunkBuffer.split("\n");
      this.chunkBuffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const parsed = this.parseLogLine(line);
        if (parsed) this.handleParsed(parsed).catch(err => console.error("handleParsed:", err?.message));
      }
    };

    jc.stdout.on("data", onData);
    jc.stderr.on("data", d => console.error("journalctl error:", d.toString()));
    jc.on("close", async code => {
      console.log(`journalctl exited with ${code}`);
      await this.sendAlert(ui.crash(code));
    });

    this.startSilenceWatchdog();

    process.on("SIGINT", async () => {
      await this.sendAlert(`🔴 <b>MONITOR STOPPED</b>\nCrash monitoring ended`);
      process.exit(0);
    });
  }
}

// ---------- Optional: Discord → Telegram + PagerDuty forward ----------
class DiscordBridge {
  constructor() {
    this.enabled = Boolean(DISCORD_TOKEN && CHANNEL_IDS.length && TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);
    if (!this.enabled) return;
    this.client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent], partials: [Partials.Channel, Partials.Message] });
  }
  async start() {
    if (!this.enabled) return;
    this.client.on("ready", () => console.log(`✅ Discord bridge as ${this.client.user.tag}. Channels: ${CHANNEL_IDS.join(",")}`));
    this.client.on("messageCreate", async (msg) => {
      try {
        if (!CHANNEL_IDS.includes(msg.channelId)) return;
        if (DISCORD_WEBHOOK_ID_FILTER && msg.webhookId !== DISCORD_WEBHOOK_ID_FILTER) return;
        if (msg.author && msg.author.id === this.client.user.id) return;
        const guild = msg.guild?.name || "Discord";
        const chan = msg.channel && "name" in msg.channel ? msg.channel.name : "#channel";
        const jump = `https://discord.com/channels/${msg.guildId}/${msg.channelId}/${msg.id}`;
        const content = msg.content ? escapeHtml(msg.content) : "";

        await tgSend(`📣 <b>${escapeHtml(guild)} #${escapeHtml(chan)}</b>\n${content}\n\n🔗 <a href="${jump}">View on Discord</a>`);

        if (process.env.PD_ON_DISCORD === "true" && PD_ENABLED) {
          await pdTrigger(
            `discord-msg-${msg.id}`,
            `New Discord message in ${guild} #${chan}`,
            "info",
            {
              channel: chan,
              content: msg.content || "(no content)",
              jump_url: jump
            }
          );
        }
      } catch (e) { console.error("discord forward:", e); }
    });
    await this.client.login(DISCORD_TOKEN);
  }
}

// ---------- Boot ----------
const monitor = new TimeoutMonitor();
monitor.start().catch(console.error);

const bridge = new DiscordBridge();
bridge.start?.().catch?.(console.error);
