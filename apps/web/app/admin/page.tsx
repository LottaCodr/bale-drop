import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSessionProfile } from "@/lib/session";
import { isSupabaseLive } from "@/lib/config";
import { AdminConsole } from "./admin-console";
import { ServiceUnavailable } from "@/components/service-unavailable";

/** Role-gated admin console. */
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!isSupabaseLive()) return <ServiceUnavailable title="Admin workspace is unavailable" />;
  const session = await getSessionProfile();
  if (!session || session.role !== "admin") {
    return (
      <div className="container max-w-md py-16 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <ShieldCheck className="h-7 w-7" />
        </span>
        <h1 className="mt-4 text-xl font-extrabold">Restricted area</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {!session
            ? "Sign in with an admin account to continue."
            : "This account isn't an admin. Contact support if this is a mistake."}
        </p>
        <Button className="mt-5" asChild>
          <Link href={!session ? "/login?next=/admin" : "/"}>{!session ? "Sign in" : "Back home"}</Link>
        </Button>
      </div>
    );
  }
  return <AdminConsole />;
}
