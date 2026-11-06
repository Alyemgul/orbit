"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  PIPELINE_COLUMNS,
  STATUS_LABELS,
  canTransition,
  nextStatuses,
  type ApplicationStatus,
  type PipelineColumnId,
  type PipelineItem,
} from "@orbit/core";
import { Archive, ChevronDown, ExternalLink, GripVertical, ThumbsDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { moveApplication } from "@/app/(app)/pipeline/actions";
import { CompanyAvatar } from "@/components/job/job-bits";
import { SegmentedRing } from "@/components/stats/rings";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { timeAgo, type Tone } from "@/lib/jobs/format";
import { getBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type DropId = PipelineColumnId | "rejected" | "archived";

/** The status a card gets when dropped on each column. */
const DROP_STATUS: Record<DropId, ApplicationStatus> = {
  saved: "saved",
  applying: "queued",
  applied: "applied",
  interviewing: "interviewing",
  offer: "offer",
  rejected: "rejected",
  archived: "archived",
};

const COLUMN_STYLE: Record<PipelineColumnId, { dot: string; stroke: string }> = {
  saved: { dot: "bg-muted", stroke: "stroke-muted" },
  applying: { dot: "bg-warning", stroke: "stroke-warning" },
  applied: { dot: "bg-info", stroke: "stroke-info" },
  interviewing: { dot: "bg-accent", stroke: "stroke-accent" },
  offer: { dot: "bg-success", stroke: "stroke-success" },
};

const STATUS_TONE: Partial<Record<ApplicationStatus, Tone>> = {
  needs_input: "warning",
  failed: "danger",
  queued: "neutral",
  tailoring: "accent",
  ready: "accent",
  submitting: "info",
};

const ACTIVE_STATUSES = new Set<ApplicationStatus>(PIPELINE_COLUMNS.flatMap((c) => c.statuses));

interface BoardProps {
  initialItems: PipelineItem[];
  mode: "live" | "demo";
  userId: string | null;
}

export function PipelineBoard({ initialItems, mode, userId }: BoardProps) {
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState(initialItems);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  // Server data wins whenever it changes (navigation, realtime refresh).
  useEffect(() => setItems(initialItems), [initialItems]);

  // Live board: any change to this user's applications (autopilot, extension, another tab) refreshes it.
  const refreshTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (mode !== "live" || !userId) return;
    const supabase = getBrowserClient();
    const channel = supabase
      .channel(`pipeline:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "applications", filter: `user_id=eq.${userId}` },
        () => {
          window.clearTimeout(refreshTimer.current);
          refreshTimer.current = window.setTimeout(() => router.refresh(), 400);
        },
      )
      .subscribe();
    return () => {
      window.clearTimeout(refreshTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [mode, userId, router]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const byColumn = useMemo(() => {
    const map = new Map<PipelineColumnId, PipelineItem[]>(PIPELINE_COLUMNS.map((c) => [c.id, []]));
    for (const item of items) {
      const column = PIPELINE_COLUMNS.find((c) => (c.statuses as readonly string[]).includes(item.status));
      if (column) map.get(column.id)!.push(item);
    }
    return map;
  }, [items]);
  const closed = items.filter((item) => !ACTIVE_STATUSES.has(item.status));
  const active = items.find((item) => item.id === activeId) ?? null;

  async function move(item: PipelineItem, to: ApplicationStatus) {
    if (item.status === to) return;
    if (!canTransition(item.status, to)) {
      toast({ message: `Can't move from ${STATUS_LABELS[item.status]} to ${STATUS_LABELS[to]}.`, tone: "danger" });
      return;
    }
    const previous = item.status;
    setItems((all) => all.map((i) => (i.id === item.id ? { ...i, status: to, updated_at: new Date().toISOString() } : i)));
    if (mode === "live") {
      const result = await moveApplication(item.id, to);
      if (!result.ok) {
        setItems((all) => all.map((i) => (i.id === item.id ? { ...i, status: previous } : i)));
        toast({ message: result.error, tone: "danger" });
        return;
      }
    }
    if (to === "offer") toast({ message: `Offer from ${item.company}! 🎉`, tone: "success" });
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const item = items.find((i) => i.id === event.active.id);
    const target = event.over?.id as DropId | undefined;
    if (!item || !target) return;
    const column = PIPELINE_COLUMNS.find((c) => c.id === target);
    // Dropping inside the card's own column (e.g. Applying) changes nothing.
    if (column && (column.statuses as readonly string[]).includes(item.status)) return;
    void move(item, DROP_STATUS[target]);
  }

  const total = PIPELINE_COLUMNS.reduce((sum, c) => sum + byColumn.get(c.id)!.length, 0);

  return (
    <div className="flex flex-col gap-6">
      {/* Ring of where everything stands, legend on the side. */}
      <section className="flex flex-col items-center gap-5 rounded-2xl border bg-surface p-5 shadow-card sm:flex-row sm:items-center">
        <SegmentedRing
          size={128}
          label={`${total} active applications`}
          segments={PIPELINE_COLUMNS.map((c) => ({
            label: c.label,
            value: byColumn.get(c.id)!.length,
            className: COLUMN_STYLE[c.id].stroke,
          }))}
        >
          <div>
            <p className="text-3xl font-semibold tabular-nums">{total}</p>
            <p className="text-xs text-muted">active</p>
          </div>
        </SegmentedRing>
        <ul className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {PIPELINE_COLUMNS.map((column) => (
            <li key={column.id} className="rounded-xl bg-surface-2 px-3 py-2">
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <span className={cn("size-2 rounded-full", COLUMN_STYLE[column.id].dot)} aria-hidden />
                {column.label}
              </p>
              <p className="text-lg font-semibold tabular-nums">{byColumn.get(column.id)!.length}</p>
            </li>
          ))}
          <li className="rounded-xl bg-surface-2 px-3 py-2">
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <span className="size-2 rounded-full bg-danger" aria-hidden />
              Closed
            </p>
            <p className="text-lg font-semibold tabular-nums">{closed.length}</p>
          </li>
        </ul>
      </section>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="grid gap-3 lg:grid-cols-5">
          {PIPELINE_COLUMNS.map((column) => (
            <Column
              key={column.id}
              id={column.id}
              label={column.label}
              dot={COLUMN_STYLE[column.id].dot}
              items={byColumn.get(column.id)!}
              dragging={active}
              onMove={move}
            />
          ))}
        </div>

        <AnimatePresence>
          {active ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              className="sticky bottom-24 z-30 grid grid-cols-2 gap-3 md:bottom-4"
            >
              <EndZone id="rejected" label="Rejected" icon={<ThumbsDown className="size-4" />} dragging={active} />
              <EndZone id="archived" label="Archive" icon={<Archive className="size-4" />} dragging={active} />
            </motion.div>
          ) : null}
        </AnimatePresence>

        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}>
          {active ? <CardBody item={active} lifted /> : null}
        </DragOverlay>
      </DndContext>

      {closed.length ? (
        <section className="rounded-2xl border bg-surface">
          <button
            type="button"
            aria-expanded={showClosed}
            onClick={() => setShowClosed((open) => !open)}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
          >
            Rejected and archived ({closed.length})
            <ChevronDown className={cn("size-4 transition-transform", showClosed && "rotate-180")} aria-hidden />
          </button>
          {showClosed ? (
            <ul className="grid gap-2 border-t p-3 sm:grid-cols-2 lg:grid-cols-3">
              {closed.map((item) => (
                <li key={item.id}>
                  <CardBody item={item} onMove={move} />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

interface ColumnProps {
  id: PipelineColumnId;
  label: string;
  dot: string;
  items: PipelineItem[];
  dragging: PipelineItem | null;
  onMove: (item: PipelineItem, to: ApplicationStatus) => void;
}

function Column({ id, label, dot, items, dragging, onMove }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const own = dragging ? PIPELINE_COLUMNS.find((c) => c.id === id)!.statuses.some((s) => s === dragging.status) : false;
  const allowed = dragging ? own || canTransition(dragging.status, DROP_STATUS[id]) : true;

  return (
    <section
      ref={setNodeRef}
      aria-label={`${label}, ${items.length}`}
      className={cn(
        "flex min-h-28 flex-col gap-2 rounded-2xl border bg-surface-2/60 p-2 transition-[opacity,border-color,background-color] lg:min-h-[24rem]",
        dragging && !allowed && "opacity-40",
        dragging && allowed && !own && "border-dashed border-accent/60",
        isOver && allowed && !own && "border-accent bg-accent-soft/60",
      )}
    >
      <header className="flex items-center justify-between px-2 pt-1 pb-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className={cn("size-2 rounded-full", dot)} aria-hidden />
          {label}
        </h2>
        <span className="text-xs text-muted tabular-nums">{items.length}</span>
      </header>
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <DraggableCard key={item.id} item={item} onMove={onMove} />
        ))}
      </AnimatePresence>
      {items.length === 0 ? (
        <p className="px-2 py-4 text-center text-xs text-muted">{dragging && allowed && !own ? "Drop here" : "Nothing here yet"}</p>
      ) : null}
    </section>
  );
}

function EndZone({ id, label, icon, dragging }: { id: DropId; label: string; icon: React.ReactNode; dragging: PipelineItem }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const allowed = canTransition(dragging.status, DROP_STATUS[id]);
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-14 items-center justify-center gap-2 rounded-2xl border-2 border-dashed bg-surface text-sm font-medium shadow-card transition-colors",
        allowed ? "border-danger/50 text-danger" : "opacity-40",
        isOver && allowed && "bg-danger-soft",
      )}
    >
      {icon}
      {label}
    </div>
  );
}

function DraggableCard({ item, onMove }: { item: PipelineItem; onMove: (item: PipelineItem, to: ApplicationStatus) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id });
  return (
    <motion.div
      ref={setNodeRef}
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: isDragging ? 0.35 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
    >
      <CardBody item={item} onMove={onMove} handleProps={{ ...attributes, ...listeners }} />
    </motion.div>
  );
}

interface CardBodyProps {
  item: PipelineItem;
  onMove?: (item: PipelineItem, to: ApplicationStatus) => void;
  handleProps?: Record<string, unknown>;
  lifted?: boolean;
}

function CardBody({ item, onMove, handleProps, lifted }: CardBodyProps) {
  const tone = STATUS_TONE[item.status];
  const options = nextStatuses(item.status);
  return (
    <article
      className={cn(
        "group rounded-xl border bg-surface p-3 text-left shadow-card",
        lifted && "rotate-2 cursor-grabbing ring-2 ring-accent",
      )}
    >
      <div className="flex items-start gap-2.5">
        <CompanyAvatar company={item.company} className="size-8 rounded-lg text-xs lg:hidden 2xl:grid" />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-3 text-sm leading-snug font-medium" title={item.title}>
            {item.title}
          </p>
          <p className="truncate text-xs text-muted">
            {item.company}
            {item.location ? ` · ${item.location}` : ""}
          </p>
        </div>
        {handleProps ? (
          <button
            type="button"
            aria-label={`Drag ${item.title}`}
            className="-mr-1 grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-md text-muted hover:bg-surface-2 active:cursor-grabbing"
            {...handleProps}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {tone ? <Badge tone={tone}>{STATUS_LABELS[item.status]}</Badge> : null}
        {item.job_closed_at ? <Badge>Posting closed</Badge> : null}
        <span className="ml-auto text-[11px] text-muted" suppressHydrationWarning>
          {timeAgo(item.updated_at)}
        </span>
      </div>
      {item.last_error && item.status === "failed" ? <p className="mt-2 text-xs text-danger">{item.last_error}</p> : null}
      {onMove ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t pt-2.5">
          <a
            href={item.apply_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-text"
          >
            Posting <ExternalLink className="size-3" aria-hidden />
          </a>
          {options.length ? (
            <select
              aria-label={`Move ${item.title}`}
              value=""
              onChange={(event) => event.target.value && onMove(item, event.target.value as ApplicationStatus)}
              className="ml-auto h-7 max-w-full min-w-0 rounded-md border bg-surface px-1.5 text-xs text-muted hover:text-text"
            >
              <option value="">Move to…</option>
              {options.map((status) => (
                <option key={status} value={status}>
                  {status === "queued" && item.status === "saved" ? "Apply (queue)" : STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
