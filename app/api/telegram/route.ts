import { NextRequest, NextResponse } from "next/server";
import { getBot } from "@/lib/bot";

// Telegram calls this endpoint (POST) once the webhook is registered.
// Register it once after deploying, e.g.:
//   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-app.vercel.app/api/telegram"
export async function POST(req: NextRequest) {
  try {
    const update = await req.json();
    await getBot().handleUpdate(update);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
