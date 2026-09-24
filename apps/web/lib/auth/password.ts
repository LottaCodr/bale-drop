/**
 * Password policy — follows NIST SP 800-63B (rev. 4):
 *  - minimum 8 characters, long passphrases welcome (we accept up to 72
 *    bytes, the bcrypt limit Supabase Auth enforces);
 *  - NO composition rules (forced symbols/uppercase produce predictable
 *    passwords), NO paste blocking, NO rotation;
 *  - screen against commonly-used / compromised values (local blocklist here
 *    + the Have I Been Pwned k-anonymity check in `pwned.ts`).
 *
 * Pure functions → unit tested in lib/__tests__/auth-password.test.ts.
 */

export const PASSWORD_MIN = 8;
/** bcrypt ignores bytes beyond 72 — Supabase Auth rejects longer input. */
export const PASSWORD_MAX_BYTES = 72;

/** The most common passwords in public breach corpora (lower-cased). */
const COMMON = new Set([
  "password", "password1", "password12", "password123", "password1234", "passw0rd", "p@ssword", "p@ssw0rd",
  "12345678", "123456789", "1234567890", "12341234", "11111111", "00000000", "87654321", "88888888",
  "qwertyui", "qwerty12", "qwerty123", "qwertyuiop", "1q2w3e4r", "1qaz2wsx", "zaq12wsx", "asdfghjk",
  "iloveyou", "iloveyou1", "sunshine", "princess", "football", "baseball", "superman", "trustno1",
  "welcome1", "welcome123", "letmein1", "abc12345", "abcd1234", "admin123", "administrator",
  "monkey123", "dragon12", "master12", "starwars", "whatever", "computer", "internet", "michael1",
  "baledrop", "baledrop1", "baledrop123", "okirika1", "nigeria1", "nigeria123", "lagos123",
]);

export type PasswordStrength = 0 | 1 | 2 | 3 | 4;

export interface PasswordCheck {
  ok: boolean;
  /** First blocking problem, phrased for the user. */
  error: string | null;
  strength: PasswordStrength;
  label: "Too short" | "Weak" | "Fair" | "Good" | "Strong";
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function uniqueRatio(value: string): number {
  return new Set(value).size / Math.max(value.length, 1);
}

function isSequential(value: string): boolean {
  const lower = value.toLowerCase();
  const runs = ["abcdefghijklmnopqrstuvwxyz", "0123456789", "qwertyuiopasdfghjklzxcvbnm"];
  return runs.some((run) => run.includes(lower) || [...run].reverse().join("").includes(lower));
}

/** Estimate strength by length + variety (length dominates, per NIST). */
export function passwordStrength(password: string): PasswordStrength {
  if (password.length < PASSWORD_MIN) return 0;
  let score = 1;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes >= 3) score += 1;
  if (uniqueRatio(password) < 0.4 || isSequential(password) || COMMON.has(password.toLowerCase())) score = 1;
  return Math.min(score, 4) as PasswordStrength;
}

const LABELS: PasswordCheck["label"][] = ["Too short", "Weak", "Fair", "Good", "Strong"];

export interface PasswordContext {
  email?: string;
  name?: string;
}

export function checkPassword(password: string, context: PasswordContext = {}): PasswordCheck {
  const strength = passwordStrength(password);
  const result = (error: string | null): PasswordCheck => ({
    ok: error === null,
    error,
    strength,
    label: LABELS[strength],
  });

  if (password.length < PASSWORD_MIN) return result(`Use at least ${PASSWORD_MIN} characters.`);
  if (byteLength(password) > PASSWORD_MAX_BYTES) return result(`Keep it under ${PASSWORD_MAX_BYTES} characters.`);
  if (password.trim().length === 0) return result("A password can't be only spaces.");

  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return result("That's one of the most common passwords — pick something less guessable.");
  if (uniqueRatio(password) < 0.3 || isSequential(password)) return result("Avoid repeated or sequential characters like 11111111 or abcdefgh.");

  const emailLocal = context.email?.split("@")[0]?.toLowerCase();
  if (emailLocal && emailLocal.length >= 4 && lower.includes(emailLocal)) return result("Don't include your email address in your password.");
  const nameParts = (context.name ?? "").toLowerCase().split(/\s+/).filter((part) => part.length >= 4);
  if (nameParts.some((part) => lower.includes(part))) return result("Don't include your name in your password.");

  return result(null);
}
