ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS payroll_cycle_start_day integer DEFAULT 1 NOT NULL;
