"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Рисовать", icon: "✦" },
  { href: "/edit", label: "Фото", icon: "✎" },
  { href: "/video", label: "Видео", icon: "▶" },
  { href: "/gallery", label: "Галерея", icon: "▦" },
];

export default function BottomNavigation() {
  const pathname = usePathname();

  // The /pay page is a standalone external page (opened via a plain link,
  // not through Telegram) — it's not part of the Mini App's tab flow, so
  // the app's navigation doesn't belong there.
  if (pathname?.startsWith("/pay")) return null;

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-20 border-t"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <div className="flex mx-auto max-w-md">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex-1 flex flex-col items-center gap-1 py-3"
              style={{ color: active ? "var(--safelight)" : "var(--muted)" }}
            >
              <span className="text-lg leading-none">{tab.icon}</span>
              <span className="label-eyebrow" style={{ letterSpacing: "0.1em" }}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
