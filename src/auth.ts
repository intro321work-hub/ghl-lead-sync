// Shared-secret check for incoming webhooks, using a constant-time comparison.

import { timingSafeEqual } from "node:crypto";

export function isAuthorized(received: string | string[] | undefined, expected: string | undefined): boolean {
  if (!expected) return false; // refuse everything if the secret is not configured
  const value = Array.isArray(received) ? received[0] : received;
  if (!value) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
