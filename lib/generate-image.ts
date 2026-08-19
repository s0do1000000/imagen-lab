import { supabaseServer } from "./supabase-server";
import { generateImage, type AspectRatio } from "./vertex-ai";
import { generateVideo, type VideoAspectRatio } from "./veo";
import { IMAGE_CREDIT_COST, VIDEO_CREDIT_COST } from "./pricing";
import type { TelegramWebAppUser } from "./telegram";

const BUCKET = "generations";

type FreeTrialColumn = "free_image_used" | "free_edit_used" | "free_video_used";

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
 * Tries to claim this user's one-time free trial for a specific feature
 * (image / edit / video — each tracked separately, so a new user can try
 * all three once before paying for any of them). The `.eq(column, false)`
 * makes this a single atomic UPDATE at the database level — if two
 * requests race, only one can flip false→true and get `true` back here.
 */
async function claimFreeTrial(telegramId: number, column: FreeTrialColumn): Promise<boolean> {
  const { data, error } = await supabaseServer()
    .from("users")
    .update({ [column]: true })
    .eq("telegram_id", telegramId)
    .eq(column, false)
    .select("telegram_id")
    .maybeSingle();

  if (error) {
    console.error(`claimFreeTrial(${column}) failed:`, error);
    return false;
  }
  return data !== null;
}

/** Un-claims a free trial — used when our own generation failed, so the
 * user's one free try isn't wasted on our error. */
async function revertFreeTrial(telegramId: number, column: FreeTrialColumn): Promise<void> {
  const { error } = await supabaseServer().from("users").update({ [column]: false }).eq("telegram_id", telegramId);
  if (error) {
    console.error(`revertFreeTrial(${column}) failed:`, error);
  }
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
 * Shared gate in front of every feature: first use is free (per feature,
 * via `freeColumn`), every use after that costs `cost` credits. Returns
 * the balance to report back, or an insufficient-credits result to return
 * immediately without calling the (paid) generation API at all.
 */
async function gateAccess(
  telegramId: number,
  freeColumn: FreeTrialColumn,
  cost: number
): Promise<{ ok: true; remaining: number; usedFreeTrial: boolean } | { ok: false; result: GenerateResult }> {
  const gotFreeTrial = await claimFreeTrial(telegramId, freeColumn);
  if (gotFreeTrial) {
    return { ok: true, remaining: await getCreditBalance(telegramId), usedFreeTrial: true };
  }

  const remaining = await consumeCredits(telegramId, cost);
  if (remaining === null) {
    return {
      ok: false,
      result: { ok: false, error: "insufficient_credits", remaining: await getCreditBalance(telegramId) },
    };
  }
  return { ok: true, remaining, usedFreeTrial: false };
}

/** Refunds whichever form of access was spent — a paid credit, or the free trial. */
async function refundAccess(
  telegramId: number,
  freeColumn: FreeTrialColumn,
  cost: number,
  usedFreeTrial: boolean
): Promise<void> {
  if (usedFreeTrial) {
    await revertFreeTrial(telegramId, freeColumn);
  } else {
    await supabaseServer().rpc("add_credits", { p_telegram_id: telegramId, p_amount: cost });
  }
}

/**
 * Full pipeline: first try free (once), then check credit balance → call
 * Vertex AI → upload to Supabase Storage → record the generation → return
 * the URL and remaining balance. Shared by the Mini App API routes and
 * lib/bot.ts.
 */
export async function generateAndStore(
  user: TelegramWebAppUser,
  prompt: string,
  aspectRatio: AspectRatio = "1:1"
): Promise<GenerateResult> {
  await upsertUser(user);

  const gate = await gateAccess(user.id, "free_image_used", IMAGE_CREDIT_COST);
  if (!gate.ok) return gate.result;

  let image;
  try {
    image = await generateImage(prompt, aspectRatio);
  } catch (err) {
    console.error("generateImage failed:", err);
    await refundAccess(user.id, "free_image_used", IMAGE_CREDIT_COST, gate.usedFreeTrial);
    return {
      ok: false,
      error: "generation_failed",
      message: err instanceof Error ? err.message : "unknown error",
    };
  }

  return storeResult(user, prompt, image, gate.remaining);
}

/** Same pipeline, but edits an existing image (from a Telegram photo). */
export async function editAndStore(
  user: TelegramWebAppUser,
  instruction: string,
  inputImage: { buffer: Buffer; mimeType: string }
): Promise<GenerateResult> {
  await upsertUser(user);

  const gate = await gateAccess(user.id, "free_edit_used", IMAGE_CREDIT_COST);
  if (!gate.ok) return gate.result;

  let image;
  try {
    image = await generateImage(instruction, "1:1", inputImage);
  } catch (err) {
    console.error("editImage failed:", err);
    await refundAccess(user.id, "free_edit_used", IMAGE_CREDIT_COST, gate.usedFreeTrial);
    return {
      ok: false,
      error: "generation_failed",
      message: err instanceof Error ? err.message : "unknown error",
    };
  }

  return storeResult(user, `[edit] ${instruction}`, image, gate.remaining);
}

/** Same pipeline, but generates a short video via Veo (costs more credits). */
export async function videoAndStore(
  user: TelegramWebAppUser,
  prompt: string,
  aspectRatio: VideoAspectRatio = "16:9"
): Promise<GenerateResult> {
  await upsertUser(user);

  const gate = await gateAccess(user.id, "free_video_used", VIDEO_CREDIT_COST);
  if (!gate.ok) return gate.result;

  let video;
  try {
    video = await generateVideo(prompt, aspectRatio);
  } catch (err) {
    console.error("generateVideo failed:", err);
    await refundAccess(user.id, "free_video_used", VIDEO_CREDIT_COST, gate.usedFreeTrial);
    return {
      ok: false,
      error: "generation_failed",
      message: err instanceof Error ? err.message : "unknown error",
    };
  }

  return storeResult(user, `[video] ${prompt}`, video, gate.remaining);
}
