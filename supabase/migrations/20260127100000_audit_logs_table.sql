-- Audit Logs Table for persistent audit trail
-- Following the constitution: "Observability and audit trail are first-class"

create table audit_logs (
    id text primary key,
    organization_id uuid not null,
    user_id uuid not null,
    action text not null,
    resource_type text not null,
    resource_id text not null,
    changes jsonb,
    metadata jsonb,
    created_at timestamptz not null default now()
);

-- Indexes for efficient querying
create index idx_audit_logs_org on audit_logs(organization_id);
create index idx_audit_logs_user on audit_logs(user_id);
create index idx_audit_logs_resource on audit_logs(resource_type, resource_id);
create index idx_audit_logs_action on audit_logs(action);
create index idx_audit_logs_created on audit_logs(created_at desc);

-- Enable RLS
alter table audit_logs enable row level security;

-- Policy: Users can only view their org's audit logs
create policy "Users can view org audit logs" on audit_logs
    for select using (
        organization_id in (
            select id from projects where user_id = auth.uid()
        )
    );

-- Policy: System can insert (service role bypasses RLS anyway)
-- Audit logs are immutable - no update/delete policies

comment on table audit_logs is 'Immutable audit trail for all system actions';
