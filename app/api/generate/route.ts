import { NextRequest, NextResponse } from "next/server";
import { verifyTelegramInitData } from "@/lib/telegram";
import { generateAndStore } from "@/lib/generate-image";
import type { AspectRatio } from "@/lib/vertex-ai";

const VALID_ASPECT_RATIOS: AspectRatio[] = ["1:1", "3:4", "4:3", "9:16", "16:9"];

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

  const safeAspectRatio: AspectRatio = VALID_ASPECT_RATIOS.includes(aspectRatio) ? aspectRatio : "1:1";

  const result = await generateAndStore(verified.user, trimmedPrompt, safeAspectRatio);

  if (!result.ok) {
    const status = result.error === "insufficient_credits" ? 402 : 502;
    return NextResponse.json(
      { error: result.error, message: result.message, remaining: result.remaining ?? 0 },
      { status }
    );
  }

  return NextResponse.json({ url: result.url, remaining: result.remaining });
}
