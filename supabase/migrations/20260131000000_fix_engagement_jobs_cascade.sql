-- Fix engagement jobs cascade deletion
-- The user reported that deleting a workflow leaves orphaned jobs.
-- This is because engagement_jobs.source_task_id has ON DELETE SET NULL.
-- We must change it to ON DELETE CASCADE.

-- 1. Drop existing constraint
-- Note: Assuming standard naming convention. If it fails, we might need a DO block to find it.
ALTER TABLE engagement_jobs 
DROP CONSTRAINT IF EXISTS engagement_jobs_source_task_id_fkey;

-- 2. Add new constraint with CASCADE
ALTER TABLE engagement_jobs
ADD CONSTRAINT engagement_jobs_source_task_id_fkey
FOREIGN KEY (source_task_id)
REFERENCES tasks(id)
ON DELETE CASCADE;
