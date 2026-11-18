-- Only the app's server reaches these tables, with the secret key. Row level
-- security is on with no policies, so the public keys can read or write nothing.

create table public.projects (
  slug text primary key check (slug ~ '^[a-z0-9]+$'),
  name text not null,
  home_code text not null check (home_code ~ '^[0-9]{6}$'),
  status text not null default 'draft' check (status in ('draft', 'live', 'done')),
  plan jsonb not null,
  phases jsonb not null,
  model text not null,
  created_at timestamptz not null default now()
);

create table public.project_states (
  slug text primary key references public.projects (slug) on delete cascade,
  state jsonb not null,
  version integer not null default 0,
  updated_at timestamptz not null default now()
);

create table public.code_locks (
  key text primary key,
  fails integer not null default 0,
  locked_until timestamptz
);

alter table public.projects enable row level security;
alter table public.project_states enable row level security;
alter table public.code_locks enable row level security;
