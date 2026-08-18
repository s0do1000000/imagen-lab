-- ============================================================
-- Imagen Lab — Supabase schema
-- Run this in Supabase → SQL Editor
-- Safe to re-run in full any time — every statement is idempotent.
-- ============================================================

-- USERS (Telegram identity, no email/password auth needed)
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint unique not null,
  username text,
  first_name text,
  last_name text,
  credits integer not null default 0,
  free_image_used boolean not null default false,
  free_edit_used boolean not null default false,
  free_video_used boolean not null default false,
  created_at timestamptz not null default now()
);

-- Adds the columns if `users` already existed from an earlier version of
-- this schema. New users start with 0 paid credits — access before buying
-- comes from the three free-trial flags below (one try per feature)
-- instead of a single shared free credit.
alter table users add column if not exists credits integer not null default 0;
alter table users add column if not exists free_image_used boolean not null default false;
alter table users add column if not exists free_edit_used boolean not null default false;
alter table users add column if not exists free_video_used boolean not null default false;

-- GENERATIONS (one row per generated image/video)
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

alter table bot_sessions add column if not exists awaiting_video boolean not null default false;

-- ORDERS (one row per purchase attempt — Stars orders are settled
-- synchronously via Telegram's payment flow and don't strictly need a row,
-- but TON orders need somewhere to hold the unique memo code while we wait
-- for the blockchain payment to show up).
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  package_credits integer not null,
  method text not null check (method in ('stars', 'ton')),
  amount numeric not null,
  memo text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists idx_orders_telegram_id on orders(telegram_id);
create index if not exists idx_orders_memo on orders(memo);

-- ============================================================
-- Credit functions — atomic balance changes.
-- Using SQL functions (not read-then-write from application code) avoids a
-- race condition where two generations requested at nearly the same moment
-- could both read "1 credit left" and both proceed, going negative.
-- ============================================================

create or replace function consume_credit(p_telegram_id bigint, p_cost integer)
returns integer
language plpgsql
as $$
declare
  remaining integer;
begin
  update users
  set credits = credits - p_cost
  where telegram_id = p_telegram_id and credits >= p_cost
  returning credits into remaining;

  if remaining is null then
    return -1; -- not enough credits
  end if;

  return remaining;
end;
$$;

create or replace function add_credits(p_telegram_id bigint, p_amount integer)
returns integer
language plpgsql
as $$
declare
  new_balance integer;
begin
  update users
  set credits = credits + p_amount
  where telegram_id = p_telegram_id
  returning credits into new_balance;

  return new_balance;
end;
$$;

-- ============================================================
-- Row Level Security
-- Everything here is written/read only via the server (service role key),
-- which bypasses RLS entirely — so no public policies are defined.
-- This forces every request through the API routes, where Telegram
-- initData is verified server-side (see lib/telegram.ts), so nobody can
-- read or spend another user's credits from the browser.
-- ============================================================

alter table users enable row level security;
alter table generations enable row level security;
alter table bot_sessions enable row level security;
alter table orders enable row level security;

-- ============================================================
-- Storage
-- Run this AFTER creating a bucket named "generations" in
-- Storage → New bucket (mark it "Public" — the app relies on public
-- URLs from getPublicUrl() to display images without extra auth calls).
-- ============================================================
