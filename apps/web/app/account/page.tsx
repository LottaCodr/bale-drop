import Link from "next/link";
import { User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isSupabaseLive } from "@/lib/config";
import { getSessionProfile } from "@/lib/session";
import { formatNigerianPhone } from "@/lib/auth/validation";
import { AccountClient } from "./account-client";
import { ServiceUnavailable } from "@/components/service-unavailable";

/**
 * Account home — profile, preferences and the shortcuts a signed-in buyer
 * needs. `/account/addresses` existed on its own, so there was no place to fix
 * a misspelled name or change the delivery city.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Account",
};

export default async function AccountPage() {
  if (!isSupabaseLive()) return <ServiceUnavailable title="Account settings are unavailable" />;
  const session = await getSessionProfile();

  if (!session) {
    return (
      <div className="container max-w-md py-16 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <User className="h-7 w-7" />
        </span>
        <h1 className="mt-4 text-xl font-extrabold">Sign in to manage your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your orders, addresses and saved items live here.</p>
        <Button className="mt-5" asChild>
          <Link href="/login?next=/account">Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container max-w-3xl py-6">
      <h1 className="text-2xl font-extrabold tracking-tight">Account</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Profile, delivery preferences and the shortcuts you use most.
      </p>

      <AccountClient
        live={true}
        initial={{
          email: session.email ?? "",
          role: session.role,
          fullName: session.fullName ?? "",
          phone: formatNigerianPhone(session.phone),
          city: session.city ?? "Lagos",
        }}
      />
    </div>
  );
}
