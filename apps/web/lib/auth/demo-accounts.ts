/**
 * Seeded demo accounts (created by supabase/seed.sql or
 * supabase/fix-demo-logins.sql / `npm run seed:demo-users`).
 *
 * Shown as one-tap sign-in on /login while `NEXT_PUBLIC_DEMO_LOGINS` is not
 * "false". Turn it off (and delete the users) before inviting real customers.
 */
export const DEMO_PASSWORD = "BaleDrop123!";

export interface DemoAccount {
  email: string;
  role: "buyer" | "vendor" | "admin";
  label: string;
  description: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { email: "buyer1@baledrop.demo", role: "buyer", label: "Buyer", description: "Shop, join bale splits, track orders" },
  { email: "adaeze@baledrop.demo", role: "vendor", label: "Vendor", description: "Inspected Lagos shop dashboard" },
  { email: "admin@baledrop.demo", role: "admin", label: "Admin", description: "Approvals, disputes and payouts" },
];

export function demoLoginsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_LOGINS !== "false";
}
