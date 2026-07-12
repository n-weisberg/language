-- Run this once in the Supabase SQL editor (Dashboard → SQL).
-- Simple shared progress for a few friends — open policies (private app / trusted users).

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists progress (
  profile_id uuid primary key references profiles (id) on delete cascade,
  lessons jsonb not null default '{"lessons":{},"lastLesson":null}'::jsonb,
  flashcards jsonb not null default '{"level":1,"mode":"en-es","voiceSpeed":1,"byMode":{"en-es":{"reviewCount":0,"cards":{},"known":{},"again":{}},"es-en":{"reviewCount":0,"cards":{},"known":{},"again":{}},"listen":{"reviewCount":0,"cards":{},"known":{},"again":{}}},"lastCardId":null,"scheduleVersion":0}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;
alter table progress enable row level security;

drop policy if exists "profiles open" on profiles;
create policy "profiles open" on profiles
  for all
  using (true)
  with check (true);

drop policy if exists "progress open" on progress;
create policy "progress open" on progress
  for all
  using (true)
  with check (true);
