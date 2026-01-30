-- Change foreign key to ON DELETE CASCADE
ALTER TABLE engagement_jobs DROP CONSTRAINT IF EXISTS engagement_jobs_source_task_id_fkey;

ALTER TABLE engagement_jobs
    ADD CONSTRAINT engagement_jobs_source_task_id_fkey
    FOREIGN KEY (source_task_id)
    REFERENCES tasks(id)
    ON DELETE CASCADE;
