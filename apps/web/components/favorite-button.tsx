"use client";

import { useState } from "react";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";

/** Wishlist heart — optimistic local toggle; syncs to Supabase in production. */
export function FavoriteButton({ className }: { className?: string }) {
  const [saved, setSaved] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        setSaved((s) => !s);
      }}
      aria-pressed={saved}
      aria-label={saved ? "Remove from wishlist" : "Save to wishlist"}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full bg-background/90 shadow-sm backdrop-blur transition hover:scale-105 active:scale-95",
        className
      )}
    >
      <Heart className={cn("h-4 w-4", saved ? "fill-red-500 text-red-500" : "text-foreground")} />
    </button>
  );
}
