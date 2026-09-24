"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { track } from "@/lib/analytics";

/**
 * Route error boundary. A marketplace must never show a blank screen: the buyer
 * gets a reason, a retry and two ways out, and payment errors explicitly warn
 * against paying twice.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    track("support_open", { source: "error_boundary", digest: error.digest ?? null });
  }, [error.digest]);

  return (
    <div className="container max-w-lg py-16 text-center">
      <Card className="p-8">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="h-7 w-7" />
        </span>
        <h1 className="mt-4 text-xl font-extrabold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error.message || "We could not load this screen. Your cart is safe — it is stored on your device."}
        </p>
        <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
          <Button onClick={reset}>
            <RefreshCw /> Try again
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">Back to home</Link>
          </Button>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          If you were paying and are unsure whether it went through, check{" "}
          <Link href="/orders" className="font-semibold text-primary hover:underline">
            your orders
          </Link>{" "}
          before paying again — escrow never charges twice.
        </p>
      </Card>
    </div>
  );
}
