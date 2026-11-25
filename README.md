# GHL Lead Sync

A small, production-ready integration that receives **GoHighLevel** workflow webhooks and keeps a clean **lead log in Google Sheets**:

- **Duplicate checks:** a lead whose email *or* phone is already logged is recorded as `duplicate_skipped`, not as a new lead.
- **Retries:** temporary Google errors (HTTP 429/5xx, network drops) are retried 3 times with exponential backoff.
- **Error alerts:** if a lead still can't be saved, a message goes to **Slack** with the contact name and the reason.
- **Secure by default:** every request must carry a shared secret (header or `?secret=`), checked in constant time. Logs mask emails and phone numbers.
- **No vendor SDKs:** zero runtime dependencies. Google auth is a service-account JWT signed with Node's built-in crypto.

```
GoHighLevel workflow ──webhook──▶ /api/ghl-webhook (Vercel)
                                     │  verify secret
                                     │  normalize email + phone (E.164)
                                     │  duplicate?  ──yes──▶ log "duplicate_skipped"
                                     │                no ──▶ log "new"
                                     ▼
                              Google Sheets "Leads" tab
                                     │  failure after 3 retries
                                     ▼
                                Slack alert
```

## Project structure

| Path | What it does |
|---|---|
| `api/ghl-webhook.ts` | HTTP entry point (method, secret, body validation, responses) |
| `src/handler.ts` | Core logic: dedupe, log, retry, alert. No HTTP or vendor code |
| `src/normalize.ts` | Parses GHL payloads, normalizes email/phone, masks personal data |
| `src/sheets.ts` | Google Sheets store via the REST API |
| `src/retry.ts` | Exponential backoff for retryable errors |
| `src/slack.ts` | Slack alerts (falls back to logs if no webhook is set) |
| `src/store.ts` | Storage interface, so Sheets can be swapped for a database |
| `test/` | 21 unit tests (Node's built-in test runner) |
| `scripts/demo.ts` | Local walkthrough: new lead, duplicate, outage + alert |

## Quick start (local, no accounts needed)

```bash
npm install
npm test          # 21 tests
npm run demo      # new lead → duplicate skipped → outage, retries, alert
```

## Deploy

### 1. Google Sheet + service account
1. Create a Google Sheet with a tab named **Leads**.
2. In Google Cloud Console: create a project → enable the **Google Sheets API** → create a **service account** → *Keys* → *Add key* → JSON. Download the file.
3. Share the sheet with the service account's `client_email` as **Editor**.

### 2. Slack (optional but recommended)
Create an app at api.slack.com → *Incoming Webhooks* → add one to your alerts channel and copy the URL.

### 3. Vercel
1. Push this repo to GitHub and import it in Vercel.
2. Add the environment variables from `.env.example` (*Settings → Environment Variables*). Paste the whole service-account JSON on one line into `GOOGLE_SERVICE_ACCOUNT_JSON`.
3. Deploy. Your endpoint is `https://<your-project>.vercel.app/api/ghl-webhook`.
4. Write the header row once: copy `.env.example` to `.env`, fill it in, then run `npm run setup-sheet`.

### 4. GoHighLevel
1. *Automation → Workflows → Create workflow*.
2. Trigger: **Contact Created** (or **Form Submitted**).
3. Action: **Webhook** → Method `POST` → URL = your Vercel endpoint with the secret on the end:
   `https://<your-project>.vercel.app/api/ghl-webhook?secret=<WEBHOOK_SECRET>`
4. If you use GHL's **Custom Webhook** action instead (it supports headers), you can send the secret as the header `x-webhook-secret` and leave it out of the URL.
5. Publish, then create a test contact. A row appears in the sheet within seconds.

## Test it with curl

```bash
curl -X POST https://<your-project>.vercel.app/api/ghl-webhook \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -d '{"contact_id":"test1","first_name":"Maria","last_name":"Lopez","email":"maria@example.com","phone":"(555) 014-2290","contact_source":"Website form"}'
# → {"status":"new","contactId":"test1"}   (send it again → "duplicate_skipped")
```

| Response | Meaning |
|---|---|
| `200 {"status":"new"}` | Lead logged |
| `200 {"status":"duplicate_skipped"}` | Already in the log |
| `400` | Payload had no valid email or phone |
| `401` | Missing or wrong secret |
| `500` | Saving failed after retries; Slack alert sent |

## Extending

- **Different destination** (database, QuickBooks, another CRM): implement the `LeadStore` interface in `src/store.ts`. The handler doesn't change.
- **AI step:** call the Claude API inside `handleLead` before storing, for example to classify the lead or summarize notes.
- **High volume:** at thousands of rows, move the lead log from Sheets to a database (for example Supabase) for faster duplicate lookups.

## Security notes

- Secrets live only in environment variables, never in code or logs.
- Personal data in logs is masked (`m***@example.com`, `+1******2290`).
- The endpoint refuses all requests if `WEBHOOK_SECRET` is not set.
