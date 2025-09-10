# ⏱ Timeout & Skipped Blocks
- If a timeout occurs but the TIMEOUT_THRESHOLD is not reached yet, the bot will send Telegram alerts only.
- If a block finalizes during this period, the bot automatically sends a “Recovered” message.
<img width="349" height="289" alt="image" src="https://github.com/user-attachments/assets/1707c71b-11ea-4751-9a13-cba81fa5e800" />

---

# 🚨 Timeout Threshold Reached (PagerDuty Trigger)
- By default, if 5 consecutive timeouts occur, PagerDuty will be triggered.
- You will receive a phone call for critical incidents.
- Telegram alerts will continue during this process.
<img width="291" height="807" alt="image" src="https://github.com/user-attachments/assets/3d8f8f91-27a4-4c7b-9521-d3ca9b07b23c" />
<img width="291" height="807" alt="image" src="https://github.com/user-attachments/assets/66b8c378-aa4e-479f-991c-3e8745bcf796" />

---

# 📜 Monad Ledger-Tail Silence Detection
- If the monad-ledger-tail service stops logging or crashes:
The bot immediately sends a Telegram “Log Silence” warning.

- If the log silence continues for longer than LOG_SILENCE_PD_SEC, 
the bot triggers a PagerDuty incident → you’ll receive a phone call
- When the service resumes, a “Resumed” notification is sent to Telegram.
<img width="384" height="196" alt="image" src="https://github.com/user-attachments/assets/4a5df425-c13e-41a3-a94b-cdad16570667" />

---

# 🛑 Bot Shutdown Detection
- If the bot crashes or is manually stopped, you will immediately receive a Telegram alert.
 <img width="390" height="161" alt="image" src="https://github.com/user-attachments/assets/61633914-2123-4596-9529-86338c76663f" />

---

# 📢 Discord → Telegram Alerts (Optional)
- If the validator-announcement channel on Discord posts a new message:
  The message will first be forwarded to Telegram.
- If PD_ON_DISCORD=true is set in your .env, PagerDuty will also be triggered, and you'll get a phone call.
<img width="1325" height="317" alt="image" src="https://github.com/user-attachments/assets/2cb72d89-1d80-4322-961c-b54d0be03f6a" />
<img width="540" height="486" alt="image" src="https://github.com/user-attachments/assets/2953ef24-bf40-4cd6-9a0a-398d8efe36c4" />


