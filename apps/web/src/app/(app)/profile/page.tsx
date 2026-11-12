import type { Metadata } from "next";
import { ThemeSwitcher } from "@/components/shell/theme-switcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ApplyCapForm } from "@/components/profile/apply-cap-form";
import { AutopilotCard, GmailCard } from "@/components/profile/autopilot-cards";
import { DataCard } from "@/components/profile/data-card";
import { ProgressRing } from "@/components/stats/rings";
import { getLlmConfig } from "@/lib/llm.server";
import { fetchConnections } from "@/lib/inbox.server";
import { fetchLlmUsage } from "@/lib/resume.server";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const user = await getCurrentUser();
  const llm = getLlmConfig();
  const [profile, usage, connections] = user
    ? await Promise.all([
        createClient().then((supabase) =>
          supabase.from("profiles").select("daily_apply_cap, review_before_send, preferences").eq("user_id", user.id).maybeSingle(),
        ),
        fetchLlmUsage(),
        fetchConnections(),
      ])
    : [null, null, []];
  const cap = profile?.data?.daily_apply_cap ?? 15;
  const preferences = profile?.data?.preferences;
  const acceptPrivacy =
    typeof preferences === "object" && preferences !== null && !Array.isArray(preferences) && preferences.autopilot_accept_privacy === true;

  return (
    <>
      <PageHeader title="Profile" description="Account and app settings." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>
              {user ? "Signed in with a one-time email link." : "Preview mode: not signed in."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium">{user?.email ?? "—"}</p>
            {user ? (
              <form action="/auth/signout" method="post">
                <Button type="submit" variant="secondary" size="sm">
                  Sign out
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Daily apply limit</CardTitle>
            <CardDescription>
              Right swipes past this limit are saved for later instead of queued. Up to 200.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ApplyCapForm initial={cap} disabled={!user} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI rewording</CardTitle>
            <CardDescription>
              {llm
                ? `Using ${llm.label} (${llm.model}${llm.fallbackModel ? `, falls back to ${llm.fallbackModel}` : ""}). Repeat requests for the same job reuse earlier answers for free.`
                : "Off. Add LLM_PROVIDER (groq) and LLM_API_KEY (a free key from console.groq.com) to your host's environment variables, e.g. Vercel → Settings → Environment Variables, then redeploy."}
            </CardDescription>
          </CardHeader>
          {llm && usage ? (
            <CardContent className="flex items-center gap-3">
              <ProgressRing value={usage.used} max={usage.limit} size={48} stroke={5} label={`${usage.used} of ${usage.limit} AI rewrites used today`}>
                <span className="text-xs font-semibold tabular-nums">{usage.used}</span>
              </ProgressRing>
              <p className="text-sm text-muted">
                {usage.used} of {usage.limit} used in the last 24 hours. The free provider may run out sooner; Orbit then
                switches to the lighter model, and tailoring without AI always works.
              </p>
            </CardContent>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>Follow your device, or pick a theme.</CardDescription>
          </CardHeader>
          <CardContent>
            <ThemeSwitcher showLabels />
          </CardContent>
        </Card>

        <AutopilotCard
          connection={connections.find((c) => c.kind === "extension") ?? null}
          review={profile?.data?.review_before_send ?? false}
          acceptPrivacy={acceptPrivacy}
          disabled={!user}
        />
        <GmailCard connection={connections.find((c) => c.kind === "gmail") ?? null} disabled={!user} />
        <DataCard disabled={!user} />


      </div>
    </>
  );
}
