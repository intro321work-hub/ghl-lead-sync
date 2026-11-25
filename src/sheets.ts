// Google Sheets lead store using the Sheets REST API and a service account.
// No SDK needed: the OAuth token is a JWT signed with Node's built-in crypto.

import { createSign } from "node:crypto";
import { HttpError } from "./retry.js";
import type { LeadRow, LeadStore } from "./store.js";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const COLUMNS = ["timestamp", "contact_id", "name", "email", "phone", "source", "status"] as const;

export class SheetsLeadStore implements LeadStore {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly sheetId: string,
    private readonly account: ServiceAccount,
    private readonly tab = "Leads",
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): SheetsLeadStore {
    const sheetId = env.SHEET_ID;
    const json = env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!sheetId || !json) throw new Error("SHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON must be set");
    const account = JSON.parse(json) as ServiceAccount;
    return new SheetsLeadStore(sheetId, account, env.SHEET_TAB || "Leads");
  }

  async exists(email: string, phone: string): Promise<boolean> {
    const data = await this.request<{ values?: string[][] }>(
      "GET",
      `/values/${encodeURIComponent(`${this.tab}!A2:G`)}`,
    );
    return (data.values ?? []).some((r) => {
      const [, , , rowEmail = "", rowPhone = "", , status = ""] = r;
      return status === "new" && ((email && rowEmail === email) || (phone && rowPhone === phone));
    });
  }

  async append(row: LeadRow): Promise<void> {
    const values = [[row.timestamp, row.contactId, row.name, row.email, row.phone, row.source, row.status]];
    await this.request(
      "POST",
      `/values/${encodeURIComponent(`${this.tab}!A:G`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { values },
    );
  }

  /** Writes the header row. Run once when setting up a new sheet. */
  async writeHeader(): Promise<void> {
    await this.request("PUT", `/values/${encodeURIComponent(`${this.tab}!A1:G1`)}?valueInputOption=RAW`, {
      values: [COLUMNS as unknown as string[]],
    });
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(`https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new HttpError(res.status, `Google Sheets ${method} failed with HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  private async accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.token && this.token.expiresAt - 60 > now) return this.token.value;

    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = base64url(
      JSON.stringify({ iss: this.account.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
    );
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${claims}`);
    const signature = base64url(signer.sign(this.account.private_key));

    const res = await this.fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${header}.${claims}.${signature}`,
      }),
    });
    if (!res.ok) throw new HttpError(res.status, `Google auth failed with HTTP ${res.status}`);
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: data.access_token, expiresAt: now + data.expires_in };
    return data.access_token;
  }
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}
