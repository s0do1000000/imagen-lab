import { NextRequest, NextResponse } from "next/server";
import { verifyTelegramInitData } from "@/lib/telegram";
import { videoAndStore, DAILY_LIMIT } from "@/lib/generate-image";
import type { VideoAspectRatio } from "@/lib/veo";

// Video generation takes 30s-2min. Unlike the bot's Telegram webhook (which
// must respond fast or Telegram may retry the update), this is a normal
// browser fetch — the client just waits with a loading state, so we can
// await the full result here directly. Needs matching headroom on the
// function's max duration.
export const maxDuration = 300;

const VALID_RATIOS: VideoAspectRatio[] = ["16:9", "9:16"];

export async function POST(req: NextRequest) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const { initData, prompt, aspectRatio } = await req.json().catch(() => ({}));

  const verified = verifyTelegramInitData(initData ?? "", botToken);
  if (!verified.ok || !verified.user) {
    return NextResponse.json({ error: "unauthorized", reason: verified.reason }, { status: 401 });
  }

  const trimmedPrompt = String(prompt ?? "").trim().slice(0, 500);
  if (!trimmedPrompt) {
    return NextResponse.json({ error: "empty_prompt" }, { status: 400 });
  }

  const safeRatio: VideoAspectRatio = VALID_RATIOS.includes(aspectRatio) ? aspectRatio : "16:9";

  const result = await videoAndStore(verified.user, trimmedPrompt, safeRatio);

  if (!result.ok) {
    const status = result.error === "limit_reached" ? 429 : 502;
    return NextResponse.json(
      { error: result.error, message: result.message, remaining: result.remaining ?? 0, limit: DAILY_LIMIT },
      { status }
    );
  }

  return NextResponse.json({ url: result.url, remaining: result.remaining, limit: DAILY_LIMIT });
}
