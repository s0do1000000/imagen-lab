import { NextRequest, NextResponse } from "next/server";
import { getOrder, checkAndSettleTonOrder } from "@/lib/orders";

// GET returns the order's current status (for the payment page's initial load).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrder(id);
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ order });
}

// POST actively checks the TON blockchain for this order's payment and
// settles it if found. Safe to call repeatedly (e.g. a "check" button).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await checkAndSettleTonOrder(id);
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ order });
}
