import type { Metadata } from "next";
import { InboxView } from "@/components/inbox/inbox-view";
import { PageHeader } from "@/components/ui/page-header";
import { DEMO_INBOX, DEMO_MEMORY } from "@/lib/demo-inbox";
import { isSupabaseConfigured } from "@/lib/env";
import { fetchAnswerMemory, fetchInbox } from "@/lib/inbox.server";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage() {
  const live = isSupabaseConfigured();
  const user = live ? await getCurrentUser() : null;
  const [items, memory] = live && user ? await Promise.all([fetchInbox(), fetchAnswerMemory()]) : [DEMO_INBOX, DEMO_MEMORY];

  return (
    <>
      <PageHeader
        title="Inbox"
        description={
          live
            ? "Questions the autopilot couldn't answer. Answer once and it remembers for every form."
            : "Sample inbox (preview mode). Nothing is saved."
        }
      />
      <InboxView mode={live ? "live" : "demo"} items={items} memory={memory} />
    </>
  );
}
