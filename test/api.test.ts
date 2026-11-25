import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import handler from "../api/ghl-webhook.js";

function call(method: string, headers: Record<string, string>, body?: unknown, url = "/api/ghl-webhook") {
  const req = { method, headers, body, url } as unknown as IncomingMessage & { body?: unknown };
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    payload: "",
    setHeader(k: string, v: string) { this.headers[k] = v; },
    end(chunk: string) { this.payload = chunk; },
  };
  return handler(req, res as unknown as ServerResponse).then(() => ({ status: res.statusCode, body: JSON.parse(res.payload) }));
}

process.env.WEBHOOK_SECRET = "test-secret";

test("rejects non-POST requests", async () => {
  assert.equal((await call("GET", {})).status, 405);
});

test("rejects a missing or wrong secret", async () => {
  assert.equal((await call("POST", {}, { email: "a@b.co" })).status, 401);
  assert.equal((await call("POST", { "x-webhook-secret": "nope" }, { email: "a@b.co" })).status, 401);
});

test("rejects a lead with no email or phone", async () => {
  const r = await call("POST", { "x-webhook-secret": "test-secret" }, { first_name: "X" });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /no valid email or phone/);
});

test("accepts the secret as a ?secret= query parameter (GHL standard Webhook action)", async () => {
  const r = await call("POST", {}, { first_name: "X" }, "/api/ghl-webhook?secret=test-secret");
  assert.equal(r.status, 400); // got past auth, then rejected for missing email/phone
  const wrong = await call("POST", {}, { first_name: "X" }, "/api/ghl-webhook?secret=nope");
  assert.equal(wrong.status, 401);
});
