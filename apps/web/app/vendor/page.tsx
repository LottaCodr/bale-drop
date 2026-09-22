import Link from "next/link";
import { ShieldCheck, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/session";
import { isSupabaseLive } from "@/lib/config";
import { VendorDashboard } from "./vendor-dashboard";

export const dynamic = "force-dynamic";

export default async function VendorPage() {
  const live = isSupabaseLive();
  if (live) {
    const session = await getSessionProfile();
    if (!session || !["vendor", "admin"].includes(session.role)) {
      return (
        <div className="container max-w-md py-16 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><Store className="h-7 w-7" /></span>
          <h1 className="mt-4 text-xl font-extrabold">Vendor dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Complete vendor verification before managing listings and orders.</p>
          <Button className="mt-5" asChild><Link href="/sell">Apply to sell</Link></Button>
        </div>
      );
    }
    return <VendorDashboard demo={false} />;
  }

  return (
    <div>
      <Card className="container mt-4 border-amber-300 bg-amber-50 p-3 text-center text-sm dark:bg-amber-950/20"><b>Demo preview</b> — connect Supabase to create real listings, fulfill orders and receive payouts.</Card>
      <VendorDashboard demo />
    </div>
  );
}
