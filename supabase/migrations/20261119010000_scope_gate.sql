-- The scope gate: a supplement, commitment or cost counts toward a job only
-- when its section is in the carrier-approved estimate, or OHI decides what
-- happens to it. Existing entries are in scope.
alter table public.cost_entries
  add column scope text not null default 'in_scope'
    check (scope in ('in_scope', 'review', 'homeowner', 'supplement', 'discarded')),
  -- The approved estimate lines the entry covers, when the bot or OHI names them.
  add column covers uuid[] not null default '{}',
  -- The Huddle change order that asks the homeowner to pay for it.
  add column change_order text,
  add column scope_decided_by text,
  add column scope_decided_at timestamptz;
