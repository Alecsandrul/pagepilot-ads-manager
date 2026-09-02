import type { DateRange } from "./types";

/** Format a Date as YYYY-MM-DD in local time. */
export function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

/**
 * Presets end at yesterday, the most recent complete synced day.
 * "Last 7 days" = the 7 days ending yesterday.
 */
export function preset(days: 7 | 14 | 30): DateRange {
  return {
    from: iso(daysAgo(days)),
    to: iso(daysAgo(1)),
    label: `Last ${days} days`,
  };
}

export const DEFAULT_RANGE: DateRange = preset(30);

/** Number of days in an inclusive range. */
export function rangeDays(r: DateRange): number {
  const a = new Date(r.from + "T12:00:00");
  const b = new Date(r.to + "T12:00:00");
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

/** The equal length period immediately before the range, for deltas. */
export function previousRange(r: DateRange): { from: string; to: string } {
  const n = rangeDays(r);
  const from = new Date(r.from + "T12:00:00");
  const prevTo = new Date(from);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(from);
  prevFrom.setDate(prevFrom.getDate() - n);
  return { from: iso(prevFrom), to: iso(prevTo) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pretty(isoDate: string, withYear: boolean): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}${withYear ? " " + y : ""}`;
}

/** "3 Aug to 1 Sep 2026" style display (no dash characters in copy). */
export function rangeLabel(r: DateRange): string {
  const sameYear = r.from.slice(0, 4) === r.to.slice(0, 4);
  return `${pretty(r.from, !sameYear)} to ${pretty(r.to, true)}`;
}

/** Short relative time for sync freshness. */
export function relativeTime(isoTs: string): string {
  const ms = Date.now() - new Date(isoTs).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
