"use client";

import { Check, Copy, Mail, Plug, Unplug } from "lucide-react";
import { useState, type ReactNode } from "react";
import { createConnection, revokeConnection, updateAutopilotSettings } from "@/app/(app)/profile/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { timeAgo } from "@/lib/jobs/format";
import type { ConnectionInfo } from "@/lib/inbox.server";

function CopyBox({ value, label, rows = 3 }: { value: string; label: string; rows?: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <textarea
        readOnly
        value={value}
        rows={rows}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full resize-y rounded-lg border bg-bg p-2.5 font-mono text-[11px] leading-relaxed break-all"
      />
      <Button
        size="sm"
        variant="secondary"
        className="self-start"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            // Clipboard blocked: the text is selectable.
          }
        }}
      >
        {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted marker:text-muted">{children}</ol>;
}

function Toggle({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-start gap-3">
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  );
}

function useConnection(kind: "extension" | "gmail", initial: ConnectionInfo | null, disabled: boolean) {
  const toast = useToast();
  const [connection, setConnection] = useState(initial);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    if (disabled) return toast({ message: "Sign in to connect." });
    if (connection && !window.confirm("This replaces the current connection; the old code stops working. Continue?")) return;
    setBusy(true);
    const result = await createConnection(kind);
    setBusy(false);
    if (!result.ok) return toast({ message: result.error, tone: "danger" });
    setSecret(result.data.code);
    setConnection({ kind, createdAt: new Date().toISOString(), lastUsedAt: null });
  }

  async function revoke() {
    if (!window.confirm("Disconnect? The current code stops working right away.")) return;
    const result = await revokeConnection(kind);
    if (!result.ok) return toast({ message: result.error, tone: "danger" });
    setConnection(null);
    setSecret(null);
    toast({ message: "Disconnected.", tone: "success" });
  }

  return { connection, secret, busy, create, revoke };
}

function Status({ connection }: { connection: ConnectionInfo | null }) {
  if (!connection) return <p className="text-sm text-muted">Not connected.</p>;
  return (
    <p className="flex items-center gap-1.5 text-sm" suppressHydrationWarning>
      <span className="size-2 rounded-full bg-success" aria-hidden />
      Connected {timeAgo(connection.createdAt)}
      {connection.lastUsedAt ? <span className="text-muted">· last active {timeAgo(connection.lastUsedAt)}</span> : <span className="text-muted">· not used yet</span>}
    </p>
  );
}

export function AutopilotCard({
  connection: initial,
  review: initialReview,
  acceptPrivacy: initialAccept,
  disabled,
}: {
  connection: ConnectionInfo | null;
  review: boolean;
  acceptPrivacy: boolean;
  disabled: boolean;
}) {
  const toast = useToast();
  const { connection, secret, busy, create, revoke } = useConnection("extension", initial, disabled);
  const [review, setReview] = useState(initialReview);
  const [accept, setAccept] = useState(initialAccept);

  async function save(next: { review: boolean; acceptPrivacy: boolean }) {
    setReview(next.review);
    setAccept(next.acceptPrivacy);
    const result = await updateAutopilotSettings(next);
    if (!result.ok) toast({ message: result.error, tone: "danger" });
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="size-4 text-accent" aria-hidden /> Autopilot extension
        </CardTitle>
        <CardDescription>
          A Chrome extension that opens queued Greenhouse, Lever and Ashby applications, fills them from your tailored resume
          and saved answers, and submits them, pausing 3 minutes between each and stopping at your daily limit.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Status connection={connection} />
          {secret ? (
            <>
              <p className="text-sm font-medium">Your connection code (shown once):</p>
              <CopyBox value={secret} label="Connection code" />
            </>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void create()} disabled={busy}>
              <Plug /> {connection ? "New code" : "Connect extension"}
            </Button>
            {connection ? (
              <Button size="sm" variant="ghost" onClick={() => void revoke()}>
                <Unplug /> Disconnect
              </Button>
            ) : null}
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">How to install (free, 2 minutes)</summary>
            <div className="mt-2">
              <Steps>
                <li>
                  In the Orbit folder, run <code className="rounded bg-surface-2 px-1">npm run build -w @orbit/extension</code>.
                </li>
                <li>
                  Open <code className="rounded bg-surface-2 px-1">chrome://extensions</code>, turn on Developer mode, click Load unpacked
                  and pick <code className="rounded bg-surface-2 px-1">apps/extension/dist</code>.
                </li>
                <li>Click the Orbit icon in the toolbar, paste the code above, and switch the autopilot on.</li>
              </Steps>
            </div>
          </details>
        </div>
        <div className="flex flex-col gap-4">
          <Toggle
            label="Review before sending"
            hint="Fill each form and wait for you to press Submit, instead of submitting automatically."
            checked={review}
            disabled={disabled}
            onChange={(value) => void save({ review: value, acceptPrivacy: accept })}
          />
          <Toggle
            label="Tick privacy-notice boxes for me"
            hint="Some forms require agreeing to the company's candidate privacy notice. Marketing opt-ins are never ticked."
            checked={accept}
            disabled={disabled}
            onChange={(value) => void save({ review, acceptPrivacy: value })}
          />
          <p className="text-xs text-muted">
            The autopilot never solves CAPTCHAs and never guesses visa, work-authorization or diversity answers. Those go to your
            Inbox; answer once and they're reused.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function GmailCard({ connection: initial, disabled }: { connection: ConnectionInfo | null; disabled: boolean }) {
  const { connection, secret, busy, create, revoke } = useConnection("gmail", initial, disabled);
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="size-4 text-accent" aria-hidden /> Gmail reply tracking
        </CardTitle>
        <CardDescription>
          Moves applications to Interviewing, Offer or Rejected when the company replies. A small script runs in your own Google
          account (free, no app to approve) and sends Orbit only the sender and subject of job emails, never the content.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Status connection={connection} />
        {secret ? (
          <>
            <Steps>
              <li>
                Open{" "}
                <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                  script.google.com
                </a>{" "}
                (signed in to the Gmail you apply with).
              </li>
              <li>Delete what's in the editor, paste the script below, and save.</li>
              <li>Pick <code className="rounded bg-surface-2 px-1">setup</code> in the function menu, click Run, and allow access.</li>
            </Steps>
            <CopyBox value={secret} label="Gmail script" rows={8} />
          </>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void create()} disabled={busy}>
            <Mail /> {connection ? "New script" : "Set up Gmail tracking"}
          </Button>
          {connection ? (
            <Button size="sm" variant="ghost" onClick={() => void revoke()}>
              <Unplug /> Disconnect
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
