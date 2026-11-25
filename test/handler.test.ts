import { test } from "node:test";
import assert from "node:assert/strict";
import { isAuthorized } from "../src/auth.js";
import { handleLead } from "../src/handler.js";
import type { Lead } from "../src/normalize.js";
import { HttpError, withRetry } from "../src/retry.js";
import type { Alerter } from "../src/slack.js";
import { MemoryLeadStore } from "../src/store.js";

const noSleep = { retries: 3, baseDelayMs: 0, sleep: async () => {} };
const fixedNow = () => new Date("2026-11-24T09:00:00.000Z");

class FakeAlerter implements Alerter {
  messages: string[] = [];
  async alert(message: string) {
    this.messages.push(message);
  }
}

const maria: Lead = {
  contactId: "c1",
  firstName: "Maria",
  lastName: "Lopez",
  email: "maria@example.com",
  phone: "+15550142290",
  source: "Website form",
};

test("a new lead is logged with status 'new'", async () => {
  const store = new MemoryLeadStore();
  const result = await handleLead(maria, { store, alerter: new FakeAlerter(), now: fixedNow, retry: noSleep });
  assert.equal(result.status, "new");
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].timestamp, "2026-11-24T09:00:00.000Z");
});

test("the same email is skipped as a duplicate", async () => {
  const store = new MemoryLeadStore();
  const deps = { store, alerter: new FakeAlerter(), now: fixedNow, retry: noSleep };
  await handleLead(maria, deps);
  const again = await handleLead({ ...maria, contactId: "c2", phone: "" }, deps);
  assert.equal(again.status, "duplicate_skipped");
  assert.deepEqual(store.rows.map((r) => r.status), ["new", "duplicate_skipped"]);
});

test("the same phone with a different email is also a duplicate", async () => {
  const store = new MemoryLeadStore();
  const deps = { store, alerter: new FakeAlerter(), now: fixedNow, retry: noSleep };
  await handleLead(maria, deps);
  const again = await handleLead({ ...maria, email: "other@example.com" }, deps);
  assert.equal(again.status, "duplicate_skipped");
});

test("a transient 503 is retried and then succeeds without an alert", async () => {
  const store = new MemoryLeadStore();
  let calls = 0;
  const flaky = {
    exists: store.exists.bind(store),
    append: async (row: Parameters<MemoryLeadStore["append"]>[0]) => {
      if (++calls < 3) throw new HttpError(503, "Service unavailable");
      return store.append(row);
    },
  };
  const alerter = new FakeAlerter();
  const result = await handleLead(maria, { store: flaky, alerter, now: fixedNow, retry: noSleep });
  assert.equal(result.status, "new");
  assert.equal(calls, 3);
  assert.equal(alerter.messages.length, 0);
});

test("a permanent failure sends one alert and rethrows", async () => {
  const broken = {
    exists: async () => {
      throw new HttpError(404, "Google Sheets GET failed with HTTP 404");
    },
    append: async () => {},
  };
  const alerter = new FakeAlerter();
  await assert.rejects(handleLead(maria, { store: broken, alerter, now: fixedNow, retry: noSleep }), HttpError);
  assert.equal(alerter.messages.length, 1);
  assert.match(alerter.messages[0], /Maria Lopez/);
  assert.match(alerter.messages[0], /HTTP 404/);
});

test("withRetry gives up after the configured retries", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls++;
      throw new HttpError(429, "Rate limited");
    }, noSleep),
  );
  assert.equal(calls, 4); // 1 attempt + 3 retries
});

test("webhook secret check", () => {
  assert.equal(isAuthorized("s3cret", "s3cret"), true);
  assert.equal(isAuthorized("wrong!", "s3cret"), false);
  assert.equal(isAuthorized(undefined, "s3cret"), false);
  assert.equal(isAuthorized("s3cret", undefined), false);
});
