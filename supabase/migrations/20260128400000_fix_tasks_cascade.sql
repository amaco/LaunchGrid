-- Fix tasks deletion when deleting workflows/steps
-- The user reported: update or delete on table "steps" violates foreign key constraint "tasks_step_id_fkey" on table "tasks"

-- Drop the restrictive constraint
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_step_id_fkey;

-- Re-add with CASCADE
ALTER TABLE tasks
    ADD CONSTRAINT tasks_step_id_fkey
    FOREIGN KEY (step_id)
    REFERENCES steps(id)
    ON DELETE CASCADE;
