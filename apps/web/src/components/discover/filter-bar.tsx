"use client";

import {
  FEED_CATEGORY_GROUPS,
  FEED_LEVELS,
  FEED_REGIONS,
  type FeedCategoryGroup,
  type FeedFilters,
  type FeedLevel,
  type FeedRegion,
} from "@orbit/core";
import { ChevronDown, SlidersHorizontal, Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";

interface FilterBarProps {
  filters: FeedFilters;
  onChange: (filters: FeedFilters) => void;
  pending?: boolean;
}

const selectClass =
  "h-9 rounded-lg border bg-surface px-2.5 text-sm font-medium text-text hover:bg-surface-2 focus-visible:outline-2";

export function FilterBar({ filters, onChange, pending }: FilterBarProps) {
  const [query, setQuery] = useState(filters.query);
  // Phones show a one-line summary until opened; larger screens always show everything.
  const [open, setOpen] = useState(false);
  const summary = [
    FEED_REGIONS[filters.region].label,
    FEED_LEVELS[filters.level].label,
    filters.groups.length === 0 || filters.groups.length === Object.keys(FEED_CATEGORY_GROUPS).length
      ? "All fields"
      : `${filters.groups.length} fields`,
    filters.remoteOnly ? "Remote" : null,
    filters.query ? `“${filters.query}”` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  function toggleGroup(group: FeedCategoryGroup) {
    const groups = filters.groups.includes(group)
      ? filters.groups.filter((g) => g !== group)
      : [...filters.groups, group];
    onChange({ ...filters, groups });
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    onChange({ ...filters, query: query.trim() });
  }

  return (
    <div className={cn("flex flex-col gap-3 transition-opacity", pending && "opacity-60")} aria-busy={pending}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="feed-filters"
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 items-center gap-2 rounded-lg border bg-surface px-3 text-left text-sm md:hidden"
      >
        <SlidersHorizontal className="size-4 shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium">{summary}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <div id="feed-filters" className={cn("flex-col gap-3 md:flex", open ? "flex" : "hidden")}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="feed-region">
          Region
        </label>
        <select
          id="feed-region"
          className={selectClass}
          value={filters.region}
          onChange={(event) => onChange({ ...filters, region: event.target.value as FeedRegion })}
        >
          {Object.entries(FEED_REGIONS).map(([key, region]) => (
            <option key={key} value={key}>
              {region.label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="feed-level">
          Level
        </label>
        <select
          id="feed-level"
          className={selectClass}
          value={filters.level}
          onChange={(event) => onChange({ ...filters, level: event.target.value as FeedLevel })}
        >
          {Object.entries(FEED_LEVELS).map(([key, level]) => (
            <option key={key} value={key}>
              {level.label}
            </option>
          ))}
        </select>
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border bg-surface px-2.5 text-sm font-medium hover:bg-surface-2">
          <input
            type="checkbox"
            className="size-4 accent-[var(--accent)]"
            checked={filters.remoteOnly}
            onChange={(event) => onChange({ ...filters, remoteOnly: event.target.checked })}
          />
          Remote only
        </label>
        <form onSubmit={submitSearch} role="search" className="relative min-w-0 flex-1 basis-48">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            maxLength={100}
            onChange={(event) => setQuery(event.target.value)}
            onBlur={() => query.trim() !== filters.query && onChange({ ...filters, query: query.trim() })}
            placeholder="Search title, company, city"
            aria-label="Search jobs"
            className="h-9 w-full rounded-lg border bg-surface pr-3 pl-8 text-sm placeholder:text-muted"
          />
        </form>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Job categories">
        {Object.entries(FEED_CATEGORY_GROUPS).map(([key, group]) => {
          const active = filters.groups.includes(key as FeedCategoryGroup);
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => toggleGroup(key as FeedCategoryGroup)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                active ? "border-accent bg-accent-soft text-accent" : "bg-surface text-muted hover:text-text",
              )}
            >
              {group.label}
            </button>
          );
        })}
      </div>
      </div>
    </div>
  );
}
