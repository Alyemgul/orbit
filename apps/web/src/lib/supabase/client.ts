import { createBrowserClient } from "@supabase/ssr";
import { SupabaseNotConfiguredError, getSupabaseEnv } from "@/lib/env";

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

/** Singleton browser client (used for realtime subscriptions and client mutations). */
export function getBrowserClient() {
  const env = getSupabaseEnv();
  if (!env) throw new SupabaseNotConfiguredError();
  browserClient ??= createBrowserClient(env.url, env.anonKey);
  return browserClient;
}
