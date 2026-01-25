-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Projects: The root entity
create table projects (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null, -- Links to Supabase Auth
  name text not null,
  context jsonb default '{}'::jsonb, -- Target audience, budget, etc.
  created_at timestamp with time zone default now()
);

-- Pillars: Active mediums for a project
create table pillars (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  type text not null, -- 'discord', 'twitter', 'email', 'custom'
  name text not null,
  config jsonb default '{}'::jsonb, -- OAuth tokens (encrypted) or settings
  status text default 'active',
  created_at timestamp with time zone default now()
);

-- Workflows: Sequences of steps
create table workflows (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  pillar_id uuid references pillars(id),
  name text not null,
  description text,
  phase text default 'launch', -- 'foundation', 'launch', 'scale'
  status text default 'draft',
  created_at timestamp with time zone default now()
);

-- Steps: The atomic LEGO blocks
create table steps (
  id uuid primary key default uuid_generate_v4(),
  workflow_id uuid references workflows(id) on delete cascade,
  type text not null, -- 'GENERATE_DRAFT', 'SCAN_TRENDS', 'POST_API', 'POST_EXTENSION'
  config jsonb default '{}'::jsonb, -- Template ID, prompts, criteria
  dependency_ids uuid[] default '{}', -- Array of step_ids this step waits for
  position integer not null, -- Order in the workflow
  created_at timestamp with time zone default now()
);

-- Tasks: The execution instances of Steps
create table tasks (
  id uuid primary key default uuid_generate_v4(),
  step_id uuid references steps(id),
  project_id uuid references projects(id),
  status text default 'pending', -- 'pending', 'in_progress', 'review_needed', 'completed', 'failed'
  output_data jsonb default '{}'::jsonb, -- The AI draft, the found URL, etc.
  scheduled_for timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

-- Row Level Security (RLS)
alter table projects enable row level security;
alter table pillars enable row level security;
alter table workflows enable row level security;
alter table steps enable row level security;
alter table tasks enable row level security;

-- Basic Policy: Users see their own projects
create policy "Users can own projects" on projects
  for all using (auth.uid() = user_id);
-- (Additional policies needed for cascading access)
