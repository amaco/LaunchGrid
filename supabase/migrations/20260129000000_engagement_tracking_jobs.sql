-- Create enum for job status
CREATE TYPE engagement_job_status AS ENUM ('active', 'completed', 'expired', 'stopped');

-- Create helper function for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create engagement_jobs table
CREATE TABLE engagement_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL, -- Optional link to original task
    
    target_url TEXT NOT NULL,
    current_status engagement_job_status DEFAULT 'active',
    
    -- Schedule Logic
    started_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    check_interval_minutes INTEGER DEFAULT 60,
    last_checked_at TIMESTAMPTZ,
    next_check_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Metrics Storage (Latest Snapshot)
    last_metrics JSONB DEFAULT '{}'::jsonb,
    
    -- History (simplified array of snapshots)
    metric_history JSONB[] DEFAULT ARRAY[]::jsonb[],
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices for performance
CREATE INDEX idx_engagement_jobs_project_id ON engagement_jobs(project_id);
CREATE INDEX idx_engagement_jobs_status_next_check ON engagement_jobs(current_status, next_check_at);
CREATE INDEX idx_engagement_jobs_source_task ON engagement_jobs(source_task_id);

-- RLS Policies
ALTER TABLE engagement_jobs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can see jobs for their projects
CREATE POLICY "Users can view engagement jobs for their projects"
    ON engagement_jobs FOR SELECT
    USING (
        project_id IN (
            SELECT id FROM projects WHERE user_id = auth.uid()
        )
    );

-- Policy: Users can insert/update jobs for their projects
CREATE POLICY "Users can manage engagement jobs for their projects"
    ON engagement_jobs FOR ALL
    USING (
        project_id IN (
            SELECT id FROM projects WHERE user_id = auth.uid()
        )
    );

-- Policy: Service Role (Extension) needs access
-- Note: Service role bypasses RLS, but explicit grant is good practice if we ever use a restricted role
GRANT ALL ON engagement_jobs TO postgres, service_role;

-- Trigger for updated_at
CREATE TRIGGER update_engagement_jobs_updated_at
    BEFORE UPDATE ON engagement_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
