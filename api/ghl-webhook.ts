// Vercel serverless function: POST /api/ghl-webhook
// Receives a GoHighLevel workflow webhook and syncs the lead to Google Sheets.

import type { IncomingMessage, ServerResponse } from "node:http";
import { isAuthorized } from "../src/auth.js";
import { handleLead } from "../src/handler.js";
import { parseGhlPayload, ValidationError } from "../src/normalize.js";
import { SheetsLeadStore } from "../src/sheets.js";
import { ConsoleAlerter, SlackAlerter } from "../src/slack.js";

type Req = IncomingMessage & { body?: unknown };

export default async function handler(req: Req, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  // GHL's standard Webhook action can't set headers, so the secret may also arrive as ?secret=...
  const querySecret = new URL(req.url ?? "/", "http://localhost").searchParams.get("secret") ?? undefined;
  if (!isAuthorized(req.headers["x-webhook-secret"] ?? querySecret, process.env.WEBHOOK_SECRET)) {
    return send(res, 401, { error: "Unauthorized" });
  }

  let lead;
  try {
    lead = parseGhlPayload(typeof req.body === "string" ? JSON.parse(req.body) : req.body);
  } catch (err) {
    const message = err instanceof ValidationError ? err.message : "Invalid JSON body";
    return send(res, 400, { error: message });
  }

  const alerter = process.env.SLACK_WEBHOOK_URL
    ? new SlackAlerter(process.env.SLACK_WEBHOOK_URL)
    : new ConsoleAlerter();

  try {
    const result = await handleLead(lead, { store: SheetsLeadStore.fromEnv(), alerter });
    return send(res, 200, result);
  } catch {
    // The alert has already been sent by handleLead; don't leak internals to the caller.
    return send(res, 500, { error: "Lead sync failed, team alerted" });
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
