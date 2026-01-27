-- Add missing columns to tasks table
-- retry_count might have been added by the previous file, so we use IF NOT EXISTS just in case
alter table tasks 
add column if not exists retry_count integer default 0,
add column if not exists started_at timestamp with time zone,
add column if not exists error_message text;

comment on column tasks.started_at is 'When the task actually started execution';
comment on column tasks.error_message is 'Last error message if failed';
