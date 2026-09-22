"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Home, Loader2, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { isSupabaseLive } from "@/lib/config";
import { supabaseBrowser } from "@/lib/supabase";

type Address = { id: string; label: string; full_address: string; city: string; phone: string; is_default: boolean; created_at?: string };
type AddressForm = Omit<Address, "id" | "created_at" | "is_default"> & { is_default: boolean };
const EMPTY: AddressForm = { label: "Home", full_address: "", city: "", phone: "", is_default: false };

export default function AddressesPage() {
  const live = isSupabaseLive();
  const [addresses, setAddresses] = useState<Address[]>(live ? [] : [{ id: "demo", label: "Home", full_address: "14 Admiralty Way, Lekki Phase 1", city: "Lagos", phone: "0803 123 4567", is_default: true }]);
  const [form, setForm] = useState<AddressForm>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(live);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!live) return;
    const sb = supabaseBrowser();
    sb.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setError("Sign in to manage delivery addresses."); setLoading(false); return; }
      const { data, error: queryError } = await sb.from("addresses").select("*").eq("profile_id", user.id).order("is_default", { ascending: false }).order("created_at", { ascending: false });
      if (queryError) setError(queryError.message); else setAddresses(data ?? []);
      setLoading(false);
    });
  }, [live]);

  function startEdit(address: Address) {
    setEditingId(address.id);
    setForm({ label: address.label, full_address: address.full_address, city: address.city, phone: address.phone, is_default: address.is_default });
    setError(null);
  }
  function resetForm() { setEditingId(null); setForm(EMPTY); }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (form.full_address.trim().length < 5 || form.city.trim().length < 2 || form.phone.replace(/\D/g, "").length < 10) { setError("Add a complete address, city and phone number."); return; }
    if (!live) {
      const id = editingId ?? `demo-${Date.now()}`;
      setAddresses((current) => [...current.filter((item) => item.id !== id).map((item) => form.is_default ? { ...item, is_default: false } : item), { ...form, id }]);
      resetForm();
      return;
    }
    setSaving(true);
    const sb = supabaseBrowser();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { setError("Sign in again to save this address."); setSaving(false); return; }
    if (form.is_default) await sb.from("addresses").update({ is_default: false }).eq("profile_id", user.id);
    const payload = { label: form.label.trim() || "Home", full_address: form.full_address.trim(), city: form.city.trim(), phone: form.phone.trim(), is_default: form.is_default || addresses.length === 0 };
    const result = editingId && editingId !== "new"
      ? await sb.from("addresses").update(payload).eq("id", editingId).eq("profile_id", user.id).select("*").single()
      : await sb.from("addresses").insert({ ...payload, profile_id: user.id }).select("*").single();
    if (result.error) setError(result.error.message);
    else {
      setAddresses((current) => {
        const next = editingId && editingId !== "new" ? current.map((item) => item.id === editingId ? result.data : item) : [...current, result.data];
        return payload.is_default ? next.map((item) => ({ ...item, is_default: item.id === result.data.id })) : next;
      });
      resetForm();
    }
    setSaving(false);
  }

  async function makeDefault(address: Address) {
    if (!live) { setAddresses((current) => current.map((item) => ({ ...item, is_default: item.id === address.id }))); return; }
    const sb = supabaseBrowser();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    await sb.from("addresses").update({ is_default: false }).eq("profile_id", user.id);
    await sb.from("addresses").update({ is_default: true }).eq("id", address.id).eq("profile_id", user.id);
    setAddresses((current) => current.map((item) => ({ ...item, is_default: item.id === address.id })));
  }

  async function remove(address: Address) {
    if (!window.confirm(`Delete ${address.label} address?`)) return;
    if (!live) { setAddresses((current) => current.filter((item) => item.id !== address.id)); return; }
    const sb = supabaseBrowser();
    const { error: deleteError } = await sb.from("addresses").delete().eq("id", address.id);
    if (deleteError) { setError(deleteError.message); return; }
    setAddresses((current) => current.filter((item) => item.id !== address.id));
  }

  return <div className="container max-w-3xl py-6"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-primary"><Link href="/orders" className="hover:underline">Account</Link> / Delivery</p><h1 className="mt-1 text-2xl font-extrabold tracking-tight">Saved delivery addresses</h1><p className="mt-1 text-sm text-muted-foreground">Save once, check out faster. Your address is only visible to you and our delivery team.</p></div>{!editingId && <Button variant="outline" onClick={() => setEditingId("new")}><Plus /> Add address</Button>}</div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
    {editingId && <Card className="mt-6 p-5"><div className="flex items-center justify-between"><h2 className="font-bold">{editingId === "new" ? "Add address" : "Edit address"}</h2><Button variant="ghost" size="sm" onClick={resetForm}>Cancel</Button></div><form className="mt-4 grid gap-3" onSubmit={save}><div className="grid gap-3 sm:grid-cols-2"><div><label htmlFor="address-label" className="mb-1.5 block text-sm font-semibold">Label</label><Input id="address-label" value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} placeholder="Home, Office…" /></div><div><label htmlFor="address-city" className="mb-1.5 block text-sm font-semibold">City</label><Input id="address-city" value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} placeholder="Abuja" /></div></div><div><label htmlFor="address-full" className="mb-1.5 block text-sm font-semibold">Full address</label><Input id="address-full" value={form.full_address} onChange={(event) => setForm((current) => ({ ...current, full_address: event.target.value }))} placeholder="Street, area, landmark" /></div><div><label htmlFor="address-phone" className="mb-1.5 block text-sm font-semibold">Delivery phone</label><Input id="address-phone" type="tel" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="0803 000 0000" /></div><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={form.is_default} onChange={(event) => setForm((current) => ({ ...current, is_default: event.target.checked }))} /> Make this my default address</label><Button type="submit" disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <Check />} Save address</Button></form></Card>}
    {loading ? <div className="mt-8 flex justify-center text-muted-foreground"><Loader2 className="animate-spin" /></div> : addresses.length === 0 ? <Card className="mt-6 p-8 text-center"><MapPin className="mx-auto h-7 w-7 text-muted-foreground" /><p className="mt-2 font-bold">No saved addresses</p><p className="mt-1 text-sm text-muted-foreground">Add one before your next order.</p></Card> : <div className="mt-6 grid gap-3">{addresses.map((address) => <Card key={address.id} className={address.is_default ? "border-primary/50 p-4" : "p-4"}><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">{address.label.toLowerCase() === "home" ? <Home className="h-5 w-5" /> : <MapPin className="h-5 w-5" />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-bold">{address.label}</p>{address.is_default && <Badge variant="verified">Default</Badge>}</div><p className="mt-1 text-sm">{address.full_address}</p><p className="text-sm text-muted-foreground">{address.city} • {address.phone}</p><div className="mt-3 flex flex-wrap gap-2">{!address.is_default && <Button variant="outline" size="sm" onClick={() => makeDefault(address)}>Make default</Button>}<Button variant="ghost" size="sm" onClick={() => startEdit(address)}><Pencil /> Edit</Button><Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={() => remove(address)}><Trash2 /> Delete</Button></div></div></div></Card>)}</div>}
  </div>;
}
