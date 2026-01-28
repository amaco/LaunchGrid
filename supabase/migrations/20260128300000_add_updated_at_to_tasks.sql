-- Add updated_at column to tasks table
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- Update existing rows to have updated_at = created_at
UPDATE tasks SET updated_at = created_at WHERE updated_at IS NULL;
