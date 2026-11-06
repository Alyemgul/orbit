/**
 * Typed view of the Postgres schema in supabase/migrations, in the shape
 * supabase-js expects. Hand-maintained until a Supabase project is linked;
 * then regenerate with `npx supabase gen types typescript --linked`.
 */

import type { ApplicationStatus } from "./application-status";
import type {
  AtsType,
  EmploymentType,
  ExperienceLevel,
  JobCategory,
  SalaryPeriod,
  VisaSponsorship,
  WorkplaceType,
} from "./jobs/job";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type ApplicationMode = "auto" | "assisted" | "manual";
export type SwipeDecision = "skip" | "save" | "apply";
export type EventActor = "user" | "system" | "extension";
export type SourceRunStatus = "success" | "empty" | "failed";

/** Columns with defaults become optional on insert. */
type Table<Row, RequiredOnInsert extends keyof Row> = {
  Row: Row;
  Insert: Pick<Row, RequiredOnInsert> & Partial<Omit<Row, RequiredOnInsert>>;
  Update: Partial<Row>;
  Relationships: [];
};

export type ProfileRow = {
  user_id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  location: string | null;
  links: Json;
  work_auth: Json;
  preferences: Json;
  daily_apply_cap: number;
  review_before_send: boolean;
  created_at: string;
  updated_at: string;
};

export type JobRow = {
  id: string;
  dedupe_hash: string;
  source: string;
  source_priority: number;
  source_job_id: string;
  source_url: string | null;
  ats_type: AtsType;
  company: string;
  company_logo_url: string | null;
  title: string;
  location: string;
  country_codes: string[];
  workplace: WorkplaceType;
  employment_type: EmploymentType;
  experience_level: ExperienceLevel;
  category: JobCategory;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: SalaryPeriod | null;
  visa_sponsorship: VisaSponsorship;
  description: string;
  apply_url: string;
  posted_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  closed_at: string | null;
  search: unknown;
};

/** A job as sent to ingest_upsert_jobs. */
export type JobUpsert = Omit<JobRow, "id" | "first_seen_at" | "last_seen_at" | "closed_at" | "search">;

export type SourceRunRow = {
  id: number;
  source: string;
  status: SourceRunStatus;
  started_at: string;
  finished_at: string;
  fetched: number;
  upserted: number;
  closed: number;
  invalid: number;
  error: string | null;
};

export type WatchedCompanyRow = {
  user_id: string;
  ats_type: Extract<AtsType, "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "recruitee">;
  board_token: string;
  company_name: string;
  created_at: string;
};

export type SwipeRow = {
  user_id: string;
  job_id: string;
  decision: SwipeDecision;
  created_at: string;
};

export type ResumeRow = {
  id: string;
  user_id: string;
  title: string;
  is_master: boolean;
  content: Json;
  created_at: string;
  updated_at: string;
};

export type ApplicationRow = {
  id: string;
  user_id: string;
  job_id: string;
  status: ApplicationStatus;
  mode: ApplicationMode;
  resume_variant_id: string | null;
  applied_at: string | null;
  notes: string | null;
  last_error: string | null;
  updated_by: EventActor;
  created_at: string;
  updated_at: string;
};

export type ResumeVariantRow = {
  id: string;
  user_id: string;
  application_id: string;
  base_resume_id: string | null;
  content: Json;
  diff: Json;
  match_score: number | null;
  missing_keywords: string[];
  pdf_path: string | null;
  created_at: string;
};

export type ScreeningAnswerRow = {
  id: string;
  user_id: string;
  question_hash: string;
  question_text: string;
  answer: Json;
  is_sensitive: boolean;
  created_at: string;
  updated_at: string;
};

export type ApplicationTransitionRow = {
  from_status: ApplicationStatus;
  to_status: ApplicationStatus;
};

export type ApplicationEventRow = {
  id: number;
  application_id: string;
  user_id: string;
  type: string;
  from_status: ApplicationStatus | null;
  to_status: ApplicationStatus | null;
  actor: EventActor;
  payload: Json;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow, "user_id" | "email">;
      jobs: Table<JobRow, "dedupe_hash" | "source" | "source_job_id" | "company" | "title" | "apply_url">;
      source_runs: Table<SourceRunRow, "source" | "status" | "started_at">;
      watched_companies: Table<WatchedCompanyRow, "ats_type" | "board_token" | "company_name">;
      swipes: Table<SwipeRow, "job_id" | "decision">;
      resumes: Table<ResumeRow, never>;
      applications: Table<ApplicationRow, "job_id">;
      resume_variants: Table<ResumeVariantRow, "application_id" | "content">;
      screening_answers: Table<ScreeningAnswerRow, "question_hash" | "question_text" | "answer">;
      application_transitions: Table<ApplicationTransitionRow, "from_status" | "to_status">;
      application_events: Table<ApplicationEventRow, never>;
    };
    Views: { [_ in never]: never };
    Functions: {
      ingest_upsert_jobs: { Args: { p_jobs: JobUpsert[] }; Returns: number };
      ingest_close_missing: { Args: { p_source: string; p_seen_before: string }; Returns: number };
      ingest_prune: { Args: { p_retention_days: number }; Returns: number };
    };
    Enums: {
      ats_type: AtsType;
      workplace_type: WorkplaceType;
      employment_type: EmploymentType;
      experience_level: ExperienceLevel;
      job_category: JobCategory;
      visa_sponsorship: VisaSponsorship;
      salary_period: SalaryPeriod;
      application_status: ApplicationStatus;
      application_mode: ApplicationMode;
      swipe_decision: SwipeDecision;
      event_actor: EventActor;
      source_run_status: SourceRunStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
};
