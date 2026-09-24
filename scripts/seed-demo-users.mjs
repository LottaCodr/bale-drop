#!/usr/bin/env node
/**
 * Create or repair the demo login accounts through the Supabase Admin API —
 * the officially supported way to create auth users (no hand-written rows in
 * the `auth` schema, so it keeps working across Supabase Auth upgrades).
 *
 *   SUPABASE_URL=https://xyz.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   npm run seed:demo-users
 *
 * Idempotent: existing users get their password reset to BaleDrop123!, their
 * email confirmed and their profile role corrected. DEV/DEMO projects only.
 * The service-role key bypasses RLS — never commit it or ship it to a browser.
 */
import { createClient } from "@supabase/supabase-js";

const PASSWORD = "BaleDrop123!";
const USERS = [
  ["10000000-0000-0000-0000-000000000001", "adaeze@baledrop.demo", "vendor", "Adaeze T.", "Lagos"],
  ["10000000-0000-0000-0000-000000000002", "kano@baledrop.demo", "vendor", "Kano B.", "Kano"],
  ["10000000-0000-0000-0000-000000000003", "ph@baledrop.demo", "vendor", "PH H.", "Port Harcourt"],
  ["10000000-0000-0000-0000-000000000004", "abuja@baledrop.demo", "vendor", "Grade A.", "Abuja"],
  ["10000000-0000-0000-0000-000000000005", "yaba@baledrop.demo", "vendor", "Yaba V.", "Lagos"],
  ["90000000-0000-0000-0000-000000000001", "admin@baledrop.demo", "admin", "Bale Drop Admin", "Lagos"],
  ["20000000-0000-0000-0000-000000000001", "buyer1@baledrop.demo", "buyer", "Chiamaka O.", "Lagos"],
  ["20000000-0000-0000-0000-000000000002", "buyer2@baledrop.demo", "buyer", "Obi E.", "Abuja"],
  ["20000000-0000-0000-0000-000000000003", "buyer3@baledrop.demo", "buyer", "Emeka A.", "Port Harcourt"],
  ["20000000-0000-0000-0000-000000000004", "buyer4@baledrop.demo", "buyer", "Fatima S.", "Kano"],
  ["20000000-0000-0000-0000-000000000005", "buyer5@baledrop.demo", "buyer", "Ibrahim M.", "Kano"],
  ["20000000-0000-0000-0000-000000000006", "buyer6@baledrop.demo", "buyer", "Damilola A.", "Lagos"],
  ["20000000-0000-0000-0000-000000000007", "buyer7@baledrop.demo", "buyer", "Tunde B.", "Abuja"],
  ["20000000-0000-0000-0000-000000000008", "buyer8@baledrop.demo", "buyer", "Segun K.", "Lagos"],
  ["20000000-0000-0000-0000-000000000009", "buyer9@baledrop.demo", "buyer", "Ngozi U.", "Port Harcourt"],
];

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Project Settings → API).");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findByEmail(email) {
  for (let page = 1; page < 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 200) return null;
  }
  return null;
}

let failures = 0;
for (const [id, email, role, fullName, city] of USERS) {
  const metadata = { full_name: fullName, city, role: role === "vendor" ? "vendor" : "buyer", onboarded: true };
  try {
    const existing = await findByEmail(email);
    let userId = existing?.id;
    if (existing) {
      const { error } = await admin.auth.admin.updateUserById(existing.id, {
        password: PASSWORD,
        email_confirm: true,
        ban_duration: "none",
        user_metadata: { ...existing.user_metadata, ...metadata },
      });
      if (error) throw error;
      if (existing.id !== id) console.warn(`  ! ${email} exists with id ${existing.id} (seed data expects ${id}); linked shop/orders may be missing.`);
    } else {
      const { data, error } = await admin.auth.admin.createUser({ id, email, password: PASSWORD, email_confirm: true, user_metadata: metadata });
      if (error) throw error;
      userId = data.user.id;
    }
    const { error: profileError } = await admin
      .from("profiles")
      .upsert({ id: userId, role, full_name: fullName, city }, { onConflict: "id" });
    if (profileError) throw profileError;
    console.log(`  ✓ ${email.padEnd(24)} ${role}${existing ? " (repaired)" : " (created)"}`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${email}: ${error.message ?? error}`);
  }
}

console.log(failures ? `\n${failures} account(s) failed.` : `\nAll demo accounts ready — password: ${PASSWORD}`);
process.exit(failures ? 1 : 0);
