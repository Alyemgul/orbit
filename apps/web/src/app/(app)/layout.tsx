import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentUser } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();

  return (
    <AppShell email={user?.email ?? null} backendConfigured={isSupabaseConfigured()}>
      {children}
    </AppShell>
  );
}
