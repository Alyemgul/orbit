"use client";

import { Download, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { deleteAccount } from "@/app/(app)/profile/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { clearOfflineData } from "@/lib/offline";

const PHRASE = "delete my account";

export function DataCard({ disabled }: { disabled: boolean }) {
  const toast = useToast();
  const dialog = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirmDelete() {
    setBusy(true);
    const result = await deleteAccount(typed.trim().toLowerCase());
    if (!result.ok) {
      setBusy(false);
      return toast({ message: result.error, tone: "danger" });
    }
    await clearOfflineData();
    window.location.assign("/login?deleted=1");
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Your data</CardTitle>
        <CardDescription>
          Download everything Orbit stores about you (profile, resumes, applications, answers, activity) as one JSON file, or
          delete your account and all of it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {disabled ? (
          <Button variant="secondary" size="sm" disabled>
            <Download /> Export my data
          </Button>
        ) : (
          <a href="/api/export" download className={buttonVariants({ variant: "secondary", size: "sm" })}>
            <Download /> Export my data
          </a>
        )}
        <Button variant="danger" size="sm" disabled={disabled} onClick={() => dialog.current?.showModal()}>
          <Trash2 /> Delete my account
        </Button>
      </CardContent>

      <dialog
        ref={dialog}
        aria-labelledby="delete-title"
        onClose={() => setTyped("")}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border bg-surface p-0 text-text shadow-card backdrop:bg-black/60"
      >
        <form
          method="dialog"
          className="flex flex-col gap-3 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void confirmDelete();
          }}
        >
          <h2 id="delete-title" className="text-base font-semibold text-danger">Delete your account?</h2>
          <p className="text-sm text-muted">
            This permanently deletes your profile, master resume, tailored versions, applications, saved answers, activity and
            connections. It can&apos;t be undone. Export your data first if you want a copy.
          </p>
          <label className="flex flex-col gap-1.5 text-sm">
            Type <strong className="font-mono">{PHRASE}</strong> to confirm
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="h-10 rounded-lg border bg-bg px-3 font-mono text-sm"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => dialog.current?.close()}>Cancel</Button>
            <Button type="submit" variant="danger" disabled={busy || typed.trim().toLowerCase() !== PHRASE}>
              {busy ? "Deleting…" : "Delete forever"}
            </Button>
          </div>
        </form>
      </dialog>
    </Card>
  );
}
