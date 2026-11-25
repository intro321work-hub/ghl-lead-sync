// Normalization and parsing of GoHighLevel webhook payloads.

export interface Lead {
  contactId: string;
  firstName: string;
  lastName: string;
  email: string; // lowercase, trimmed ("" if missing)
  phone: string; // E.164 where possible ("" if missing)
  source: string;
}

export function normalizeEmail(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const email = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

/**
 * Normalizes a phone number to E.164.
 * - Numbers starting with "+" keep their country code.
 * - 10-digit numbers are treated as US/Canada (+1).
 * - 11-digit numbers starting with 1 are treated as US/Canada.
 * Anything else is returned as "+<digits>" if it has 8–15 digits, otherwise "".
 */
export function normalizePhone(raw: unknown, defaultCountryCode = "1"): string {
  if (typeof raw !== "string" && typeof raw !== "number") return "";
  const str = String(raw).trim();
  const digits = str.replace(/\D/g, "");
  if (!digits) return "";
  if (str.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : "";
  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : "";
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Parses the body GoHighLevel sends from a workflow "Webhook" action.
 * GHL sends standard contact fields at the top level (first_name, email, phone,
 * contact_id, contact_source, ...) and any custom keys under "customData".
 */
export function parseGhlPayload(body: unknown): Lead {
  if (!body || typeof body !== "object") throw new ValidationError("Body must be a JSON object");
  const b = body as Record<string, unknown>;
  const custom = (b.customData && typeof b.customData === "object" ? b.customData : {}) as Record<string, unknown>;

  const lead: Lead = {
    contactId: str(b.contact_id) || str(b.id) || str(custom.contact_id),
    firstName: str(b.first_name) || str(custom.first_name),
    lastName: str(b.last_name) || str(custom.last_name),
    email: normalizeEmail(b.email ?? custom.email),
    phone: normalizePhone((b.phone ?? custom.phone) as string),
    source: str(b.contact_source) || str(b.source) || str(custom.source) || "unknown",
  };

  if (!lead.email && !lead.phone) throw new ValidationError("Lead has no valid email or phone");
  return lead;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Masks personal data for logs: "jane@example.com" -> "j***@example.com", "+15550142290" -> "+1******2290". */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return user && domain ? `${user[0]}***@${domain}` : "";
}

export function maskPhone(phone: string): string {
  return phone.length > 6 ? `${phone.slice(0, 2)}${"*".repeat(phone.length - 6)}${phone.slice(-4)}` : "";
}
