// Core logic: dedupe a lead, log it, retry transient failures, alert on final failure.
// Kept free of HTTP and vendor details so it can be unit-tested with fakes.

import { maskEmail, maskPhone, type Lead } from "./normalize.js";
import { withRetry, type RetryOptions } from "./retry.js";
import type { Alerter } from "./slack.js";
import type { LeadStatus, LeadStore } from "./store.js";

export interface HandlerDeps {
  store: LeadStore;
  alerter: Alerter;
  now?: () => Date;
  retry?: RetryOptions;
}

export interface HandleResult {
  status: LeadStatus;
  contactId: string;
}

export async function handleLead(lead: Lead, deps: HandlerDeps): Promise<HandleResult> {
  const { store, alerter, now = () => new Date(), retry } = deps;
  const name = `${lead.firstName} ${lead.lastName}`.trim() || "(no name)";

  try {
    const duplicate = await withRetry(() => store.exists(lead.email, lead.phone), retry);
    const status: LeadStatus = duplicate ? "duplicate_skipped" : "new";

    await withRetry(
      () =>
        store.append({
          timestamp: now().toISOString(),
          contactId: lead.contactId,
          name,
          email: lead.email,
          phone: lead.phone,
          source: lead.source,
          status,
        }),
      retry,
    );

    console.log(`lead ${status}: ${maskEmail(lead.email) || maskPhone(lead.phone)} (${lead.source})`);
    return { status, contactId: lead.contactId };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await alerter.alert(
      `:rotating_light: Lead sync failed for ${name} (contact ${lead.contactId || "unknown"}) at ${now().toISOString()}: ${reason}`,
    );
    throw err;
  }
}
