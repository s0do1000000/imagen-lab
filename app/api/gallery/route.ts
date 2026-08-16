import { NextRequest, NextResponse } from "next/server";
import { verifyTelegramInitData } from "@/lib/telegram";
import { supabaseServer } from "@/lib/supabase-server";

// Returns only the requesting user's own generations — never other users'.
// initData is verified server-side so telegram_id can't be spoofed from
// the client (see lib/telegram.ts).
export async function POST(req: NextRequest) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const { initData } = await req.json().catch(() => ({}));
  const verified = verifyTelegramInitData(initData ?? "", botToken);
  if (!verified.ok || !verified.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseServer()
    .from("generations")
    .select("id, prompt, image_url, created_at")
    .eq("telegram_id", verified.user.id)
    .order("created_at", { ascending: false })
    .limit(60);

  if (error) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [] });
}
