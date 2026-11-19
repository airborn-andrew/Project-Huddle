-- Job costing, the bots that work on it, and the task queue that wakes them.
-- Like the core tables, only the app's server reaches these, with the secret
-- key: row level security is on with no policies.

-- CSI MasterFormat sections the jobs are costed by.
create table public.cost_codes (
  code text primary key check (code ~ '^\d{2} \d{2} \d{2}$'),
  name text not null
);

insert into public.cost_codes (code, name) values
  ('01 50 00', 'Temporary Facilities and Controls'),
  ('01 74 00', 'Cleaning and Waste Management'),
  ('02 41 00', 'Demolition'),
  ('06 10 00', 'Rough Carpentry'),
  ('06 20 00', 'Finish Carpentry'),
  ('06 40 00', 'Architectural Woodwork'),
  ('07 20 00', 'Thermal Protection'),
  ('07 30 00', 'Steep Slope Roofing'),
  ('07 60 00', 'Flashing and Sheet Metal'),
  ('08 10 00', 'Doors and Frames'),
  ('08 50 00', 'Windows'),
  ('09 20 00', 'Plaster and Gypsum Board'),
  ('09 30 00', 'Tiling'),
  ('09 60 00', 'Flooring'),
  ('09 90 00', 'Painting and Coating'),
  ('11 30 00', 'Residential Equipment'),
  ('12 36 00', 'Countertops'),
  ('22 00 00', 'Plumbing'),
  ('23 00 00', 'HVAC'),
  ('26 00 00', 'Electrical'),
  ('32 31 00', 'Fences and Gates');

-- The insurance budget: each component or bid item of the approved estimate.
-- An import arrives as one proposed batch; approving it supersedes the batch
-- before it.
create table public.budget_lines (
  id uuid primary key default gen_random_uuid(),
  slug text not null references public.projects (slug) on delete cascade,
  batch uuid not null,
  source text not null check (source in ('components', 'bid_item', 'manual')),
  kind text not null check (kind in ('material', 'labor', 'equipment', 'other')),
  xact_code text,
  description text not null,
  quantity numeric,
  unit text,
  unit_price numeric,
  amount numeric(12, 2) not null,
  cost_code text references public.cost_codes (code),
  flagged boolean not null default false,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'superseded', 'rejected')),
  created_by text not null,
  created_at timestamptz not null default now()
);
create index budget_lines_slug on public.budget_lines (slug);

-- Money against a cost code: supplements and approved changes to the budget,
-- commitments (accepted bids, quotes, crew plans) and actual costs.
create table public.cost_entries (
  id uuid primary key default gen_random_uuid(),
  slug text not null references public.projects (slug) on delete cascade,
  type text not null check (type in ('budget_change', 'commitment', 'actual')),
  cost_code text references public.cost_codes (code),
  amount numeric(12, 2) not null,
  vendor text,
  description text not null,
  source text,
  reason text,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected')),
  created_by text not null,
  created_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz
);
create index cost_entries_slug on public.cost_entries (slug);

-- How each trade is bought, and the operator's cost to complete when it
-- differs from what the commitments say.
create table public.trades (
  slug text not null references public.projects (slug) on delete cascade,
  cost_code text not null references public.cost_codes (code),
  method text check (method in ('crew', 'sub', 'supplier_crew')),
  cost_to_complete numeric(12, 2),
  note text,
  primary key (slug, cost_code)
);

create table public.job_settings (
  slug text primary key references public.projects (slug) on delete cascade,
  -- Tasks for the job wait for OHI instead of going to the bots.
  manual boolean not null default false,
  -- A trade or the job below this margin gets flagged.
  margin_floor numeric not null default 0.30,
  -- Overhead and profit on the approved estimate.
  overhead_profit numeric(12, 2) not null default 0
);

-- Notes and flags on a job or on one of its records.
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  slug text not null references public.projects (slug) on delete cascade,
  record_type text,
  record_id text,
  body text not null,
  flag text check (flag in ('opportunity', 'rebid', 'check_supplier', 'quote_requested', 'risk')),
  notify boolean not null default false,
  created_by text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index notes_slug on public.notes (slug);

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  token_hash text not null unique,
  task_types text[] not null default '{}',
  webhook_url text,
  paused boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  slug text references public.projects (slug) on delete cascade,
  type text not null,
  input jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'held', 'claimed', 'done', 'failed')),
  agent_id uuid references public.agents (id) on delete set null,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  timeout_seconds integer not null default 900,
  claimed_at timestamptz,
  result jsonb,
  error text,
  created_by text not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index tasks_open on public.tasks (status, created_at);

-- Everything that changes on a job, oldest first, for bots catching up.
create table public.events (
  id bigint generated always as identity primary key,
  slug text references public.projects (slug) on delete cascade,
  type text not null,
  ref text,
  data jsonb not null default '{}',
  actor text not null,
  at timestamptz not null default now()
);
create index events_slug_at on public.events (slug, at);

-- Switches that cover every job: dispatch_paused stops all tasks going out.
create table public.control (
  key text primary key,
  value jsonb not null
);

alter table public.cost_codes enable row level security;
alter table public.budget_lines enable row level security;
alter table public.cost_entries enable row level security;
alter table public.trades enable row level security;
alter table public.job_settings enable row level security;
alter table public.notes enable row level security;
alter table public.agents enable row level security;
alter table public.tasks enable row level security;
alter table public.events enable row level security;
alter table public.control enable row level security;
