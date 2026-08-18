import { supabaseServer } from "./supabase-server";
import { findTonPayment } from "./ton";
import type { CreditPackage } from "./pricing";

export interface Order {
  id: string;
  telegram_id: number;
  package_credits: number;
  method: "stars" | "ton";
  amount: number;
  memo: string | null;
  status: "pending" | "paid" | "expired";
}

function randomMemo(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

export async function createTonOrder(telegramId: number, pkg: CreditPackage): Promise<Order> {
  const memo = randomMemo();
  const { data, error } = await supabaseServer()
    .from("orders")
    .insert({
      telegram_id: telegramId,
      package_credits: pkg.credits,
      method: "ton",
      amount: pkg.usdtAmount,
      memo,
      status: "pending",
    })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to create order");
  return data as Order;
}

export async function getOrder(orderId: string): Promise<Order | null> {
  const { data } = await supabaseServer().from("orders").select("*").eq("id", orderId).maybeSingle();
  return (data as Order) ?? null;
}

/**
 * Checks for a matching USDT payment on the TON blockchain; if found, credits
 * the user's balance and marks the order paid. Safe to call repeatedly —
 * already-paid orders are returned as-is without double-crediting.
 */
export async function checkAndSettleTonOrder(orderId: string): Promise<Order | null> {
  const order = await getOrder(orderId);
  if (!order || order.status !== "pending" || !order.memo) return order;

  const paid = await findTonPayment(order.memo, order.amount);
  if (!paid) return order;

  await supabaseServer().rpc("add_credits", {
    p_telegram_id: order.telegram_id,
    p_amount: order.package_credits,
  });

  const { data } = await supabaseServer()
    .from("orders")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", orderId)
    .eq("status", "pending") // guards against a concurrent settle already having flipped it
    .select()
    .single();

  return (data as Order) ?? order;
}
