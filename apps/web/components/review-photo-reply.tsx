"use client";

import { useState } from "react";
import { ImagePlus, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabaseBrowser } from "@/lib/supabase";
import { isSupabaseLive } from "@/lib/config";

export function ReviewPhotoUpload({ reviewId }: { reviewId: string }) {
  const [uploading, setUploading] = useState(false);
  const [photoPath, setPhotoPath] = useState<string | null>(null);

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !isSupabaseLive()) return;
    setUploading(true);
    try {
      const sb = supabaseBrowser();
      const { data: userData } = await sb.auth.getUser();
      if (!userData?.user) return;
      const path = `review-photos/${userData.user.id}/${reviewId}/${file.name}`;
      const { error } = await sb.storage.from("review-photos").upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (!error) {
        await sb.from("review_photos").insert({ review_id: reviewId, storage_path: path });
        setPhotoPath(path);
      }
    } catch {
      /* best effort */
    } finally {
      setUploading(false);
    }
  }

  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-semibold hover:bg-muted">
      <input type="file" accept="image/*" onChange={handleUpload} className="hidden" disabled={uploading} />
      <ImagePlus className="h-3.5 w-3.5" />
      {uploading ? "Uploading…" : photoPath ? "Photo added" : "Add photo"}
    </label>
  );
}

export function VendorReplyInput({ reviewId }: { reviewId: string }) {
  const [body, setBody] = useState("");

  async function handleReply() {
    if (!body.trim() || !isSupabaseLive()) return;
    try {
      const sb = supabaseBrowser();
      const { data: userData } = await sb.auth.getUser();
      if (!userData?.user) return;
      const { data: vendorRow } = await sb.from("vendor_profiles").select("id").eq("profile_id", userData.user.id).single();
      if (!vendorRow) return;
      await sb.from("review_replies").insert({ review_id: reviewId, vendor_id: vendorRow.id, body: body.trim() });
      setBody("");
    } catch {
      /* best effort */
    }
  }

  return (
    <div className="mt-3 flex gap-2">
      <input
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Reply as vendor…"
        className="flex-1 rounded-lg border px-3 py-2 text-sm"
      />
      <Button size="sm" onClick={handleReply} disabled={!body.trim()} className="gap-1.5">
        <MessageSquare className="h-3.5 w-3.5" /> Reply
      </Button>
    </div>
  );
}
