const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertDate(value: string, field = "date"): void {
  if (!ISO_DATE.test(value)) throw new Error(`${field} must use YYYY-MM-DD`);
  const parts = value.split("-").map(Number);
  const year = parts[0]!;
  const month = parts[1]!;
  const day = parts[2]!;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new Error(`${field} is not a valid calendar date`);
  }
}

export function compareDate(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isLastDayOfMonth(value: string): boolean {
  assertDate(value);
  const date = toUtcDate(value);
  const nextDay = new Date(date.getTime());
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return nextDay.getUTCMonth() !== date.getUTCMonth();
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function addMonthsFromAnchor(anchor: string, months: number): string {
  assertDate(anchor, "anchor");
  const parts = anchor.split("-").map(Number);
  const year = parts[0]!;
  const month = parts[1]!;
  const day = parts[2]!;
  const anchorIsMonthEnd = isLastDayOfMonth(anchor);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const targetDay = anchorIsMonthEnd
    ? daysInMonth(target.getUTCFullYear(), target.getUTCMonth())
    : Math.min(day, daysInMonth(target.getUTCFullYear(), target.getUTCMonth()));
  target.setUTCDate(targetDay);
  return formatDate(target);
}

export function toUtcDate(value: string): Date {
  assertDate(value);
  const parts = value.split("-").map(Number);
  const year = parts[0]!;
  const month = parts[1]!;
  const day = parts[2]!;
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
