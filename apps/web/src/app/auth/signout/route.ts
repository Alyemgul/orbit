import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/** POST-only so a stray link or prefetch can never sign the user out. */
export async function POST(request: NextRequest) {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();
    if (error) console.error("Sign-out failed:", error.message);
  }
  // 303 turns the form POST into a GET of the login page.
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
