"use client";

import { useState } from "react";
import { BookmarkPlus } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase";
import { isSupabaseLive } from "@/lib/config";
import { Button } from "@/components/ui/button";

export function SaveSearchButton({ queryJson }: { queryJson: Record<string, unknown> }) {
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    if (!isSupabaseLive()) return;
    try {
      const sb = supabaseBrowser();
      const { data: userData } = await sb.auth.getUser();
      if (!userData?.user) return;
      await sb.from("saved_searches").insert({
        profile_id: userData.user.id,
        name: JSON.stringify(queryJson).slice(0, 60) || "Saved search",
        query_json: queryJson,
        active: true,
      });
      setSaved(true);
    } catch {
      /* best effort */
    }
  }

  return (
    <Button
      variant={saved ? "default" : "outline"}
      size="sm"
      onClick={handleSave}
      disabled={saved}
      className="h-9 gap-1.5 text-[13px]"
    >
      <BookmarkPlus className="h-3.5 w-3.5" />
      {saved ? "Saved" : "Save search"}
    </Button>
  );
}
