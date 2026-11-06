import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Inbox" };

export default function InboxPage() {
  return (
    <>
      <PageHeader title="Inbox" description="Applications that need a quick answer from you." />
      <Card>
        <EmptyState
          icon={Inbox}
          title="All clear"
          description="When a form asks something Orbit can't answer from your profile, like a new screening question or a CAPTCHA, it lands here. Answer once and Orbit remembers it for next time."
        />
      </Card>
    </>
  );
}
