"use client";

import { useCallback, useEffect, useState } from "react";
import { History, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loadAuditLog, type AuditRow } from "@/lib/admin-ledger";
import { friendlyErrorMessage } from "@/lib/errors";

/**
 * Who did what, when.
 *
 * `admin_audit_log` is written by every admin action (approvals, rejections,
 * dispute resolutions, payout forces) and was readable by admins since migration
 * 0005 — but nothing ever rendered it. On a marketplace that holds other
 * people's money, an unrendered audit trail is the same as no audit trail: the
 * first question after a bad refund is "who approved this?", and it needs an
 * answer in seconds, not a SQL session.
 *
 * Read-only. The log is append-only in Postgres (no update/delete grants).
 */

const ACTION_LABEL: Record<string, string> = {
  approve_vendor: "Vendor approved",
  reject_vendor: "Vendor rejected",
  approve_product: "Listing made live",
  reject_product: "Listing rejected",
  resolve_dispute: "Dispute resolved",
  force_payout: "Payout forced",
  refund_order: "Order refunded",
};

function shortId(id: string | null): string {
  return id ? id.slice(0, 8) : "—";
}

export function AdminAuditPanel() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await loadAuditLog(60));
    } catch (readError) {
      setError(
        friendlyErrorMessage(readError, {
          context: "admin",
          fallback: "We couldn’t load the audit trail. Please refresh and try again.",
        })
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Every admin decision, newest first. Append-only — nothing here can be edited or deleted from the app.
        </p>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
        </Button>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading audit trail…</p>
      ) : rows.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <History className="h-4 w-4" /> No admin actions recorded yet. Approvals, rejections and dispute resolutions
          all land here.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">{ACTION_LABEL[row.action] ?? row.action}</p>
                <p className="text-[11px] text-muted-foreground">
                  {row.entityType} <span className="font-mono">{shortId(row.entityId)}</span> • by{" "}
                  <span className="font-mono">{shortId(row.adminId)}</span> •{" "}
                  {new Date(row.createdAt).toLocaleString("en-NG", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
                {row.note && <p className="mt-0.5 text-[11px] text-muted-foreground">{row.note}</p>}
              </div>
              <Badge variant="outline" className="shrink-0 font-mono text-[11px]">
                {row.action}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
