-- =====================================================
-- LaunchGrid: Organizations & Audit Trail Migration
-- Following the Architecture Constitution:
-- - Multi-tenant by design (Org → Projects → Users)
-- - Tenant isolation everywhere
-- - Full audit of AI and user decisions
-- =====================================================

-- Enable pgcrypto for secure operations
create extension if not exists "pgcrypto";

-- =====================================================
-- ORGANIZATIONS TABLE
-- =====================================================

create table if not exists organizations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  settings jsonb default '{
    "maxProjects": 10,
    "maxUsersPerProject": 5,
    "features": ["basic"],
    "billingPlan": "free"
  }'::jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Organization members junction table
create table if not exists organization_members (
  organization_id uuid references organizations(id) on delete cascade,
  user_id uuid references auth.users not null,
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamp with time zone default now(),
  primary key (organization_id, user_id)
);

-- =====================================================
-- ADD ORGANIZATION_ID TO EXISTING TABLES
-- =====================================================

-- Add organization_id to projects (with default for migration)
do $$ 
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'projects' and column_name = 'organization_id'
  ) then
    alter table projects add column organization_id uuid;
  end if;
end $$;

-- Add status column if not exists
do $$ 
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'projects' and column_name = 'status'
  ) then
    alter table projects add column status text default 'draft';
  end if;
end $$;

-- Add updated_at column if not exists
do $$ 
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'projects' and column_name = 'updated_at'
  ) then
    alter table projects add column updated_at timestamp with time zone default now();
  end if;
end $$;

-- =====================================================
-- AUDIT LOG TABLE
-- =====================================================

create table if not exists audit_logs (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid,
  user_id uuid not null,
  action text not null,
  resource_type text not null,
  resource_id text not null,
  changes jsonb,
  metadata jsonb default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamp with time zone default now()
);

-- Create index for efficient querying
create index if not exists idx_audit_logs_org on audit_logs(organization_id);
create index if not exists idx_audit_logs_user on audit_logs(user_id);
create index if not exists idx_audit_logs_resource on audit_logs(resource_type, resource_id);
create index if not exists idx_audit_logs_created on audit_logs(created_at desc);

-- =====================================================
-- EVENTS TABLE (Event Sourcing)
-- =====================================================

create table if not exists domain_events (
  id uuid primary key default uuid_generate_v4(),
  event_type text not null,
  aggregate_id uuid not null,
  aggregate_type text not null,
  organization_id uuid,
  user_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  version integer not null,
  occurred_at timestamp with time zone default now()
);

-- Create indexes for event queries
create index if not exists idx_events_aggregate on domain_events(aggregate_type, aggregate_id);
create index if not exists idx_events_org on domain_events(organization_id);
create index if not exists idx_events_type on domain_events(event_type);
create index if not exists idx_events_occurred on domain_events(occurred_at desc);

-- =====================================================
-- API KEYS TABLE (For extension/external access)
-- =====================================================

create table if not exists api_keys (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null,
  organization_id uuid references organizations(id) on delete cascade,
  name text not null,
  key_hash text not null, -- Store hash of the key, not the key itself
  key_prefix text not null, -- First 8 chars for identification (e.g., "lg_live_...")
  scopes text[] default '{}', -- e.g., ['read:projects', 'write:tasks']
  last_used_at timestamp with time zone,
  expires_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  revoked_at timestamp with time zone
);

create index if not exists idx_api_keys_hash on api_keys(key_hash);
create index if not exists idx_api_keys_user on api_keys(user_id);

-- =====================================================
-- ENHANCED TASKS TABLE
-- =====================================================

-- Add retry_count and error tracking if not exists
do $$ 
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'tasks' and column_name = 'retry_count'
  ) then
    alter table tasks add column retry_count integer default 0;
  end if;
  
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'tasks' and column_name = 'error_message'
  ) then
    alter table tasks add column error_message text;
  end if;
  
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'tasks' and column_name = 'started_at'
  ) then
    alter table tasks add column started_at timestamp with time zone;
  end if;
end $$;

-- =====================================================
-- WORKFLOW CONFIG ENHANCEMENT
-- =====================================================

-- Add config column if not exists
do $$ 
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'workflows' and column_name = 'config'
  ) then
    alter table workflows add column config jsonb default '{
      "requiresApproval": true,
      "maxRetries": 3,
      "timeout": 30000
    }'::jsonb;
  end if;
  
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'workflows' and column_name = 'updated_at'
  ) then
    alter table workflows add column updated_at timestamp with time zone default now();
  end if;
end $$;

-- =====================================================
-- RLS POLICIES FOR NEW TABLES
-- =====================================================

-- Organizations RLS
alter table organizations enable row level security;

create policy "Users can view their organizations" on organizations
  for select using (
    exists (
      select 1 from organization_members
      where organization_members.organization_id = organizations.id
      and organization_members.user_id = auth.uid()
    )
  );

-- Organization members RLS
alter table organization_members enable row level security;

create policy "Users can view organization members" on organization_members
  for select using (user_id = auth.uid());

create policy "Admins can manage organization members" on organization_members
  for all using (
    exists (
      select 1 from organization_members om
      where om.organization_id = organization_members.organization_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'admin')
    )
  );

-- Audit logs RLS (read-only for users, their own logs)
alter table audit_logs enable row level security;

create policy "Users can view their audit logs" on audit_logs
  for select using (user_id = auth.uid());

-- Domain events RLS
alter table domain_events enable row level security;

create policy "Users can view their events" on domain_events
  for select using (user_id = auth.uid());

-- API keys RLS
alter table api_keys enable row level security;

create policy "Users can manage their API keys" on api_keys
  for all using (user_id = auth.uid());

-- =====================================================
-- UPDATE FUNCTION FOR TIMESTAMPS
-- =====================================================

create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Apply to projects
drop trigger if exists update_projects_updated_at on projects;
create trigger update_projects_updated_at
  before update on projects
  for each row execute function update_updated_at_column();

-- Apply to workflows
drop trigger if exists update_workflows_updated_at on workflows;
create trigger update_workflows_updated_at
  before update on workflows
  for each row execute function update_updated_at_column();

-- Apply to organizations
drop trigger if exists update_organizations_updated_at on organizations;
create trigger update_organizations_updated_at
  before update on organizations
  for each row execute function update_updated_at_column();

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to create an organization for a user (for migration)
create or replace function create_default_organization_for_user(p_user_id uuid)
returns uuid as $$
declare
  v_org_id uuid;
  v_slug text;
begin
  -- Generate a unique slug
  v_slug := 'org-' || substr(md5(random()::text), 1, 8);
  
  -- Create organization
  insert into organizations (name, slug)
  values ('My Organization', v_slug)
  returning id into v_org_id;
  
  -- Add user as owner
  insert into organization_members (organization_id, user_id, role)
  values (v_org_id, p_user_id, 'owner');
  
  return v_org_id;
end;
$$ language plpgsql security definer;

-- Function to get user's default organization
create or replace function get_user_default_organization(p_user_id uuid)
returns uuid as $$
declare
  v_org_id uuid;
begin
  -- Get the first organization where user is owner
  select organization_id into v_org_id
  from organization_members
  where user_id = p_user_id and role = 'owner'
  order by created_at
  limit 1;
  
  -- If no organization, create one
  if v_org_id is null then
    v_org_id := create_default_organization_for_user(p_user_id);
  end if;
  
  return v_org_id;
end;
$$ language plpgsql security definer;
