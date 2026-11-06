import type { ActivityDay } from "@orbit/core";
import { cn } from "@/lib/utils";

const DAY_MS = 86_400_000;
const LEVELS = ["bg-surface-2", "bg-accent/25", "bg-accent/45", "bg-accent/70", "bg-accent"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isoDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function level(count: number, max: number): number {
  if (count <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / Math.max(max, 1)) * 4)));
}

export interface ActivitySummary {
  total: number;
  applied: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
}

export function summarizeActivity(days: readonly ActivityDay[], today: string): ActivitySummary {
  const active = new Set(days.filter((d) => d.swipes + d.applied > 0).map((d) => d.day));
  let longest = 0;
  let run = 0;
  let previous: number | null = null;
  for (const day of [...active].sort()) {
    const time = Date.parse(`${day}T00:00:00Z`);
    run = previous !== null && time - previous === DAY_MS ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = time;
  }
  // The current streak survives until today is over, so start from yesterday if today is empty.
  let cursor = Date.parse(`${today}T00:00:00Z`);
  if (!active.has(today)) cursor -= DAY_MS;
  let current = 0;
  while (active.has(isoDay(cursor))) {
    current++;
    cursor -= DAY_MS;
  }
  return {
    total: days.reduce((sum, d) => sum + d.swipes, 0),
    applied: days.reduce((sum, d) => sum + d.applied, 0),
    activeDays: active.size,
    currentStreak: current,
    longestStreak: longest,
  };
}

interface ActivityHeatmapProps {
  days: readonly ActivityDay[];
  /** "YYYY-MM-DD" of the last column's day. */
  today: string;
}

const WEEKS = 52;
/** Phones show the most recent half year so cells stay tappable. */
const MOBILE_WEEKS = 26;

/** Contribution-style grid: one column per week (Monday first), newest on the right. */
export function ActivityHeatmap({ days, today }: ActivityHeatmapProps) {
  const weeks = WEEKS;
  const byDay = new Map(days.map((d) => [d.day, d]));
  const todayTime = Date.parse(`${today}T00:00:00Z`);
  const weekday = (new Date(todayTime).getUTCDay() + 6) % 7; // Monday = 0
  const start = todayTime - (weekday + (weeks - 1) * 7) * DAY_MS;
  const max = Math.max(1, ...days.map((d) => d.swipes + d.applied));

  const columns = Array.from({ length: weeks }, (_, week) =>
    Array.from({ length: 7 }, (_, dow) => {
      const time = start + (week * 7 + dow) * DAY_MS;
      const day = isoDay(time);
      const entry = byDay.get(day);
      return { day, time, future: time > todayTime, swipes: entry?.swipes ?? 0, applied: entry?.applied ?? 0 };
    }),
  );

  return (
    <div className="min-w-0">
      {/* Cells scale with the container instead of scrolling sideways. */}
      <div
        role="img"
        aria-label={`Daily activity for the past year: ${days.filter((d) => d.swipes + d.applied > 0).length} active days`}
        className="grid grid-cols-[repeat(26,minmax(0,1fr))] gap-[3px] sm:grid-cols-[repeat(52,minmax(0,1fr))]"
      >
        {columns.map((column, week) => {
          const first = new Date(column[0]!.time);
          const showMonth = week === 0 || week === WEEKS - MOBILE_WEEKS || first.getUTCDate() <= 7;
          return (
            <div
              key={column[0]!.day}
              className={cn("flex min-w-0 flex-col gap-[3px]", week < WEEKS - MOBILE_WEEKS && "max-sm:hidden")}
            >
              <span className="h-4 truncate text-[10px] leading-4 text-muted" aria-hidden>
                {showMonth && week < weeks - 1 ? MONTHS[first.getUTCMonth()] : ""}
              </span>
              {column.map((cell) => (
                <span
                  key={cell.day}
                  title={cell.future ? undefined : `${cell.day}: ${cell.swipes} swipes, ${cell.applied} applied`}
                  className={cn(
                    "aspect-square w-full rounded-[2px]",
                    cell.future ? "bg-transparent" : LEVELS[level(cell.swipes + cell.applied, max)],
                  )}
                />
              ))}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-muted" aria-hidden>
        Less
        {LEVELS.map((className) => (
          <span key={className} className={cn("size-2.5 rounded-[2px]", className)} />
        ))}
        More
      </div>
    </div>
  );
}
