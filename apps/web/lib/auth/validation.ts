/** Small, dependency-free field validators shared by signup/login/onboarding. */

/** Pragmatic email check (the server is the real authority). */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Nigerian mobile numbers: 0803 123 4567, +234 803 123 4567, 234803…,
 * 803 123 4567. Returns E.164 (+234XXXXXXXXXX) or null when invalid.
 */
export function normalizeNigerianPhone(value: string): string | null {
  const digits = value.replace(/[^\d]/g, "");
  let national: string;
  if (digits.startsWith("234") && digits.length === 13) national = digits.slice(3);
  else if (digits.startsWith("0") && digits.length === 11) national = digits.slice(1);
  else if (digits.length === 10 && /^[789]/.test(digits)) national = digits;
  else return null;
  if (!/^[789][01]\d{8}$/.test(national)) return null;
  return `+234${national}`;
}

/** "+2348031234567" → "+234 803 123 4567" for display. */
export function formatNigerianPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const normalized = normalizeNigerianPhone(e164);
  if (!normalized) return e164;
  const n = normalized.slice(4);
  return `+234 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
}
