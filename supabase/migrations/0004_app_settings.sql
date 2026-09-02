-- App level settings for the Ads Manager frontend: tiny key/value store.
-- First use: tiktok_assumed_conversion_value - a manually set assumed $ per
-- result for TikTok, because the TikTok account has no trustworthy
-- purchase value metric (see 0001 grain notes). The frontend multiplies
-- platform reported purchases by this value and marks the resulting
-- Conversion value / ROAS as ESTIMATES everywhere they render.
--
-- NOT applied live by this repo; the main session applies it.

create table if not exists public.app_settings (
  key         text        primary key,
  value       jsonb       not null,
  updated_at  timestamptz not null default now()
);

alter table public.app_settings enable row level security;

create policy app_settings_admin_all on public.app_settings
  for all using (private.is_admin()) with check (private.is_admin());

insert into public.app_settings (key, value)
values ('tiktok_assumed_conversion_value', '40'::jsonb)
on conflict (key) do nothing;
