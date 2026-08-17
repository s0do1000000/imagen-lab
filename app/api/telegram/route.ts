import { NextRequest, NextResponse } from "next/server";
import { getBot } from "@/lib/bot";

// Video generation polls in the background after this route already
// responded (see lib/bot.ts's use of after()) — this needs enough headroom
// for that polling to finish. If your Vercel plan caps function duration
// lower than this, video generation may be cut short; images and photo
// edits finish in a few seconds regardless and aren't affected.
export const maxDuration = 300;

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
