-- Add config column to workflows table
ALTER TABLE workflows 
ADD COLUMN IF NOT EXISTS config jsonb DEFAULT '{}'::jsonb;

-- Comment for documentation
COMMENT ON COLUMN workflows.config IS 'Configuration settings for the workflow (e.g., approval rules, timeouts)';
