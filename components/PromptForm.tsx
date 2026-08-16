"use client";

import { useEffect, useState } from "react";
import { getInitData, initTelegramWebApp } from "@/lib/telegram-webapp";

const STYLE_PRESETS = [
  { label: "Мультяшно", suffix: "cute cartoon style, soft colors" },
  { label: "Акварель", suffix: "watercolor painting style" },
  { label: "Плёнка 35мм", suffix: "35mm film photo, grainy, warm tones" },
  { label: "Неон", suffix: "neon cyberpunk lighting, night scene" },
  { label: "Масло", suffix: "oil painting, textured brushstrokes" },
  { label: "Минимализм", suffix: "minimalist flat design, clean lines" },
];

type Status = "idle" | "loading" | "error";

export default function PromptForm() {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorText, setErrorText] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [limit, setLimit] = useState<number | null>(null);

  useEffect(() => {
    initTelegramWebApp();
  }, []);

  async function handleGenerate() {
    const trimmed = prompt.trim();
    if (!trimmed || status === "loading") return;

    setStatus("loading");
    setErrorText("");
    setResultUrl(null);

    const fullPrompt = style ? `${trimmed}, ${style}` : trimmed;

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: getInitData(), prompt: fullPrompt }),
      });
      const data = await res.json();

      if (!res.ok) {
        setLimit(data.limit ?? null);
        setRemaining(data.remaining ?? 0);
        setStatus("error");
        setErrorText(
          data.error === "limit_reached"
            ? `Лимит на сегодня исчерпан (${data.limit}/сутки). Попробуйте завтра.`
            : data.error === "unauthorized"
              ? "Откройте приложение через кнопку в Telegram-боте — так проверяется, что это вы."
              : "Не получилось нарисовать картинку. Попробуйте переформулировать запрос."
        );
        return;
      }

      setResultUrl(data.url);
      setRemaining(data.remaining);
      setLimit(data.limit);
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
        <h1 className="font-display text-2xl font-bold mt-1">Опишите — и получите</h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          Слова становятся картинкой за несколько секунд.
        </p>
      </header>

      <div className="card overflow-hidden">
        <div className="sprocket-strip" />
        <div className="p-4 space-y-3">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="лиса сидит в осеннем лесу…"
            rows={3}
            maxLength={500}
            className="w-full resize-none bg-transparent outline-none text-base placeholder:opacity-50"
          />
          <div className="flex flex-wrap gap-2">
            {STYLE_PRESETS.map((preset) => {
              const active = style === preset.suffix;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setStyle(active ? null : preset.suffix)}
                  className="px-3 py-1.5 rounded-full text-sm border transition-colors"
                  style={{
                    borderColor: active ? "var(--safelight)" : "var(--border)",
                    background: active ? "var(--safelight-soft)" : "transparent",
                    color: active ? "var(--safelight)" : "var(--muted)",
                  }}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="sprocket-strip" />
      </div>

      <button
        onClick={handleGenerate}
        disabled={!prompt.trim() || status === "loading"}
        className="w-full py-3.5 rounded-2xl font-display font-bold text-base disabled:opacity-40 transition-opacity"
        style={{ background: "var(--safelight)", color: "#171412" }}
      >
        {status === "loading" ? "Проявляю…" : "Нарисовать"}
      </button>

      {remaining !== null && limit !== null && (
        <p className="text-center text-xs" style={{ color: "var(--muted)" }}>
          Осталось сегодня: {remaining}/{limit}
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
        <div className="card safelight-glow aspect-square flex items-center justify-center">
          <p className="label-eyebrow animate-pulse">Проявляется…</p>
        </div>
      )}

      {resultUrl && status !== "loading" && (
        <div className="card overflow-hidden safelight-glow">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={resultUrl} alt={prompt} className="w-full aspect-square object-cover animate-develop" />
        </div>
      )}
    </div>
  );
}
