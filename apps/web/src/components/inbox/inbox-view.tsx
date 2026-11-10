"use client";

import { isSensitiveQuestion, type PendingQuestion } from "@orbit/core";
import { Archive, Brain, Check, ExternalLink, Inbox, Lock, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { answerAndRetry, deleteMemory, updateMemory } from "@/app/(app)/inbox/actions";
import { moveApplication } from "@/app/(app)/pipeline/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { timeAgo } from "@/lib/jobs/format";
import type { InboxItem, MemoryItem } from "@/lib/inbox.server";
import { cn } from "@/lib/utils";

interface InboxViewProps {
  mode: "live" | "demo";
  items: InboxItem[];
  memory: MemoryItem[];
}

export function InboxView({ mode, items: initialItems, memory: initialMemory }: InboxViewProps) {
  const toast = useToast();
  const [items, setItems] = useState(initialItems);
  const [memory, setMemory] = useState(initialMemory);

  const remove = (id: string) => setItems((all) => all.filter((i) => i.id !== id));
  const demo = () => toast({ message: "Preview mode: nothing is saved. Sign in to use the Inbox." });

  async function move(item: InboxItem, status: "applied" | "archived" | "retry") {
    if (mode === "demo") return demo();
    const result =
      status === "retry" ? await answerAndRetry(item.id, []) : await moveApplication(item.id, status);
    if (!result.ok) return toast({ message: result.error, tone: "danger" });
    remove(item.id);
    toast({
      message: status === "applied" ? `Marked ${item.company} as applied.` : status === "archived" ? "Archived." : `${item.company} is back in the autopilot's queue.`,
      tone: "success",
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section aria-labelledby="needs-title" className="flex min-w-0 flex-col gap-3">
        <h2 id="needs-title" className="flex items-center gap-2 text-base font-semibold">
          Needs you <Badge tone={items.length ? "warning" : "neutral"}>{items.length}</Badge>
        </h2>
        {items.length === 0 ? (
          <Card>
            <EmptyState
              icon={Inbox}
              title="All clear"
              description="When a form asks something Orbit can't answer, like a new screening question or a CAPTCHA, it lands here. Answer once and Orbit remembers it."
            />
          </Card>
        ) : (
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <motion.div key={item.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40 }}>
                <InboxCard
                  item={item}
                  onMove={(status) => void move(item, status)}
                  onAnswered={(saved) => {
                    remove(item.id);
                    setMemory((all) => [
                      ...saved.map((s) => ({ id: `new-${s.question}`, question: s.question, answer: s.answer, sensitive: isSensitiveQuestion(s.question), updatedAt: new Date().toISOString() })),
                      ...all.filter((m) => !saved.some((s) => s.question === m.question)),
                    ]);
                  }}
                  demo={mode === "demo"}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </section>

      <MemoryPanel memory={memory} setMemory={setMemory} demo={mode === "demo"} />
    </div>
  );
}

type Answer = string | string[];

function InboxCard({
  item,
  onMove,
  onAnswered,
  demo,
}: {
  item: InboxItem;
  onMove: (status: "applied" | "archived" | "retry") => void;
  onAnswered: (saved: { question: string; answer: Answer }[]) => void;
  demo: boolean;
}) {
  const toast = useToast();
  const answerable = item.questions.filter((q) => q.type !== "file");
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [busy, setBusy] = useState(false);
  const missingRequired = answerable.filter((q) => q.required && !hasAnswer(answers[q.text]));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (missingRequired.length) return;
    const list = answerable.filter((q) => hasAnswer(answers[q.text])).map((q) => ({ question: q.text, answer: answers[q.text]! }));
    if (demo) return toast({ message: "Preview mode: answers aren't saved." });
    setBusy(true);
    const result = await answerAndRetry(item.id, list);
    setBusy(false);
    if (!result.ok) return toast({ message: result.error, tone: "danger" });
    toast({ message: `Saved ${list.length} answer${list.length === 1 ? "" : "s"}. ${item.company} is back in the queue.`, tone: "success" });
    onAnswered(list);
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{item.title}</h3>
          <p className="text-sm text-muted" suppressHydrationWarning>
            {item.company} · {timeAgo(item.updatedAt)}
          </p>
        </div>
        <Badge tone={item.status === "failed" ? "danger" : "warning"}>{item.status === "failed" ? "Failed" : "Needs you"}</Badge>
      </div>
      {item.reason ? <p className="mt-2 text-sm">{item.reason}</p> : null}

      {answerable.length ? (
        <form onSubmit={submit} className="mt-3 flex flex-col gap-4">
          {answerable.map((question) => (
            <QuestionField
              key={question.text}
              question={question}
              value={answers[question.text]}
              onChange={(value) => setAnswers((all) => ({ ...all, [question.text]: value }))}
            />
          ))}
          {item.questions.some((q) => q.type === "file") ? (
            <p className="text-xs text-muted">This form also asks for a file upload Orbit can't provide; finish it on the posting.</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={busy || missingRequired.length > 0}>
              <Check /> {busy ? "Saving…" : "Save answers and retry"}
            </Button>
            {missingRequired.length ? <span className="text-xs text-muted">{missingRequired.length} required left</span> : null}
          </div>
        </form>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
        {item.applyUrl ? (
          <a href={item.applyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
            Open posting <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : null}
        <span className="ml-auto flex flex-wrap gap-1.5">
          {!answerable.length ? (
            <Button variant="secondary" size="sm" onClick={() => onMove("retry")}>
              <RotateCcw /> Retry
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={() => onMove("applied")}>
            <Check /> I applied
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onMove("archived")}>
            <Archive /> Archive
          </Button>
        </span>
      </div>
    </Card>
  );
}

function hasAnswer(value: Answer | undefined): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
}

function QuestionField({ question, value, onChange }: { question: PendingQuestion; value: Answer | undefined; onChange: (value: Answer) => void }) {
  const sensitive = isSensitiveQuestion(question.text);
  const label = (
    <span className="flex items-start gap-1.5 text-sm font-medium">
      <span>
        {question.text}
        {question.required ? <span className="text-danger"> *</span> : null}
      </span>
      {sensitive ? (
        <span title="Only ever filled from your own answer" className="mt-0.5 shrink-0 text-muted">
          <Lock className="size-3.5" aria-label="Sensitive" />
        </span>
      ) : null}
    </span>
  );
  const options = question.options ?? [];

  if ((question.type === "select" || question.type === "radio") && options.length) {
    return (
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5">{label}</legend>
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={value === option}
              onClick={() => onChange(option)}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                value === option ? "border-accent bg-accent-soft text-accent" : "bg-surface text-muted hover:text-text",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </fieldset>
    );
  }
  if (question.type === "checkbox" && options.length) {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5">{label}</legend>
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => {
            const on = selected.includes(option);
            return (
              <button
                key={option}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? selected.filter((s) => s !== option) : [...selected, option])}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors",
                  on ? "border-accent bg-accent-soft text-accent" : "bg-surface text-muted hover:text-text",
                )}
              >
                {option}
              </button>
            );
          })}
        </div>
      </fieldset>
    );
  }
  if (question.type === "checkbox") {
    return (
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" checked={value === "Yes"} onChange={(e) => onChange(e.target.checked ? "Yes" : "")} />
        {label}
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-1.5">
      {label}
      <textarea
        rows={question.type === "textarea" ? 3 : 1}
        maxLength={3000}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[2.5rem] w-full resize-y rounded-lg border bg-surface px-3 py-2 text-sm [field-sizing:content]"
      />
    </label>
  );
}

function MemoryPanel({ memory, setMemory, demo }: { memory: MemoryItem[]; setMemory: (fn: (all: MemoryItem[]) => MemoryItem[]) => void; demo: boolean }) {
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState("");
  const shown = memory.filter((m) => !filter || m.question.toLowerCase().includes(filter.toLowerCase()));

  async function save(item: MemoryItem) {
    const answer = Array.isArray(item.answer) ? draft.split(",").map((s) => s.trim()).filter(Boolean) : draft.trim();
    if (demo) return toast({ message: "Preview mode: answers aren't saved." });
    const result = await updateMemory(item.id, answer);
    if (!result.ok) return toast({ message: result.error, tone: "danger" });
    setMemory((all) => all.map((m) => (m.id === item.id ? { ...m, answer } : m)));
    setEditing(null);
  }

  async function forget(item: MemoryItem) {
    if (demo) return toast({ message: "Preview mode: answers aren't saved." });
    const result = await deleteMemory(item.id);
    if (!result.ok) return toast({ message: result.error, tone: "danger" });
    setMemory((all) => all.filter((m) => m.id !== item.id));
  }

  return (
    <section aria-labelledby="memory-title" className="rounded-2xl border bg-surface p-4 shadow-card lg:self-start">
      <h2 id="memory-title" className="flex items-center gap-2 text-base font-semibold">
        <Brain className="size-4 text-accent" aria-hidden /> Answer memory <Badge>{memory.length}</Badge>
      </h2>
      <p className="mt-1 text-xs text-muted">
        Reused whenever the same question appears on another form. <Lock className="inline size-3" aria-hidden /> marks work-authorization and
        diversity answers, which Orbit never guesses.
      </p>
      {memory.length > 6 ? (
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search answers"
          aria-label="Search answers"
          className="mt-3 h-9 w-full rounded-lg border bg-surface px-3 text-sm"
        />
      ) : null}
      {shown.length ? (
        <ul className="mt-2 flex max-h-[28rem] flex-col divide-y overflow-y-auto">
          {shown.map((item) => (
            <li key={item.id} className="py-2.5">
              <p className="flex items-start gap-1.5 text-sm">
                <span className="min-w-0 flex-1">{item.question}</span>
                {item.sensitive ? <Lock className="mt-0.5 size-3.5 shrink-0 text-muted" aria-label="Sensitive" /> : null}
              </p>
              {editing === item.id ? (
                <form
                  className="mt-1.5 flex gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save(item);
                  }}
                >
                  <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Answer" className="h-8 min-w-0 flex-1 rounded-md border bg-surface px-2 text-sm" />
                  <Button type="submit" size="sm">Save</Button>
                </form>
              ) : (
                <div className="mt-1 flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-accent">
                    {Array.isArray(item.answer) ? item.answer.join(", ") : item.answer}
                  </span>
                  <button type="button" aria-label="Edit answer" className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
                    onClick={() => {
                      setEditing(item.id);
                      setDraft(Array.isArray(item.answer) ? item.answer.join(", ") : item.answer);
                    }}>
                    <Pencil className="size-3.5" />
                  </button>
                  <button type="button" aria-label="Forget answer" className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-danger" onClick={() => void forget(item)}>
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">{filter ? "No match." : "Nothing yet. Answers you give here, or type while the autopilot waits, are saved automatically."}</p>
      )}
    </section>
  );
}
