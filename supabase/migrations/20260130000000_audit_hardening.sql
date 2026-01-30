-- Audit & Hardening: Performance Indices

-- Index for Zombie Task Recovery
-- This query is run frequently: .eq('status', 'in_progress').lt('started_at', ...)
CREATE INDEX IF NOT EXISTS idx_tasks_status_started_at ON tasks(status, started_at);

-- Index for finding tasks by project/user (common pattern)
CREATE INDEX IF NOT EXISTS idx_tasks_project_created_mid ON tasks(project_id, created_at DESC);
