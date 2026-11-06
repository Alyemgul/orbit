"use client";

import { Loader2, MailCheck } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestMagicLink, type LoginState } from "./actions";

const INITIAL_STATE: LoginState = { status: "idle" };

export function LoginForm({ next, disabled }: { next: string; disabled: boolean }) {
  const [state, formAction, pending] = useActionState(requestMagicLink, INITIAL_STATE);

  if (state.status === "sent") {
    return (
      <div role="status" className="flex flex-col items-center gap-3 text-center">
        <div className="grid size-12 place-items-center rounded-2xl bg-success-soft text-success">
          <MailCheck className="size-6" aria-hidden />
        </div>
        <p className="font-medium">Check your inbox</p>
        <p className="text-sm text-muted">
          We sent a sign-in link to <span className="font-medium text-text">{state.email}</span>. Open it on this
          device.
        </p>
      </div>
    );
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
        {pending ? "Sending link…" : "Email me a sign-in link"}
      </Button>
    </form>
  );
}
