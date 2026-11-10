import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

/** Downloads everything Orbit stores about the signed-in user as one JSON file. */
export async function GET() {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Preview mode has no stored data." }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("export_my_data");
  if (error) {
    console.error(`[orbit] export: ${error.code} ${error.message}`);
    return NextResponse.json({ error: "Couldn't export your data. Did you run migration 0008?" }, { status: 500 });
  }
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="orbit-export-${date}.json"`,
      "cache-control": "no-store",
    },
  });
}
