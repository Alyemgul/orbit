import { z } from "zod";

const supabaseEnvSchema = z.object({
  url: z.string().url(),
  anonKey: z.string().min(20),
});

export type SupabaseEnv = z.infer<typeof supabaseEnvSchema>;

/**
 * Public Supabase settings, or null when not configured (preview mode).
 * The process.env references must stay literal so Next inlines them into
 * the client bundle.
 */
export function getSupabaseEnv(): SupabaseEnv | null {
  const parsed = supabaseEnvSchema.safeParse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  return parsed.success ? parsed.data : null;
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseEnv() !== null;
}

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    this.name = "SupabaseNotConfiguredError";
  }
}
