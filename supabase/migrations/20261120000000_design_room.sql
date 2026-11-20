-- The Design Room: one layout per room, and every saved version of it.
-- Only the app's server reaches these tables, with the secret key.

create table public.layouts (
  slug text not null references public.projects (slug) on delete cascade,
  room text not null,
  -- The room's walls, doors and windows from the sketch, in inches. Locked.
  shell jsonb not null,
  pieces jsonb not null default '[]',
  status text not null default 'open' check (status in ('open', 'ready', 'locked')),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'ohi' check (updated_by in ('home', 'ohi')),
  primary key (slug, room)
);

create table public.layout_versions (
  id bigint generated always as identity primary key,
  slug text not null,
  room text not null,
  version integer not null,
  pieces jsonb not null,
  saved_at timestamptz not null default now(),
  saved_by text not null check (saved_by in ('home', 'ohi')),
  foreign key (slug, room) references public.layouts (slug, room) on delete cascade,
  unique (slug, room, version)
);

alter table public.layouts enable row level security;
alter table public.layout_versions enable row level security;
