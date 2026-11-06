import type { Metadata } from "next";
import { ThemeSwitcher } from "@/components/shell/theme-switcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const user = await getCurrentUser();

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
            <CardTitle>Appearance</CardTitle>
            <CardDescription>Follow your device, or pick a theme.</CardDescription>
          </CardHeader>
          <CardContent>
            <ThemeSwitcher showLabels />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
