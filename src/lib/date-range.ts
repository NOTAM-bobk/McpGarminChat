export type ToolDateRange = {
  start: number | null;
  end: number | null;
  /** True when the range came from calendar dates (YYYY-MM-DD), not timestamps. */
  dateOnly?: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Collect explicit dates the model actually passed to tools so the UI can show
 * the data window an answer is based on. This never guesses or widens a range.
 */
export function collectToolDateRange(
  calls: Array<{ name: string; arguments: Record<string, unknown> }>,
): ToolDateRange {
  let start: number | null = null;
  let end: number | null = null;
  let sawDate = false;
  let sawTimestamp = false;

  const note = (time: number) => {
    if (!Number.isFinite(time)) return;
    if (start === null || time < start) start = time;
    if (end === null || time > end) end = time;
  };

  const visit = (value: unknown, depth = 0) => {
    if (depth > 3) return;
    if (typeof value === "string") {
      const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
      if (isoDate) {
        sawDate = true;
        note(Date.parse(`${isoDate[1]}-${isoDate[2]}-${isoDate[3]}T00:00:00Z`));
      }
      return;
    }
    if (typeof value === "number") {
      const ms = value > 10_000_000_000 ? value : value > 1_000_000_000 ? value * 1000 : null;
      if (ms !== null) {
        sawTimestamp = true;
        note(ms);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 20)) visit(item, depth + 1);
      return;
    }
    if (isPlainObject(value)) {
      for (const entry of Object.values(value)) visit(entry, depth + 1);
    }
  };

  for (const call of calls) visit(call.arguments);
  if (start !== null && end !== null && start > end) [start, end] = [end, start];
  return { start, end, dateOnly: sawDate && !sawTimestamp };
}

/** Human-readable range in the user's timezone, e.g. "Oct 15 – Oct 22, 2026". */
export function formatDateRange(range: ToolDateRange | null, timeZone: string): string | null {
  if (!range || (range.start === null && range.end === null)) return null;
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  // Calendar dates must not shift to the previous day in negative-offset zones.
  if (range.dateOnly) zone = "UTC";
  const short = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: zone });
  const long = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: zone,
  });
  if (range.start !== null && range.end !== null && range.start !== range.end) {
    return `${short.format(range.start)} – ${long.format(range.end)}`;
  }
  const single = range.end ?? range.start;
  return single === null ? null : long.format(single);
}
