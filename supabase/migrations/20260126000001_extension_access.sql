
-- Allow unauthenticated clients to read tasks that are specifically waiting for the extension
CREATE POLICY "Allow anon to read extension_queued tasks"
ON tasks
FOR SELECT
TO anon
USING (status = 'extension_queued');

-- Allow unauthenticated clients to update tasks that are extension_queued
CREATE POLICY "Allow anon to update extension_queued tasks"
ON tasks
FOR UPDATE
TO anon
USING (status = 'extension_queued')
WITH CHECK (status = 'review_needed');
