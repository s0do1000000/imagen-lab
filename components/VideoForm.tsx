"use client";

import { useEffect, useState } from "react";
import { getInitData, initTelegramWebApp } from "@/lib/telegram-webapp";

const ASPECT_RATIOS = [
  { value: "16:9", label: "Горизонтально" },
  { value: "9:16", label: "Вертикально" },
] as const;

type Status = "idle" | "loading" | "error";

export default function VideoForm() {
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<(typeof ASPECT_RATIOS)[number]["value"]>("16:9");
  const [status, setStatus] = useState<Status>("idle");
  const [errorText, setErrorText] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    initTelegramWebApp();
  }, []);

  async function runGeneration() {
    const trimmed = prompt.trim();
    if (!trimmed || status === "loading") return;

    setStatus("loading");
    setErrorText("");
    setResultUrl(null);

    try {
      const res = await fetch("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: getInitData(), prompt: trimmed, aspectRatio }),
      });
      const data = await res.json();

      if (!res.ok) {
        setRemaining(data.remaining ?? 0);
        setStatus("error");
        setErrorText(
          data.error === "insufficient_credits"
            ? `Недостаточно генераций (осталось: ${data.remaining ?? 0}). Пополните баланс через бота: /buy.`
            : data.error === "unauthorized"
              ? "Откройте приложение через кнопку в Telegram-боте — так проверяется, что это вы."
              : "Не получилось сгенерировать видео. Попробуйте более простой запрос."
        );
        return;
      }

      setResultUrl(data.url);
      setRemaining(data.remaining);
      setStatus("idle");
    } catch {
      setStatus("error");
      setErrorText("Проблема с соединением. Проверьте интернет и попробуйте снова.");
    }
  }

  return (
    <div className="px-5 pt-6 space-y-5">
      <header>
        <p className="label-eyebrow">Imagen Lab</p>
        <h1 className="font-display text-2xl font-bold mt-1">Видео по описанию</h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          Опишите сцену — генерация займёт 30–90 секунд.
        </p>
      </header>

      <div className="card overflow-hidden">
        <div className="sprocket-strip" />
        <div className="p-4 space-y-4">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="дрон пролетает над океаном на закате…"
            rows={3}
            maxLength={500}
            className="w-full resize-none bg-transparent outline-none text-base placeholder:opacity-50"
          />

          <div>
            <p className="label-eyebrow mb-2">Ориентация</p>
            <div className="flex gap-2">
              {ASPECT_RATIOS.map((ratio) => {
                const active = aspectRatio === ratio.value;
                return (
                  <button
                    key={ratio.value}
                    type="button"
                    onClick={() => setAspectRatio(ratio.value)}
                    className="flex-1 py-2 rounded-xl text-sm border transition-colors"
                    style={{
                      borderColor: active ? "var(--safelight)" : "var(--border)",
                      background: active ? "var(--safelight-soft)" : "transparent",
                      color: active ? "var(--safelight)" : "var(--muted)",
                    }}
                  >
                    {ratio.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="sprocket-strip" />
      </div>

      <button
        onClick={runGeneration}
        disabled={!prompt.trim() || status === "loading"}
        className="w-full py-3.5 rounded-2xl font-display font-bold text-base disabled:opacity-40 transition-opacity"
        style={{ background: "var(--safelight)", color: "#171412" }}
      >
        {status === "loading" ? "Генерирую видео…" : "Сгенерировать"}
      </button>

      {remaining !== null && (
        <p className="text-center text-xs" style={{ color: "var(--muted)" }}>
          Баланс: {remaining} генераций
        </p>
      )}

      {status === "error" && errorText && (
        <p
          className="text-sm text-center px-4 py-3 rounded-xl"
          style={{ background: "var(--surface)", color: "var(--safelight)" }}
        >
          {errorText}
        </p>
      )}

      {status === "loading" && (
        <div className="card safelight-glow aspect-video flex items-center justify-center">
          <p className="label-eyebrow animate-pulse">Проявляется… обычно 30–90 секунд</p>
        </div>
      )}

      {resultUrl && status !== "loading" && (
        <div className="space-y-2">
          <div className="card overflow-hidden safelight-glow">
            <video src={resultUrl} controls autoPlay muted loop playsInline className="w-full" />
          </div>
          <div className="flex gap-2">
            <button
              onClick={runGeneration}
              className="flex-1 py-2.5 rounded-xl text-sm border font-display"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              Ещё раз
            </button>
            <a
              href={resultUrl}
              target="_blank"
              rel="noreferrer"
              className="flex-1 py-2.5 rounded-xl text-sm border font-display text-center"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              Открыть / сохранить
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
