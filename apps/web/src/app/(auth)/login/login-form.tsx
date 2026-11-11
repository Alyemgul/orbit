"use client";

import { Loader2, MailCheck } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestMagicLink, verifyEmailCode, type LoginState } from "./actions";

const INITIAL_STATE: LoginState = { status: "idle" };

export function LoginForm({ next, disabled }: { next: string; disabled: boolean }) {
  // Bumping the key remounts the email step, so "Use a different email" starts fresh.
  const [attempt, setAttempt] = useState(0);
  return <EmailStep key={attempt} next={next} disabled={disabled} onRestart={() => setAttempt((n) => n + 1)} />;
}

function EmailStep({ next, disabled, onRestart }: { next: string; disabled: boolean; onRestart: () => void }) {
  const [state, formAction, pending] = useActionState(requestMagicLink, INITIAL_STATE);

  if (state.status === "sent") {
    return <CodeStep sent={state} onRestart={onRestart} />;
  }

  const error = state.status === "error" ? state.message : null;

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <input type="hidden" name="next" value={next} />
      <label htmlFor="email" className="block text-sm font-medium">
        Email
      </label>
      <Input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@example.com"
        required
        disabled={disabled || pending}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "email-error" : undefined}
      />
      {error ? (
        <p id="email-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" className="w-full" disabled={disabled || pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {pending ? "Sending…" : "Email me a sign-in code"}
      </Button>
    </form>
  );
}

function CodeStep({
  sent,
  onRestart,
}: {
  sent: Extract<LoginState, { status: "sent" }>;
  onRestart: () => void;
}) {
  const [state, formAction, pending] = useActionState(verifyEmailCode, sent);
  const error = state.status === "sent" ? state.error : state.status === "error" ? state.message : undefined;

  return (
    <div className="space-y-4">
      <div role="status" className="flex flex-col items-center gap-3 text-center">
        <div className="grid size-12 place-items-center rounded-2xl bg-success-soft text-success">
          <MailCheck className="size-6" aria-hidden />
        </div>
        <p className="font-medium">Check your inbox</p>
        <p className="text-sm text-muted">
          If <span className="font-medium text-text">{sent.email}</span> has an Orbit invite, an email is on its way.
          Type the code from it below, or open its link in this same browser.
        </p>
      </div>

      <form action={formAction} className="space-y-3" noValidate>
        <input type="hidden" name="email" value={sent.email} />
        <input type="hidden" name="next" value={sent.next} />
        <label htmlFor="code" className="block text-sm font-medium">
          Code from the email
        </label>
        <Input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={12}
          placeholder="123456"
          required
          autoFocus
          disabled={pending}
          className="text-center text-lg tracking-[0.3em]"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "code-error" : undefined}
        />
        {error ? (
          <p id="code-error" role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <button
        type="button"
        onClick={onRestart}
        className="w-full text-center text-sm text-muted underline underline-offset-2 hover:text-text"
      >
        Use a different email or send again
      </button>
    </div>
  );
}
