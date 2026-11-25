import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { SheetsLeadStore } from "../src/sheets.js";
import { HttpError } from "../src/retry.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const account = {
  client_email: "sync@demo-project.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};

/** Fake Google endpoints that record every request. */
function fakeGoogle(rows: string[][] = [], sheetsStatus = 200) {
  const calls: { url: string; method: string; body?: string; auth?: string }[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: u, method: init?.method ?? "GET", body: init?.body?.toString(), auth: headers.Authorization });
    if (u.startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "tok_123", expires_in: 3600 }), { status: 200 });
    }
    if (sheetsStatus !== 200) return new Response("{}", { status: sheetsStatus });
    if ((init?.method ?? "GET") === "GET") return new Response(JSON.stringify({ values: rows }), { status: 200 });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return { calls, fetchFn };
}

test("signs a valid RS256 JWT and reuses the access token", async () => {
  const g = fakeGoogle();
  const store = new SheetsLeadStore("SHEET1", account, "Leads", g.fetchFn);
  await store.exists("a@b.co", "");
  await store.exists("a@b.co", "");

  const tokenCalls = g.calls.filter((c) => c.url.includes("oauth2"));
  assert.equal(tokenCalls.length, 1, "token is cached between calls");

  const assertion = new URLSearchParams(tokenCalls[0].body).get("assertion")!;
  const [h, c, sig] = assertion.split(".");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${h}.${c}`);
  assert.ok(verifier.verify(publicKey, Buffer.from(sig, "base64url")), "JWT signature verifies");
  assert.equal(JSON.parse(Buffer.from(c, "base64url").toString()).iss, account.client_email);
});

test("finds duplicates by email or phone, ignoring skipped rows", async () => {
  const rows = [
    ["2026-11-24T09:00:00Z", "c1", "Maria Lopez", "maria@example.com", "+15550142290", "Web", "new"],
    ["2026-11-24T09:05:00Z", "c2", "Maria Lopez", "x@example.com", "+15559990000", "Web", "duplicate_skipped"],
  ];
  const store = new SheetsLeadStore("SHEET1", account, "Leads", fakeGoogle(rows).fetchFn);
  assert.equal(await store.exists("maria@example.com", ""), true);
  assert.equal(await store.exists("", "+15550142290"), true);
  assert.equal(await store.exists("x@example.com", "+15559990000"), false);
});

test("appends a row with the bearer token", async () => {
  const g = fakeGoogle();
  const store = new SheetsLeadStore("SHEET1", account, "Leads", g.fetchFn);
  await store.append({
    timestamp: "t", contactId: "c1", name: "Maria Lopez", email: "maria@example.com",
    phone: "+15550142290", source: "Web", status: "new",
  });
  const append = g.calls.find((c) => c.method === "POST" && c.url.includes(":append"))!;
  assert.equal(append.auth, "Bearer tok_123");
  assert.deepEqual(JSON.parse(append.body!).values[0][6], "new");
});

test("turns Google errors into HttpError so they can be retried", async () => {
  const store = new SheetsLeadStore("SHEET1", account, "Leads", fakeGoogle([], 503).fetchFn);
  await assert.rejects(store.exists("a@b.co", ""), (err: unknown) => err instanceof HttpError && err.status === 503);
});
