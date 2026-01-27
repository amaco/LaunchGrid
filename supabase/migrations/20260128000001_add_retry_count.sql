-- Add retry_count column to tasks table
alter table tasks 
add column if not exists retry_count integer default 0;

-- Optional: Comments for clarity
comment on column tasks.retry_count is 'Number of times this task has been retried';
