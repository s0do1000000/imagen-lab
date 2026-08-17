"use client";

import { useEffect, useState } from "react";
import { getInitData, initTelegramWebApp } from "@/lib/telegram-webapp";

interface GenerationItem {
  id: number;
  prompt: string;
  image_url: string;
  created_at: string;
}

export default function GalleryGrid() {
  const [items, setItems] = useState<GenerationItem[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    initTelegramWebApp();

    fetch("/api/gallery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: getInitData() }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => setItems(data.items))
      .catch(() => setError(true));
  }, []);

  return (
    <div className="px-5 pt-6 space-y-5">
      <header>
        <p className="label-eyebrow">Контрольный лист</p>
        <h1 className="font-display text-2xl font-bold mt-1">Ваши картинки</h1>
      </header>

      {error && (
        <p className="text-sm text-center px-4 py-3 rounded-xl card" style={{ color: "var(--safelight)" }}>
          Не удалось загрузить галерею. Откройте приложение через бота в Telegram.
        </p>
      )}

      {!error && items === null && (
        <p className="label-eyebrow text-center animate-pulse">Загрузка…</p>
      )}

      {items !== null && items.length === 0 && (
        <div className="card overflow-hidden">
          <div className="sprocket-strip" />
          <p className="p-8 text-center text-sm" style={{ color: "var(--muted)" }}>
            Пока пусто. Нарисуйте первую картинку на вкладке «Рисовать» —
            она появится здесь.
          </p>
          <div className="sprocket-strip" />
        </div>
      )}

      {items && items.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {items.map((item) => (
            <a
              key={item.id}
              href={item.image_url}
              target="_blank"
              rel="noreferrer"
              className="card overflow-hidden block"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.image_url}
                alt={item.prompt}
                className="w-full aspect-square object-cover"
                loading="lazy"
              />
              <p className="px-2 py-1.5 text-xs truncate" style={{ color: "var(--muted)" }}>
                {item.prompt}
              </p>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
