## ⨀ Telegram Bot Token Setup ✅

### 🛠 Steps to Create Telegram Bot

1. Open **Telegram** and start a chat with **[@BotFather](https://t.me/BotFather)**.
2. Send the command:
```
/newbot
 ```
Set a name for your bot (e.g. Monad Monitor Alerts).

Set a username ending with bot (e.g. monad_monitor_bot).

BotFather will provide an API Token:

```
123456789:ABC-DefGhIjKlMnOpQrStUvWxYz
```
Copy this token and add it to your .env file:

```
TELEGRAM_BOT_TOKEN=123456789:ABC-DefGhIjKlMnOpQrStUvWxYz
```
🔍 Get Telegram Chat ID
Create a Telegram group for alerts (e.g. Monad Monitor).
Add your bot to the group and make it Admin.
Send a test message in the group.
Open the following URL in your browser:

```
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates
```
In the JSON response, find something like:
```
"chat": {
  "id": -1002805856640,
  "title": "Monad Monitor"
}
```
Copy the id value and add it to your .env:
```
TELEGRAM_CHAT_ID=-1002805856640
```
⚙️ Example .env Configuration
```
# === Telegram (required) ===
TELEGRAM_BOT_TOKEN=123456789:ABC-DefGhIjKlMnOpQrStUvWxYz
TELEGRAM_CHAT_ID=-1002805856640
```










