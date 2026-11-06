import type { Database } from "@orbit/core";
import { createBrowserClient } from "@supabase/ssr";
import { SupabaseNotConfiguredError, getSupabaseEnv } from "@/lib/env";

let browserClient: ReturnType<typeof createBrowserClient<Database>> | undefined;

/** Singleton browser client (used for realtime subscriptions and client mutations). */
export function getBrowserClient() {
  const env = getSupabaseEnv();
  if (!env) throw new SupabaseNotConfiguredError();
  browserClient ??= createBrowserClient<Database>(env.url, env.anonKey);
  return browserClient;
}
