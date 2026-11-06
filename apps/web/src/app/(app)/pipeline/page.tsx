import { PIPELINE_COLUMNS } from "@orbit/core";
import { Columns3 } from "lucide-react";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Pipeline" };

export default function PipelinePage() {
  return (
    <>
      <PageHeader title="Pipeline" description="Every application, updated automatically as Orbit applies." />

      {/* Column summary: fits the viewport on every screen size, no sideways scrolling. */}
      <ul className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {PIPELINE_COLUMNS.map((column) => (
          <li key={column.id} className="flex items-center justify-between rounded-xl border bg-surface px-3 py-2.5">
            <span className="text-sm font-medium">{column.label}</span>
            <Badge>0</Badge>
          </li>
        ))}
      </ul>

      <Card>
        <EmptyState
          icon={Columns3}
          title="No applications yet"
          description="Swipe right on a job in Discover. Its card appears here and moves on its own: Applying, then Applied once the form is submitted. Drag cards yourself when you hear back."
        />
      </Card>
    </>
  );
}
