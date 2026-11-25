// Lead storage. The handler depends on this interface, so the Google Sheets
// implementation can be swapped for a database (or an in-memory store in tests).

export type LeadStatus = "new" | "duplicate_skipped";

export interface LeadRow {
  timestamp: string;
  contactId: string;
  name: string;
  email: string;
  phone: string;
  source: string;
  status: LeadStatus;
}

export interface LeadStore {
  /** Returns true if a lead with this email or phone is already logged as "new". */
  exists(email: string, phone: string): Promise<boolean>;
  append(row: LeadRow): Promise<void>;
}

export class MemoryLeadStore implements LeadStore {
  rows: LeadRow[] = [];

  async exists(email: string, phone: string): Promise<boolean> {
    return this.rows.some(
      (r) => r.status === "new" && ((email && r.email === email) || (phone && r.phone === phone)),
    );
  }

  async append(row: LeadRow): Promise<void> {
    this.rows.push(row);
  }
}
