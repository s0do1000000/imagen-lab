import { supabaseServer } from "./supabase-server";

const TABLE = "bot_sessions";
const EXPIRY_MINUTES = 30;

/**
 * Vercel serverless functions don't share memory between invocations — each
 * webhook call is a fresh process. So when a user sends a photo without a
 * caption and we ask "what should I change?", we can't just hold the
 * file_id in a variable and wait for their next message; it has to be
 * persisted somewhere the next (unrelated) invocation can read it back.
 * This table is that hand-off point, scoped to one row per chat.
 */

export async function setPendingPhoto(telegramId: number, fileId: string): Promise<void> {
  await supabaseServer()
    .from(TABLE)
    .upsert({ telegram_id: telegramId, pending_photo_file_id: fileId, updated_at: new Date().toISOString() }, { onConflict: "telegram_id" });
}

export async function getPendingPhoto(telegramId: number): Promise<string | null> {
  const { data } = await supabaseServer()
    .from(TABLE)
    .select("pending_photo_file_id, updated_at")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (!data?.pending_photo_file_id) return null;

  const ageMinutes = (Date.now() - new Date(data.updated_at).getTime()) / 60000;
  if (ageMinutes > EXPIRY_MINUTES) {
    await clearPendingPhoto(telegramId);
    return null;
  }

  return data.pending_photo_file_id;
}

export async function clearPendingPhoto(telegramId: number): Promise<void> {
  await supabaseServer().from(TABLE).delete().eq("telegram_id", telegramId);
}
