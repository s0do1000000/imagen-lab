import { createClient, SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Service-role Supabase client — server-only, bypasses Row Level Security.
 * Never import this from a client component. All writes to `users` /
 * `generations` go through here, after Telegram initData has been verified
 * (see lib/telegram.ts), so telegram_id can never be spoofed from the browser.
 */
export function supabaseServer(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase env vars are not set (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
  }

  cached = createClient(url, key, {
    auth: { persistSession: false },
  });
  return cached;
}
