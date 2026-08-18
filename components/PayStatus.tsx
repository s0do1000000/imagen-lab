"use client";

import { useCallback, useEffect, useState } from "react";

interface Order {
  id: string;
  package_credits: number;
  amount: number;
  memo: string | null;
  status: "pending" | "paid" | "expired";
}

// Deliberately does NOT use the Telegram WebApp SDK or initData — this page
// is meant to be opened via a plain link in an ordinary browser, outside
// the Telegram app shell. That distinction is what keeps a crypto payment
// here compliant with Telegram's rule that digital goods purchased *inside*
// Telegram apps must use Stars: this purchase genuinely isn't happening
// inside Telegram. See lib/bot.ts for how this link is sent (a plain URL,
// not a web_app button).
export default function PayStatus({ orderId, walletAddress }: { orderId: string; walletAddress: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [checking, setChecking] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/orders/${orderId}`);
    if (!res.ok) {
      setNotFound(true);
      return;
    }
    const data = await res.json();
    setOrder(data.order);
  }, [orderId]);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch(`/api/orders/${orderId}`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setOrder(data.order);
      }
    } finally {
      setChecking(false);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-poll every 8s while pending — the manual button is still there
  // for an immediate check right after sending payment.
  useEffect(() => {
    if (order?.status !== "pending") return;
    const interval = setInterval(check, 8000);
    return () => clearInterval(interval);
  }, [order?.status, check]);

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "var(--bg)", color: "var(--text)" }}>
        <p style={{ color: "var(--muted)" }}>Заказ не найден. Проверьте ссылку.</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)", color: "var(--text)" }}>
        <p className="label-eyebrow animate-pulse">Загрузка…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-5 py-10 max-w-md mx-auto" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <p className="label-eyebrow">Imagen Lab</p>
      <h1 className="font-display text-2xl font-bold mt-1 mb-6">Оплата криптой</h1>

      {order.status === "paid" && (
        <div className="card p-6 text-center space-y-2">
          <p className="text-3xl">✅</p>
          <p className="font-display font-bold">Оплачено!</p>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Начислено {order.package_credits} генераций. Возвращайтесь в бота — баланс уже обновлён.
          </p>
        </div>
      )}

      {order.status === "pending" && (
        <div className="space-y-4">
          <div className="card p-5 space-y-4">
            <p className="text-xs px-3 py-2 rounded-lg" style={{ background: "var(--safelight-soft)", color: "var(--safelight)" }}>
              Отправьте именно <b>USDT</b> в сети TON — не саму монету TON.
            </p>
            <div>
              <p className="label-eyebrow mb-1">Сумма</p>
              <p className="font-display text-xl font-bold">{order.amount} USDT</p>
            </div>
            {walletAddress && (
              <div>
                <p className="label-eyebrow mb-1">Адрес кошелька</p>
                <p className="text-sm break-all" style={{ color: "var(--text)" }}>{walletAddress}</p>
              </div>
            )}
            <div>
              <p className="label-eyebrow mb-1">Комментарий (обязательно!)</p>
              <p className="text-lg font-display font-bold" style={{ color: "var(--safelight)" }}>
                {order.memo}
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                Без этого комментария платёж не будет найден автоматически.
              </p>
            </div>
          </div>

          <button
            onClick={check}
            disabled={checking}
            className="w-full py-3.5 rounded-2xl font-display font-bold text-base disabled:opacity-40"
            style={{ background: "var(--safelight)", color: "#171412" }}
          >
            {checking ? "Проверяю…" : "Я оплатил — проверить"}
          </button>
          <p className="text-xs text-center" style={{ color: "var(--muted)" }}>
            Страница проверяет платёж автоматически каждые несколько секунд.
          </p>
        </div>
      )}

      {order.status === "expired" && (
        <p className="text-sm text-center" style={{ color: "var(--muted)" }}>
          Срок заказа истёк. Создайте новый через бота.
        </p>
      )}
    </div>
  );
}
