-- Orbit 0003: categories for CS-skilled roles outside pure software.
--   quant         : quant developer/researcher, trading engineer, trader
--   tech_business : technology analyst, consultant, solutions/implementation, forward deployed
-- Values are appended (Postgres enums only grow at the end); mirrors packages/core JOB_CATEGORIES.

alter type public.job_category add value if not exists 'quant';
alter type public.job_category add value if not exists 'tech_business';
