import { NextRequest, NextResponse } from "next/server";
import { verifyTelegramInitData } from "@/lib/telegram";
import { generateAndStore, DAILY_LIMIT } from "@/lib/generate-image";

export async function POST(req: NextRequest) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const { initData, prompt } = await req.json().catch(() => ({}));

  const verified = verifyTelegramInitData(initData ?? "", botToken);
  if (!verified.ok || !verified.user) {
    return NextResponse.json({ error: "unauthorized", reason: verified.reason }, { status: 401 });
  }

  const trimmedPrompt = String(prompt ?? "").trim().slice(0, 500);
  if (!trimmedPrompt) {
    return NextResponse.json({ error: "empty_prompt" }, { status: 400 });
  }

  const result = await generateAndStore(verified.user, trimmedPrompt);

  if (!result.ok) {
    const status = result.error === "limit_reached" ? 429 : 502;
    return NextResponse.json(
      { error: result.error, message: result.message, remaining: result.remaining ?? 0, limit: DAILY_LIMIT },
      { status }
    );
  }

  return NextResponse.json({ url: result.url, remaining: result.remaining, limit: DAILY_LIMIT });
}
