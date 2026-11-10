"use client";

import { useState, type FormEvent } from "react";
import { updateApplyCap } from "@/app/(app)/profile/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const PRESETS = [15, 30, 50, 100];

export function ApplyCapForm({ initial, disabled }: { initial: number; disabled: boolean }) {
  const toast = useToast();
  const [value, setValue] = useState(String(initial));
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const cap = Number(value);
  const valid = Number.isInteger(cap) && cap >= 0 && cap <= 200;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    const result = await updateApplyCap(cap);
    setBusy(false);
    if (result.ok) {
      setSaved(result.data);
      toast({ message: `Daily apply limit set to ${result.data}.`, tone: "success" });
    } else toast({ message: result.error, tone: "danger" });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Presets">
        {PRESETS.map((preset) => (
          <button key={preset} type="button" disabled={disabled} onClick={() => setValue(String(preset))} aria-pressed={cap === preset}
            className={cn("h-8 rounded-full border px-3 text-xs font-medium tabular-nums transition-colors disabled:opacity-50",
              cap === preset ? "border-accent bg-accent-soft text-accent" : "bg-surface text-muted hover:text-text")}>
            {preset}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="apply-cap" className="text-sm text-muted">Applies per day</label>
        <input id="apply-cap" type="number" inputMode="numeric" min={0} max={200} step={1} value={value} disabled={disabled}
          onChange={(e) => setValue(e.target.value)} aria-invalid={!valid}
          className="h-9 w-20 rounded-lg border bg-surface px-2.5 text-sm tabular-nums aria-[invalid=true]:border-danger" />
        <Button type="submit" size="sm" disabled={disabled || busy || !valid || cap === saved}>{busy ? "Saving…" : "Save"}</Button>
      </div>
      {cap > 30 && valid ? (
        <p className="text-xs text-warning">
          Above 30 a day, quality usually drops, and some application sites flag very fast submissions. A high limit is
          fine for swiping; Orbit's autopilot will still pace itself.
        </p>
      ) : null}
    </form>
  );
}
