/**
 * Web-app Supabase entrypoint. Re-exports the shared workspace clients so
 * product code has one import path: `@/lib/supabase`.
 */
export { supabaseBrowser, supabaseServer } from "@bale-drop/database";
export type { Database } from "@bale-drop/database";
