import { test } from "node:test";
import assert from "node:assert/strict";
import { maskEmail, maskPhone, normalizeEmail, normalizePhone, parseGhlPayload, ValidationError } from "../src/normalize.js";

test("normalizeEmail lowercases, trims and rejects invalid input", () => {
  assert.equal(normalizeEmail("  Jane.Doe@Example.COM "), "jane.doe@example.com");
  assert.equal(normalizeEmail("not-an-email"), "");
  assert.equal(normalizeEmail(undefined), "");
});

test("normalizePhone produces E.164", () => {
  assert.equal(normalizePhone("(555) 014-2290"), "+15550142290");
  assert.equal(normalizePhone("1-555-014-2290"), "+15550142290");
  assert.equal(normalizePhone("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizePhone("123"), "");
  assert.equal(normalizePhone(""), "");
});

test("parseGhlPayload reads standard GHL contact fields", () => {
  const lead = parseGhlPayload({
    contact_id: "abc123",
    first_name: "Maria",
    last_name: "Lopez",
    email: "Maria@Example.com",
    phone: "(555) 014-2290",
    contact_source: "Website form",
  });
  assert.deepEqual(lead, {
    contactId: "abc123",
    firstName: "Maria",
    lastName: "Lopez",
    email: "maria@example.com",
    phone: "+15550142290",
    source: "Website form",
  });
});

test("parseGhlPayload falls back to customData", () => {
  const lead = parseGhlPayload({ customData: { email: "a@b.co", source: "Facebook ad" } });
  assert.equal(lead.email, "a@b.co");
  assert.equal(lead.source, "Facebook ad");
});

test("parseGhlPayload rejects leads with no way to contact them", () => {
  assert.throws(() => parseGhlPayload({ first_name: "No contact" }), ValidationError);
  assert.throws(() => parseGhlPayload(null), ValidationError);
});

test("masking hides personal data in logs", () => {
  assert.equal(maskEmail("jane@example.com"), "j***@example.com");
  assert.equal(maskPhone("+15550142290"), "+1******2290");
});
