"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Segment {
  label: string;
  value: number;
  /** A Tailwind stroke class, e.g. "stroke-success". */
  className: string;
}

interface SegmentedRingProps {
  segments: readonly Segment[];
  size?: number;
  stroke?: number;
  /** Gap between segments, in degrees. */
  gap?: number;
  children?: ReactNode;
  className?: string;
  label: string;
}

/**
 * A ring split into colored arcs, drawn in on mount. With one segment it is
 * a plain progress ring (pass a second, track-colored segment for the rest).
 */
export function SegmentedRing({ segments, size = 120, stroke = 9, gap = 4, children, className, label }: SegmentedRingProps) {
  const reduceMotion = useReducedMotion();
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const visible = segments.filter((s) => s.value > 0);
  const gapLength = visible.length > 1 ? (gap / 360) * circumference : 0;

  let offset = 0;
  const arcs = visible.map((segment) => {
    const length = (segment.value / total) * circumference;
    const arc = { ...segment, start: offset, length: Math.max(length - gapLength, 0.001) };
    offset += length;
    return arc;
  });

  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90" role="img" aria-label={label}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-surface-2" />
        {arcs.map((arc, index) => (
          <motion.circle
            key={arc.label}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap={visible.length > 1 ? "butt" : "round"}
            className={arc.className}
            strokeDasharray={`${arc.length} ${circumference}`}
            initial={reduceMotion ? false : { strokeDashoffset: -arc.start + arc.length, opacity: 0 }}
            animate={{ strokeDashoffset: -arc.start, opacity: 1 }}
            transition={{ duration: 0.7, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
          />
        ))}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

interface ProgressRingProps {
  value: number;
  max: number;
  size?: number;
  stroke?: number;
  className?: string;
  /** Stroke class for the filled arc. */
  tone?: string;
  label: string;
  children?: ReactNode;
}

export function ProgressRing({ value, max, size = 44, stroke = 5, className, tone = "stroke-accent", label, children }: ProgressRingProps) {
  const filled = Math.min(Math.max(value, 0), max);
  return (
    <SegmentedRing
      size={size}
      stroke={stroke}
      gap={0}
      className={className}
      label={label}
      segments={
        filled > 0
          ? [
              { label: "done", value: filled, className: tone },
              { label: "left", value: Math.max(max - filled, 0), className: "stroke-transparent" },
            ]
          : []
      }
    >
      {children}
    </SegmentedRing>
  );
}
