"use client";

export function FeatureFlag({ flag, children }: { flag: string; children: React.ReactNode }) {
  // Best-effort: check env or just render if flag exists in a hardcoded list
  const enabledFlags = process.env.NEXT_PUBLIC_FEATURE_FLAGS?.split(",") ?? [];
  return enabledFlags.includes(flag) ? <>{children}</> : null;
}
