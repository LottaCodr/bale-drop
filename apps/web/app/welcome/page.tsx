import { redirect } from "next/navigation";
import { isSupabaseLive } from "@/lib/config";
import { getSessionProfile } from "@/lib/session";
import { safeNext } from "@/lib/auth/redirect";
import { formatNigerianPhone } from "@/lib/auth/validation";
import { WelcomeClient } from "./welcome-client";

/**
 * One-time onboarding after signup / first Google sign-in: confirm name, add
 * a delivery phone + city, learn the three things that make Bale Drop safe.
 * Skippable — checkout asks again if it's ever needed.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Welcome" };

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next: rawNext } = await searchParams;
  const next = safeNext(rawNext);
  if (!isSupabaseLive()) redirect(next);

  const session = await getSessionProfile();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/welcome${rawNext ? `?next=${encodeURIComponent(next)}` : ""}`)}`);

  return (
    <WelcomeClient
      next={next}
      role={session.role}
      email={session.email ?? ""}
      initial={{
        fullName: session.fullName ?? "",
        phone: formatNigerianPhone(session.phone),
        city: session.city ?? "Lagos",
      }}
    />
  );
}
