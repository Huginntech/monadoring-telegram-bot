## ⨀ Discord Bot Token Setup 🎧

### 🛠 Steps to Create Discord Bot

1. Go to the **[Discord Developer Portal](https://discord.com/developers/applications)**.
2. Click **New Application** → name it **Monad Monitor**.
3. Go to the **Bot** tab → **Add Bot** → confirm **"Yes, do it!"**.
4. Under **TOKEN**, click **Copy**.
Example:
```
MTAxMjM0NTY3ODkwLmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6
```
6. Put this token into your `.env` file:
```
DISCORD_TOKEN=MTAxMjM0NTY3ODkwLmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6
```
---
### 🎟️ Invite Bot to Your Server

1. Go to **OAuth2 → URL Generator**.
2. Under **Scopes**, select:
3. Under **Bot Permissions**, enable:
```
Read Messages
Send Messages
Embed Links
```
4. Copy the generated URL, open it in your browser, and invite the bot to your server.
---
<img width="450" height="497" alt="image" src="https://github.com/user-attachments/assets/b4304c4c-5b8e-421a-93ad-18bd66af9a54" />


### ⚙️ Example `.env` Configuration
```
=== Discord (optional) ===
DISCORD_TOKEN=MTAxMjM0NTY3ODkwLmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6
DISCORD_CHANNEL_ID=
