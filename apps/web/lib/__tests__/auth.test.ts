import { describe, expect, it } from "vitest";
import { landingFor, needsOnboarding, postAuthPath, safeNext } from "../auth/redirect";
import { checkPassword, passwordStrength } from "../auth/password";
import { authErrorKind, friendlyAuthError, messageForErrorParam } from "../auth/errors";
import { formatNigerianPhone, isValidEmail, normalizeEmail, normalizeNigerianPhone } from "../auth/validation";
import { parseRangeResponse } from "../auth/pwned";

describe("safeNext (open-redirect guard)", () => {
  it("keeps same-origin paths with query strings", () => {
    expect(safeNext("/orders")).toBe("/orders");
    expect(safeNext("/checkout?product=p1&qty=2")).toBe("/checkout?product=p1&qty=2");
    expect(safeNext("%2Forders")).toBe("/orders");
  });

  it("rejects external, protocol-relative and backslash targets", () => {
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "evil.com", "", null, undefined, "/ok\u0000"]) {
      expect(safeNext(bad as string)).toBe("/");
    }
  });

  it("never bounces back to an auth page", () => {
    expect(safeNext("/login")).toBe("/");
    expect(safeNext("/signup?next=/x")).toBe("/");
    expect(safeNext("/auth/callback?code=1")).toBe("/");
  });
});

describe("post-auth routing", () => {
  it("sends each role home unless they were heading somewhere", () => {
    expect(landingFor("admin", null)).toBe("/admin");
    expect(landingFor("vendor", "/")).toBe("/vendor");
    expect(landingFor("buyer", null)).toBe("/");
    expect(landingFor("admin", "/orders")).toBe("/orders");
    expect(landingFor("buyer", "https://evil.com")).toBe("/");
  });

  it("shows /welcome once, only when essentials are missing", () => {
    expect(needsOnboarding({ phone: null, city: null })).toBe(true);
    expect(needsOnboarding({ phone: "+2348031234567", city: "Lagos" })).toBe(false);
    expect(needsOnboarding({ onboarded: true, phone: null })).toBe(false);
    expect(postAuthPath("buyer", "/", {})).toBe("/welcome");
    expect(postAuthPath("buyer", "/orders", {})).toBe("/welcome?next=%2Forders");
    expect(postAuthPath("admin", null, { onboarded: true })).toBe("/admin");
  });
});

describe("password policy (NIST 800-63B)", () => {
  it("requires 8+ characters but no composition rules", () => {
    expect(checkPassword("short").ok).toBe(false);
    expect(checkPassword("correct horse battery").ok).toBe(true);
    expect(checkPassword("bale market friday").ok).toBe(true);
  });

  it("blocks common, repetitive and sequential passwords", () => {
    expect(checkPassword("password123").ok).toBe(false);
    expect(checkPassword("BaleDrop123").ok).toBe(false);
    expect(checkPassword("aaaaaaaaaa").ok).toBe(false);
    expect(checkPassword("abcdefghij").ok).toBe(false);
    expect(checkPassword("12345678").ok).toBe(false);
  });

  it("blocks passwords containing the email or name", () => {
    expect(checkPassword("chiamaka2026!", { email: "chiamaka@example.com" }).ok).toBe(false);
    expect(checkPassword("adaeze-rocks-2026", { name: "Adaeze Okafor" }).ok).toBe(false);
  });

  it("rejects input beyond bcrypt's 72-byte limit", () => {
    expect(checkPassword("a1-".repeat(30)).ok).toBe(false);
  });

  it("scores length highest", () => {
    expect(passwordStrength("abc")).toBe(0);
    expect(passwordStrength("k7#pQ2!x")).toBeGreaterThanOrEqual(2);
    expect(passwordStrength("yellow-bale-market-2026")).toBe(4);
  });
});

describe("friendly auth errors", () => {
  it("maps Supabase codes and legacy messages", () => {
    expect(authErrorKind({ code: "invalid_credentials" })).toBe("invalid_credentials");
    expect(authErrorKind({ message: "Invalid login credentials" })).toBe("invalid_credentials");
    expect(authErrorKind({ message: "Email not confirmed" })).toBe("email_not_confirmed");
    expect(authErrorKind({ message: "User already registered" })).toBe("user_already_exists");
    expect(authErrorKind({ code: "over_email_send_rate_limit" })).toBe("email_rate_limited");
    expect(authErrorKind({ status: 429 })).toBe("rate_limited");
    expect(authErrorKind({ name: "AuthRetryableFetchError", message: "Failed to fetch" })).toBe("network");
    expect(authErrorKind({ message: "Unsupported provider: provider is not enabled" })).toBe("provider_disabled");
  });

  it("never leaks raw server text", () => {
    expect(friendlyAuthError({ message: "pq: relation does not exist" }).message).toBe("Something went wrong. Please try again.");
    expect(messageForErrorParam("link_invalid")).toMatch(/expired/);
    expect(messageForErrorParam("<script>")).toMatch(/expired/);
    expect(messageForErrorParam(null)).toBeNull();
  });
});

describe("field validation", () => {
  it("validates and normalises email", () => {
    expect(isValidEmail(" Buyer1@BaleDrop.demo ")).toBe(true);
    expect(isValidEmail("nope@x")).toBe(false);
    expect(normalizeEmail(" Buyer1@BaleDrop.demo ")).toBe("buyer1@baledrop.demo");
  });

  it("normalises Nigerian mobile numbers to E.164", () => {
    expect(normalizeNigerianPhone("0803 123 4567")).toBe("+2348031234567");
    expect(normalizeNigerianPhone("+234 803 123 4567")).toBe("+2348031234567");
    expect(normalizeNigerianPhone("8031234567")).toBe("+2348031234567");
    expect(normalizeNigerianPhone("0123")).toBeNull();
    expect(normalizeNigerianPhone("01 234 5678")).toBeNull();
    expect(formatNigerianPhone("+2348031234567")).toBe("+234 803 123 4567");
    expect(formatNigerianPhone(null)).toBe("");
  });
});

describe("HIBP range parsing", () => {
  it("finds the suffix count", () => {
    const body = "0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\n";
    expect(parseRangeResponse(body, "1e4c9b93f3f0682250b6cf8331b7ee68fd8")).toBe(3861493);
    expect(parseRangeResponse(body, "FFFF")).toBe(0);
  });
});
