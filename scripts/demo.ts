// Local walkthrough of the three behaviours the integration guarantees:
//   1. a new lead is logged   2. a duplicate is skipped   3. a failure is retried, then alerted
// Runs entirely on your machine with an in-memory store, so no accounts are needed.
//   npm run demo

import { handleLead } from "../src/handler.js";
import { parseGhlPayload } from "../src/normalize.js";
import { HttpError } from "../src/retry.js";
import type { Alerter } from "../src/slack.js";
import { MemoryLeadStore } from "../src/store.js";

const store = new MemoryLeadStore();
const alerter: Alerter = { alert: async (m) => console.log(`  SLACK ALERT  ${m}`) };
const retry = {
  retries: 3,
  baseDelayMs: 200,
  onRetry: (n: number, e: unknown) => console.log(`  RETRY ${n}/3  ${(e as Error).message}`),
};

const webhook = {
  contact_id: "c_8f21",
  first_name: "Maria",
  last_name: "Lopez",
  email: "Maria.Lopez@Example.com",
  phone: "(555) 014-2290",
  contact_source: "Website form",
};

async function main() {
  console.log("\n1) New lead arrives from GoHighLevel");
  console.log(`  ${JSON.stringify((await handleLead(parseGhlPayload(webhook), { store, alerter, retry })))}`);

  console.log("\n2) Same person submits the form again");
  const again = parseGhlPayload({ ...webhook, contact_id: "c_9a02", email: "maria.lopez@example.com " });
  console.log(`  ${JSON.stringify(await handleLead(again, { store, alerter, retry }))}`);

  console.log("\n3) Google Sheets is down (simulated 503 on every attempt)");
  const down = {
    exists: async () => {
      throw new HttpError(503, "Google Sheets GET failed with HTTP 503");
    },
    append: async () => {},
  };
  try {
    await handleLead(parseGhlPayload({ ...webhook, contact_id: "c_1b77", first_name: "Sam", last_name: "Carter", email: "sam@example.com", phone: "5550149911" }), {
      store: down,
      alerter,
      retry,
    });
  } catch {
    console.log("  -> request answered with HTTP 500, team alerted");
  }

  console.log("\nLead log:");
  console.table(store.rows.map(({ timestamp, name, email, phone, status }) => ({ timestamp: timestamp.slice(11, 19), name, email, phone, status })));
}

main();
