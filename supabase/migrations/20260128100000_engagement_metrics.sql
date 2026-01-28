-- Engagement Metrics Table
-- Tracks interactions on posted replies/content
-- Following the constitution: "Analytics Service - Metrics, CAC, LTV, performance"

create table engagement_metrics (
    id text primary key,
    project_id uuid not null references projects(id) on delete cascade,
    task_id uuid not null references tasks(id) on delete cascade,
    
    -- What was posted
    platform text not null default 'twitter', -- twitter, discord, etc.
    post_type text not null, -- 'reply', 'post', 'thread'
    post_url text, -- URL to the posted content
    original_target_author text, -- Who we replied to
    original_post_text text, -- Original tweet text
    our_reply_text text, -- What we posted
    
    -- Engagement metrics (updated over time)
    likes integer default 0,
    replies integer default 0,
    retweets integer default 0,
    impressions integer default 0,
    profile_clicks integer default 0,
    link_clicks integer default 0,
    
    -- Qualitative metrics
    received_dms boolean default false,
    received_follows boolean default false,
    received_positive_replies boolean default false,
    
    -- Status
    status text default 'pending', -- pending, posted, archived
    posted_at timestamptz,
    last_checked_at timestamptz,
    
    -- Metadata
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    metadata jsonb
);

-- Indexes
create index idx_engagement_project on engagement_metrics(project_id);
create index idx_engagement_task on engagement_metrics(task_id);
create index idx_engagement_status on engagement_metrics(status);
create index idx_engagement_posted on engagement_metrics(posted_at desc);

-- Enable RLS
alter table engagement_metrics enable row level security;

-- Policy: Users can view/manage their own project's engagement
create policy "Users can view own engagement" on engagement_metrics
    for select using (
        project_id in (select id from projects where user_id = auth.uid())
    );

create policy "Users can insert own engagement" on engagement_metrics
    for insert with check (
        project_id in (select id from projects where user_id = auth.uid())
    );

create policy "Users can update own engagement" on engagement_metrics
    for update using (
        project_id in (select id from projects where user_id = auth.uid())
    );

comment on table engagement_metrics is 'Tracks engagement metrics for posted content - part of Analytics Service';
