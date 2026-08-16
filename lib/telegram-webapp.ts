"use client";

// Thin wrapper around window.Telegram.WebApp — only what this app needs.
// Falls back gracefully when opened outside Telegram (e.g. during local
// dev in a normal browser), so the UI doesn't crash — API calls will just
// get a 401 from the server in that case, which the UI surfaces.

interface TelegramWebApp {
  initData: string;
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  themeParams?: Record<string, string>;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function initTelegramWebApp() {
  const webApp = window.Telegram?.WebApp;
  if (!webApp) return;
  webApp.ready();
  webApp.expand();
  webApp.setBackgroundColor?.("#171412");
  webApp.setHeaderColor?.("#171412");
}

export function getInitData(): string {
  return window.Telegram?.WebApp?.initData ?? "";
}
