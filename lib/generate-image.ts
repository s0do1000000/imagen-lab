import { supabaseServer } from "./supabase-server";
import { generateImage, type AspectRatio } from "./vertex-ai";
import type { TelegramWebAppUser } from "./telegram";

const DAILY_LIMIT = Number(process.env.DAILY_GENERATION_LIMIT ?? 15);
const BUCKET = "generations";

export type GenerateResult =
  | { ok: true; url: string; remaining: number }
  | { ok: false; error: "limit_reached" | "generation_failed"; remaining?: number; message?: string };

async function upsertUser(user: TelegramWebAppUser) {
  await supabaseServer()
    .from("users")
    .upsert(
      {
        telegram_id: user.id,
        username: user.username ?? null,
        first_name: user.first_name ?? null,
        last_name: user.last_name ?? null,
      },
      { onConflict: "telegram_id" }
    );
}

/** Counts generations by this user in the last 24h to enforce the daily cap. */
async function countRecentGenerations(telegramId: number): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabaseServer()
    .from("generations")
    .select("id", { count: "exact", head: true })
    .eq("telegram_id", telegramId)
    .gte("created_at", since);
  return count ?? 0;
}

/**
 * Full pipeline: check quota → call Vertex AI → upload to Supabase Storage →
 * record the generation → return the public URL and remaining quota.
 *
 * Shared by app/api/generate/route.ts (Mini App) and lib/bot.ts (direct
 * chat), so both surfaces enforce the same limit and write to the same
 * gallery.
 */
export async function generateAndStore(
  user: TelegramWebAppUser,
  prompt: string,
  aspectRatio: AspectRatio = "1:1"
): Promise<GenerateResult> {
  await upsertUser(user);

  const used = await countRecentGenerations(user.id);
  if (used >= DAILY_LIMIT) {
    return { ok: false, error: "limit_reached", remaining: 0 };
  }

  let image;
  try {
    image = await generateImage(prompt, aspectRatio);
  } catch (err) {
    console.error("generateImage failed:", err);
    return {
      ok: false,
      error: "generation_failed",
      message: err instanceof Error ? err.message : "unknown error",
    };
  }

  const ext = image.mimeType.includes("png") ? "png" : "jpg";
  const path = `${user.id}/${Date.now()}.${ext}`;

  const { error: uploadError } = await supabaseServer()
    .storage.from(BUCKET)
    .upload(path, image.buffer, { contentType: image.mimeType, upsert: false });

  if (uploadError) {
    console.error("Storage upload failed:", uploadError);
    return { ok: false, error: "generation_failed", message: uploadError.message };
  }

  const { data: publicUrlData } = supabaseServer().storage.from(BUCKET).getPublicUrl(path);
  const url = publicUrlData.publicUrl;

  await supabaseServer().from("generations").insert({
    telegram_id: user.id,
    prompt: prompt.slice(0, 1000),
    image_path: path,
    image_url: url,
  });

  const remaining = Math.max(0, DAILY_LIMIT - used - 1);
  return { ok: true, url, remaining };
}

export { DAILY_LIMIT };
