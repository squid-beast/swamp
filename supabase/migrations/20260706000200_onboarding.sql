-- First-run onboarding flag on profiles. Existing accounts are marked onboarded
-- so only genuinely new sign-ups see the welcome flow. Run after 0003.

alter table public.profiles add column if not exists onboarded boolean not null default false;

-- Don't show onboarding to people who already have accounts.
update public.profiles set onboarded = true where onboarded = false;
