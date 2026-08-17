-- ============================================================
-- Imagen Lab — Supabase schema
-- Run this in Supabase → SQL Editor
-- ============================================================

-- USERS (Telegram identity, no email/password auth needed)
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint unique not null,
  username text,
  first_name text,
  last_name text,
  created_at timestamptz not null default now()
);

-- GENERATIONS (one row per generated image)
create table if not exists generations (
  id bigint generated always as identity primary key,
  telegram_id bigint not null,
  prompt text not null,
  image_path text not null,
  image_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_generations_telegram_id on generations(telegram_id);
create index if not exists idx_generations_created_at on generations(created_at);

-- BOT_SESSIONS (one row per chat) — holds a pending photo file_id while
-- waiting for the user's next text message with edit instructions.
-- Needed because Vercel serverless functions don't share memory between
-- webhook calls — see lib/bot-session-store.ts.
create table if not exists bot_sessions (
  telegram_id bigint primary key,
  pending_photo_file_id text,
  awaiting_video boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Safe to re-run: adds the column if bot_sessions already existed from an
-- earlier version of this schema (before video generation was added).
alter table bot_sessions add column if not exists awaiting_video boolean not null default false;

-- ============================================================
-- Row Level Security
-- Everything here is written/read only via the server (service role key),
-- which bypasses RLS entirely — so no public policies are defined.
-- This forces every request through /api/generate and /api/gallery,
-- where Telegram initData is verified server-side (see lib/telegram.ts),
-- so nobody can read or spend another user's generations from the browser.
-- ============================================================

alter table users enable row level security;
alter table generations enable row level security;
alter table bot_sessions enable row level security;

-- ============================================================
-- Storage
-- Run this AFTER creating a bucket named "generations" in
-- Storage → New bucket (mark it "Public" — the app relies on public
-- URLs from getPublicUrl() to display images without extra auth calls).
-- ============================================================
