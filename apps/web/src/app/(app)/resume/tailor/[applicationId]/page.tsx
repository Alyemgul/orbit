import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { TailorView } from "@/components/resume/tailor-view";
import { PageHeader } from "@/components/ui/page-header";
import { DEMO_JOBS, DEMO_PIPELINE } from "@/lib/demo";
import { isSupabaseConfigured } from "@/lib/env";
import { getLlmConfig } from "@/lib/llm.server";
import { fetchLlmUsage, fetchMasterResume, fetchTailorContext, type TailorJob } from "@/lib/resume.server";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Tailor resume" };

type Params = Promise<{ applicationId: string }>;

export default async function TailorPage({ params }: { params: Params }) {
  const parsed = z.uuid().safeParse((await params).applicationId);
  if (!parsed.success) notFound();
  const applicationId = parsed.data;
  const live = isSupabaseConfigured();
  const user = live ? await getCurrentUser() : null;

  if (!live || !user) {
    const item = DEMO_PIPELINE.find((i) => i.id === applicationId);
    const job = item && DEMO_JOBS.find((j) => j.id === item.job_id);
    if (!job) notFound();
    const demoJob: TailorJob = { title: job.title, company: job.company, location: job.location, description: job.description, applyUrl: job.applyUrl };
    return (
      <>
        <PageHeader title="Tailor resume" description="Preview mode: tailoring the sample resume. Nothing is saved." />
        <TailorView mode="demo" applicationId={applicationId} job={demoJob} master={null} latest={null} aiLabel={null} aiUsage={null} />
      </>
    );
  }

  const master = await fetchMasterResume();
  const [context, usage] = await Promise.all([fetchTailorContext(applicationId, master), fetchLlmUsage()]);
  if (!context) notFound();
  const llm = getLlmConfig();

  return (
    <>
      <PageHeader title="Tailor resume" description="Your master resume, reordered and reworded for this one job. Every change is fact-checked." />
      <TailorView
        mode="live"
        applicationId={applicationId}
        job={context.job}
        master={master?.resume ?? null}
        latest={context.latest}
        aiLabel={llm ? llm.chain.map((p) => p.label).join(" + ") : null}
        aiUsage={llm ? usage : null}
      />
    </>
  );
}
