import { supabaseServer } from "./supabase-server";
import { generateImage, type AspectRatio } from "./vertex-ai";
import { generateVideo, type VideoAspectRatio } from "./veo";
import { IMAGE_CREDIT_COST, VIDEO_CREDIT_COST } from "./pricing";
import type { TelegramWebAppUser } from "./telegram";

const BUCKET = "generations";

export type GenerateResult =
  | { ok: true; url: string; remaining: number }
  | { ok: false; error: "insufficient_credits" | "generation_failed"; remaining?: number; message?: string };

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

/**
 * Atomically deducts `cost` credits via a Postgres function (see
 * supabase/schema.sql's consume_credit) — not a read-then-write in JS,
 * which would race if two generations landed at nearly the same moment.
 * Returns the new balance, or null if there weren't enough credits.
 */
async function consumeCredits(telegramId: number, cost: number): Promise<number | null> {
  const { data, error } = await supabaseServer().rpc("consume_credit", {
    p_telegram_id: telegramId,
    p_cost: cost,
  });
  if (error) {
    console.error("consume_credit RPC failed:", error);
    return null;
  }
  const remaining = typeof data === "number" ? data : Number(data);
  return remaining >= 0 ? remaining : null;
}

export async function getCreditBalance(telegramId: number): Promise<number> {
  const { data } = await supabaseServer()
    .from("users")
    .select("credits")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  return data?.credits ?? 0;
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("webm")) return "webm";
  return "jpg";
}

async function storeResult(
  user: TelegramWebAppUser,
  prompt: string,
  media: { buffer: Buffer; mimeType: string },
  remaining: number
): Promise<GenerateResult> {
  const ext = extensionForMimeType(media.mimeType);
  const path = `${user.id}/${Date.now()}.${ext}`;

  const { error: uploadError } = await supabaseServer()
    .storage.from(BUCKET)
    .upload(path, media.buffer, { contentType: media.mimeType, upsert: false });

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

  return { ok: true, url, remaining };
}

/**
 * Full pipeline: check credit balance → call Vertex AI → upload to
 * Supabase Storage → record the generation → return the URL and remaining
 * balance. Shared by the Mini App API routes and lib/bot.ts.
 */
export async function generateAndStore(
  user: TelegramWebAppUser,
  prompt: string,
  aspectRatio: AspectRatio = "1:1"
): Promise<GenerateResult> {
  await upsertUser(user);

  const remaining = await consumeCredits(user.id, IMAGE_CREDIT_COST);
  if (remaining === null) {
    return { ok: false, error: "insufficient_credits", remaining: await getCreditBalance(user.id) };
  }

  let image;
  try {
    image = await generateImage(prompt, aspectRatio);
  } catch (err) {
    console.error("generateImage failed:", err);
    // Refund the credit — the failure was ours, not a spent generation.
    await supabaseServer().rpc("add_credits", { p_telegram_id: user.id, p_amount: IMAGE_CREDIT_COST });
    return {
      ok: false,
      error: "generation_failed",
      message: err instanceof Error ? err.message : "unknown error",
    };
  }

  return storeResult(user, prompt, image, remaining);
}

/** Same pipeline, but edits an existing image (from a Telegram photo). */
export async function editAndStore(
  user: TelegramWebAppUser,
  instruction: string,
  inputImage: { buffer: Buffer; mimeType: string }
): Promise<GenerateResult> {
  await upsertUser(user);

  const remaining = await consumeCredits(user.id, IMAGE_CREDIT_COST);
  if (remaining === null) {
    return { ok: false, error: "insufficient_credits", remaining: await getCreditBalance(user.id) };
  }

  let image;
  try {
    image = await generateImage(instruction, "1:1", inputImage);
  } catch (err) {
    console.error("editImage failed:", err);
    await supabaseServer().rpc("add_credits", { p_telegram_id: user.id, p_amount: IMAGE_CREDIT_COST });
    return {
      ok: false,
      error: "generation_failed",
      message: err instanceof Error ? err.message : "unknown error",
    };
  }

  return storeResult(user, `[edit] ${instruction}`, image, remaining);
}

/** Same pipeline, but generates a short video via Veo (costs more credits). */
export async function videoAndStore(
  user: TelegramWebAppUser,
  prompt: string,
  aspectRatio: VideoAspectRatio = "16:9"
): Promise<GenerateResult> {
  await upsertUser(user);

  const remaining = await consumeCredits(user.id, VIDEO_CREDIT_COST);
  if (remaining === null) {
    return { ok: false, error: "insufficient_credits", remaining: await getCreditBalance(user.id) };
  }

  let video;
  try {
    video = await generateVideo(prompt, aspectRatio);
  } catch (err) {
    console.error("generateVideo failed:", err);
    await supabaseServer().rpc("add_credits", { p_telegram_id: user.id, p_amount: VIDEO_CREDIT_COST });
    return {
      ok: false,
      error: "generation_failed",
      message: err instanceof Error ? err.message : "unknown error",
    };
  }

  return storeResult(user, `[video] ${prompt}`, video, remaining);
}
