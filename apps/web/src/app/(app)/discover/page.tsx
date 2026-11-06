import { ArrowLeft, ArrowRight, ArrowUp, Compass, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Discover" };

const GESTURES: { icon: LucideIcon; label: string; detail: string; key: string }[] = [
  { icon: ArrowRight, label: "Swipe right", detail: "Tailor your resume and apply", key: "→" },
  { icon: ArrowUp, label: "Swipe up", detail: "Save for later", key: "↑" },
  { icon: ArrowLeft, label: "Swipe left", detail: "Skip, and see fewer like it", key: "←" },
];

export default function DiscoverPage() {
  return (
    <>
      <PageHeader title="Discover" description="New jobs matched to you, refreshed every few hours." />
      <Card>
        <EmptyState
          icon={Compass}
          title="Your deck is on its way"
          description="Orbit pulls fresh postings from company career sites and job boards every few hours. Once jobs arrive, they show up here as a swipe deck."
        >
          <ul className="grid gap-3 text-left sm:grid-cols-3">
            {GESTURES.map(({ icon: Icon, label, detail, key }) => (
              <li key={label} className="flex items-start gap-3 rounded-xl border bg-surface-2 p-3">
                <Icon className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted">{detail}</p>
                  <p className="mt-1.5 text-xs text-muted">
                    Desktop: <kbd className="rounded border bg-surface px-1 font-mono">{key}</kbd>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </EmptyState>
      </Card>
    </>
  );
}
