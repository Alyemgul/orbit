import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { SupabaseNotConfiguredError, getSupabaseEnv } from "@/lib/env";

/** Supabase client bound to the request's auth cookies (Server Components, actions, route handlers). */
export async function createClient() {
  const env = getSupabaseEnv();
  if (!env) throw new SupabaseNotConfiguredError();

  const cookieStore = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies; the middleware refreshes the session instead.
        }
      },
    },
  });
}

/** The verified signed-in user, or null when signed out or in preview mode. */
export async function getCurrentUser(): Promise<User | null> {
  if (!getSupabaseEnv()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user;
}
