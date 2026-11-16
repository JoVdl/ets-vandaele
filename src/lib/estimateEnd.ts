import { addDays, format, startOfDay } from 'date-fns';
import { isWorkingDay } from './workingDays';
import type { SuiviSession } from '../types/suivi';

export interface EndEstimate {
  date: Date;          // day the planned hours are reached at the current rhythm
  ratePerDay: number;  // hours worked per working day so far
  doneH: number;
  remainingH: number;
}

const keyOf = (d: Date) => format(d, 'yyyy-MM-dd');

// Working days (Mon–Fri, non-holiday, not marked off) since the first session, and the hours worked
// over them, give the rhythm. The remaining planned hours are spent at that rhythm from today.
export function estimateEnd(
  sessions: SuiviSession[],
  budgetH: number,
  offDays: Set<string>,
  now: Date = new Date(),
): EndEstimate | null {
  if (budgetH <= 0 || sessions.length === 0) return null;
  const doneH = sessions.reduce((a, s) => a + s.dureeMinutes, 0) / 60;
  const remainingH = budgetH - doneH;
  const first = sessions.reduce((min, s) => (new Date(s.dateDebut) < min ? new Date(s.dateDebut) : min), new Date(sessions[0].dateDebut));
  const today = startOfDay(now);
  let elapsed = 0;
  for (let d = startOfDay(first); d <= today; d = addDays(d, 1)) {
    if (isWorkingDay(d) && !offDays.has(keyOf(d))) elapsed++;
  }
  const ratePerDay = doneH / Math.max(1, elapsed);
  if (ratePerDay <= 0) return null;
  if (remainingH <= 0) return { date: today, ratePerDay, doneH, remainingH: 0 };
  let left = remainingH;
  let d = today;
  for (let guard = 0; guard < 5000; guard++) {
    if (isWorkingDay(d) && !offDays.has(keyOf(d))) {
      left -= ratePerDay;
      if (left <= 0) break;
    }
    d = addDays(d, 1);
  }
  return { date: d, ratePerDay, doneH, remainingH };
}

