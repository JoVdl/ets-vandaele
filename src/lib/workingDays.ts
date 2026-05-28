import { addDays, getDay, differenceInCalendarDays, startOfDay } from 'date-fns';

// Easter Sunday via Meeus/Jones/Butcher algorithm
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day   = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
}

function frenchHolidays(year: number): Set<string> {
  const easter = easterSunday(year);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fixed = [
    new Date(year, 0, 1),  // Jour de l'An
    new Date(year, 4, 1),  // Fête du Travail
    new Date(year, 4, 8),  // Victoire 1945
    new Date(year, 6, 14), // Fête Nationale
    new Date(year, 7, 15), // Assomption
    new Date(year, 10, 1), // Toussaint
    new Date(year, 10, 11),// Armistice
    new Date(year, 11, 25),// Noël
  ];
  const variable = [
    addDays(easter, 1),   // Lundi de Pâques
    addDays(easter, 39),  // Ascension
    addDays(easter, 50),  // Lundi de Pentecôte
  ];
  return new Set([...fixed, ...variable].map(fmt));
}

const holidayCache = new Map<number, Set<string>>();
function getHolidays(year: number): Set<string> {
  if (!holidayCache.has(year)) holidayCache.set(year, frenchHolidays(year));
  return holidayCache.get(year)!;
}

function toKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isWorkingDay(date: Date): boolean {
  const dow = getDay(date);
  if (dow === 0 || dow === 6) return false;
  return !getHolidays(date.getFullYear()).has(toKey(date));
}

export function nextWorkingDay(date: Date): Date {
  let d = startOfDay(date);
  while (!isWorkingDay(d)) d = addDays(d, 1);
  return d;
}

export function prevWorkingDay(date: Date): Date {
  let d = startOfDay(date);
  while (!isWorkingDay(d)) d = addDays(d, -1);
  return d;
}

/** Count working days between two dates (inclusive) */
export function countWorkingDays(start: Date, end: Date): number {
  let count = 0;
  let d = startOfDay(start);
  const e = startOfDay(end);
  while (d <= e) {
    if (isWorkingDay(d)) count++;
    d = addDays(d, 1);
  }
  return count;
}

/** Add N working days to a date */
export function addWorkingDays(date: Date, days: number): Date {
  let d = startOfDay(date);
  let remaining = Math.abs(days);
  const dir = days >= 0 ? 1 : -1;
  while (remaining > 0) {
    d = addDays(d, dir);
    if (isWorkingDay(d)) remaining--;
  }
  return d;
}

interface Gap {
  start: Date;
  end: Date;
  workingDays: number;
  calendarDays: number;
}

/** Find free working-day gaps in a period given a list of occupied intervals */
export function findGaps(
  periodStart: Date,
  periodEnd: Date,
  intervals: Array<{ start: Date; end: Date }>,
): Gap[] {
  // Merge overlapping intervals
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Array<{ start: Date; end: Date }> = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= addDays(last.end, 1)) {
      last.end = iv.end > last.end ? iv.end : last.end;
    } else {
      merged.push({ ...iv });
    }
  }

  // Find gaps
  const gaps: Gap[] = [];
  let cursor = startOfDay(periodStart);
  for (const iv of merged) {
    const gapEnd = addDays(startOfDay(iv.start), -1);
    if (cursor <= gapEnd && cursor >= startOfDay(periodStart)) {
      const wd = countWorkingDays(cursor, gapEnd);
      if (wd > 0) {
        gaps.push({
          start: cursor,
          end: gapEnd,
          workingDays: wd,
          calendarDays: differenceInCalendarDays(gapEnd, cursor) + 1,
        });
      }
    }
    const nextStart = addDays(startOfDay(iv.end), 1);
    if (nextStart > cursor) cursor = nextStart;
  }
  // Trailing gap
  if (cursor <= startOfDay(periodEnd)) {
    const wd = countWorkingDays(cursor, periodEnd);
    if (wd > 0) {
      gaps.push({
        start: cursor,
        end: startOfDay(periodEnd),
        workingDays: wd,
        calendarDays: differenceInCalendarDays(startOfDay(periodEnd), cursor) + 1,
      });
    }
  }
  return gaps;
}

/** Annual CA for display: total divided by contract years (default 1) */
export function caAnnuel(chiffreAffaire: number, nombreAnnees?: number): number {
  const n = nombreAnnees && nombreAnnees > 1 ? nombreAnnees : 1;
  return n > 1 ? Math.round(chiffreAffaire / n) : chiffreAffaire;
}
