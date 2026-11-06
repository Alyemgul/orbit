import { FileText } from "lucide-react";
import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Resume" };

export default function ResumePage() {
  return (
    <>
      <PageHeader title="Resume" description="Your master resume and every tailored version sent." />
      <Card>
        <EmptyState
          icon={FileText}
          title="No master resume yet"
          description="Your master resume is the single source of truth. Orbit tailors a copy for each job, only rewording and reordering what's in it, and never adds facts you didn't write."
        />
      </Card>
    </>
  );
}
