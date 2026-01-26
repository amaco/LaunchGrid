
-- Fix RLS Policies for child tables (Pillars, Workflows, Steps)

-- Policy: Pillars are accessible if the user owns the parent project
create policy "Users can manage pillars of their projects" on pillars
  for all using (
    exists (
      select 1 from projects
      where projects.id = pillars.project_id
      and projects.user_id = auth.uid()
    )
  );

-- Policy: Workflows are accessible if the user owns the parent project
create policy "Users can manage workflows of their projects" on workflows
  for all using (
    exists (
      select 1 from projects
      where projects.id = workflows.project_id
      and projects.user_id = auth.uid()
    )
  );

-- Policy: Steps accessible via project ownership
-- Note: steps table usually has workflow_id, so we join up
create policy "Users can manage steps" on steps
  for all using (
    exists (
      select 1 from workflows
      join projects on projects.id = workflows.project_id
      where workflows.id = steps.workflow_id
      and projects.user_id = auth.uid()
    )
  );
