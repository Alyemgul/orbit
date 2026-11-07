import type { Metadata } from "next";
import { ResumeWorkspace } from "@/components/resume/resume-workspace";
import { PageHeader } from "@/components/ui/page-header";
import { isSupabaseConfigured } from "@/lib/env";
import { fetchMasterResume, fetchRecentVersions } from "@/lib/resume.server";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Resume" };

export default async function ResumePage() {
  const live = isSupabaseConfigured();
  const user = live ? await getCurrentUser() : null;
  const [master, versions] = live && user ? await Promise.all([fetchMasterResume(), fetchRecentVersions()]) : [null, []];

  return (
    <>
      <PageHeader
        title="Resume"
        description={
          live
            ? "Your master resume is the single source of truth. Tailored copies only reorder and reword it, never add facts."
            : "Sample resume (preview mode). Edits are saved in this browser only."
        }
      />
      <ResumeWorkspace
        mode={live ? "live" : "demo"}
        initial={master?.resume ?? null}
        updatedAt={master?.updatedAt ?? null}
        versions={versions}
      />
    </>
  );
}
