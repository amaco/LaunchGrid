
-- User Secrets: Store API keys per user
create table user_secrets (
  user_id uuid references auth.users not null primary key,
  openai_key text,
  gemini_key text,
  twitter_token text,
  discord_token text,
  updated_at timestamp with time zone default now()
);

-- RLS: Strict access
alter table user_secrets enable row level security;

create policy "Users can manage their own secrets" on user_secrets
  for all using (auth.uid() = user_id);
