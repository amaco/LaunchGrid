
-- Fix RLS Policies for tasks table
-- Previously missing, causing "deny all" for users trying to run workflows.

create policy "Users can manage tasks" on tasks
  for all using (
    exists (
      select 1 from projects
      where projects.id = tasks.project_id
      and projects.user_id = auth.uid()
    )
  );
