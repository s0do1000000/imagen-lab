import { NextRequest, NextResponse } from "next/server";
import { verifyTelegramInitData } from "@/lib/telegram";
import { editAndStore, DAILY_LIMIT } from "@/lib/generate-image";

// Keeps the decoded buffer well under Vercel's serverless request body
// limit (base64 already inflates size ~33% on the wire on top of this).
const MAX_IMAGE_BYTES = 4_000_000;

export async function POST(req: NextRequest) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const { initData, instruction, imageBase64, imageMimeType } = await req.json().catch(() => ({}));

  const verified = verifyTelegramInitData(initData ?? "", botToken);
  if (!verified.ok || !verified.user) {
    return NextResponse.json({ error: "unauthorized", reason: verified.reason }, { status: 401 });
  }

  const trimmedInstruction = String(instruction ?? "").trim().slice(0, 500);
  if (!trimmedInstruction) {
    return NextResponse.json({ error: "empty_prompt" }, { status: 400 });
  }
  if (!imageBase64 || typeof imageBase64 !== "string") {
    return NextResponse.json({ error: "no_image" }, { status: 400 });
  }

  const buffer = Buffer.from(imageBase64, "base64");
  if (buffer.length > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "image_too_large" }, { status: 400 });
  }

  const result = await editAndStore(verified.user, trimmedInstruction, {
    buffer,
    mimeType: typeof imageMimeType === "string" ? imageMimeType : "image/jpeg",
  });

  if (!result.ok) {
    const status = result.error === "limit_reached" ? 429 : 502;
    return NextResponse.json(
      { error: result.error, message: result.message, remaining: result.remaining ?? 0, limit: DAILY_LIMIT },
      { status }
    );
  }

  return NextResponse.json({ url: result.url, remaining: result.remaining, limit: DAILY_LIMIT });
}
