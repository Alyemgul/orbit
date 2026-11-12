-- Orbit 0009: categories for roles in other fields that use CS skills,
-- kept apart from the computer-science categories.
--   finance          : risk, investment, banking, financial analyst, fintech operations
--   legal_compliance : legal engineer / technologist, compliance, KYC/AML, privacy, regulatory
--   health_bio       : bioinformatics, computational biology, clinical and health data
-- Values are appended (Postgres enums only grow at the end); mirrors packages/core JOB_CATEGORIES.

alter type public.job_category add value if not exists 'finance';
alter type public.job_category add value if not exists 'legal_compliance';
alter type public.job_category add value if not exists 'health_bio';
