"use client";

import { useEffect, useRef, useState } from "react";
import { getInitData, initTelegramWebApp } from "@/lib/telegram-webapp";
import { resizeImageForUpload } from "@/lib/image-resize";

const HINTS = [
  { label: "Закат", text: "сделай фон закатным" },
  { label: "Очки", text: "добавь очки" },
  { label: "Мультяшно", text: "преврати в мультяшный стиль" },
  { label: "Убрать людей", text: "убери людей на фоне" },
  { label: "Ч/Б кино", text: "сделай чёрно-белым, кинематографично" },
];

type Status = "idle" | "loading" | "error";

export default function EditForm() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [encoded, setEncoded] = useState<{ base64: string; mimeType: string } | null>(null);
  const [instruction, setInstruction] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorText, setErrorText] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    initTelegramWebApp();
  }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setResultUrl(null);
    setErrorText("");
    setPreviewUrl(URL.createObjectURL(file));

    try {
      const resized = await resizeImageForUpload(file);
      setEncoded(resized);
    } catch {
      setErrorText("Не удалось обработать фото. Попробуйте другое.");
      setEncoded(null);
    }
  }

  async function handleEdit() {
    const trimmed = instruction.trim();
    if (!trimmed || !encoded || status === "loading") return;

    setStatus("loading");
    setErrorText("");
    setResultUrl(null);

    try {
      const res = await fetch("/api/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initData: getInitData(),
          instruction: trimmed,
          imageBase64: encoded.base64,
          imageMimeType: encoded.mimeType,
        }),
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
              : data.error === "image_too_large"
                ? "Фото слишком большое. Попробуйте другое."
                : "Не получилось отредактировать фото. Попробуйте переформулировать запрос."
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

  function reset() {
    setPreviewUrl(null);
    setEncoded(null);
    setInstruction("");
    setResultUrl(null);
    setErrorText("");
    setStatus("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="px-5 pt-6 space-y-5">
      <header>
        <p className="label-eyebrow">Imagen Lab</p>
        <h1 className="font-display text-2xl font-bold mt-1">Отредактировать фото</h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          Загрузите фото и опишите, что изменить.
        </p>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {!previewUrl && (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full card overflow-hidden"
        >
          <div className="sprocket-strip" />
          <div className="p-10 text-center">
            <p className="text-3xl mb-2">📷</p>
            <p className="label-eyebrow">Выбрать фото</p>
          </div>
          <div className="sprocket-strip" />
        </button>
      )}

      {previewUrl && !resultUrl && (
        <div className="space-y-4">
          <div className="card overflow-hidden">
            <div className="sprocket-strip" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="Загруженное фото" className="w-full object-cover" />
            <div className="sprocket-strip" />
          </div>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-sm underline"
            style={{ color: "var(--muted)" }}
          >
            Заменить фото
          </button>

          <div className="card p-4 space-y-3">
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="что изменить на фото…"
              rows={2}
              maxLength={500}
              className="w-full resize-none bg-transparent outline-none text-base placeholder:opacity-50"
            />
            <div className="flex flex-wrap gap-2">
              {HINTS.map((hint) => (
                <button
                  key={hint.label}
                  type="button"
                  onClick={() => setInstruction(hint.text)}
                  className="px-3 py-1.5 rounded-full text-sm border"
                  style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                >
                  {hint.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleEdit}
            disabled={!instruction.trim() || !encoded || status === "loading"}
            className="w-full py-3.5 rounded-2xl font-display font-bold text-base disabled:opacity-40 transition-opacity"
            style={{ background: "var(--safelight)", color: "#171412" }}
          >
            {status === "loading" ? "Проявляю…" : "Отредактировать"}
          </button>
        </div>
      )}

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
        <div className="card safelight-glow aspect-square flex items-center justify-center">
          <p className="label-eyebrow animate-pulse">Проявляется…</p>
        </div>
      )}

      {resultUrl && status !== "loading" && (
        <div className="space-y-2">
          <a href={resultUrl} target="_blank" rel="noreferrer" className="card overflow-hidden safelight-glow block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resultUrl} alt={instruction} className="w-full object-cover animate-develop" />
          </a>
          <div className="flex gap-2">
            <button
              onClick={handleEdit}
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
          <button onClick={reset} className="w-full text-sm underline text-center" style={{ color: "var(--muted)" }}>
            Загрузить другое фото
          </button>
        </div>
      )}
    </div>
  );
}
