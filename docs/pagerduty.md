## ⨀ PagerDuty API Key Setup 🚨

### 🛠 Steps to Create PagerDuty API Key

1. Log in to your **[PagerDuty account](https://pagerduty.com/)**.
2. Go to **Integrations → API Access Keys**.
3. Click **Create New API Key**.
4. Name it **Monad Monitor**.
5. Select **v2 Events API**.
6. Copy the generated key and add it to your `.env` file:
---

### ⚙️ Example `.env` Configuration
```
=== PagerDuty (optional) ===
PAGERDUTY_ROUTING_KEY=YOUR_PD_ROUTING_KEY
PAGERDUTY_EVENTS_URL=https://events.pagerduty.com/v2/enqueue
```
