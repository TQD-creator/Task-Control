// Adaptive behavior model — learns the user's real working rhythm from data the
// app already records, using the same lightweight running-statistics family as
// estimation_calibration (no ML dependency). All pure functions so the whole
// thing is unit-testable in the scratchpad harness.
//
// Inputs come straight from the DB aggregates:
//   getCompletionStats().by_day   -> [{ day, count, minutes }]  (learned capacity)
//   getReliabilityStats()          -> on-time / late / slipped   (reliability)
//   getScheduleLoad()              -> upcoming planned minutes    (overload / suggest)

import { bucketKey } from './calibration.js';

const OVERLOAD = 1.25; // a day above 1.25× your usual pace reads as "overloaded"

// Recency-weighted daily capacity from getCompletionStats().by_day. Only days
// with real completions count. A linear ramp weights recent days higher so the
// estimate adapts as habits shift (the "learning" part). Returns null until a
// small floor of active days exists — no capacity claim from one good day.
export function learnedCapacity(byDay, minActiveDays = 3) {
  const days = (byDay || []).filter((d) => (d.count || 0) > 0);
  if (days.length < minActiveDays) return null;
  const sorted = [...days].sort((a, b) => (a.day < b.day ? -1 : 1));
  let wSum = 0;
  let mAcc = 0;
  let tAcc = 0;
  sorted.forEach((d, i) => {
    const w = i + 1; // oldest = 1 … newest = n
    wSum += w;
    mAcc += w * (d.minutes || 0);
    tAcc += w * (d.count || 0);
  });
  return {
    avgMinutes: Math.round(mAcc / wSum),
    avgTasks: Math.round((tAcc / wSum) * 10) / 10,
    activeDays: days.length,
  };
}

// The honest time a task will cost: the typed estimate scaled by the learned
// calibration ratio for its Effort/Impact bucket (>=2 samples, else 1×). Ties
// the two learning systems together so capacity math uses real minutes.
export function realisticMinutes(profile, effort, impact, estMinutes) {
  const est = Number.isFinite(estMinutes) && estMinutes > 0 ? estMinutes : 0;
  const bucket = profile?.estimation_calibration?.[bucketKey(effort, impact)];
  const ratio = bucket && bucket.sample_count >= 2 ? bucket.avg_actual_to_estimate_ratio : 1;
  return Math.round(est * ratio);
}

// 'light' | 'balanced' | 'overloaded' for a day's planned minutes vs capacity.
// Without a learned capacity yet, everything reads 'balanced' (no false alarms).
export function dayLoadStatus(minutes, capacity) {
  if (!capacity || !capacity.avgMinutes) return 'balanced';
  if (minutes > capacity.avgMinutes * OVERLOAD) return 'overloaded';
  if (minutes < capacity.avgMinutes * 0.6) return 'light';
  return 'balanced';
}

// Overall reliability rates from getReliabilityStats(). on-time/late are shares
// of *completed* work; slip is the share of everything (completed + open) that
// landed or is landing late.
export function reliabilityRates(stats) {
  if (!stats) return { onTimeRate: 0, lateRate: 0, slipRate: 0, done: 0, sample: 0 };
  const done = (stats.on_time || 0) + (stats.late || 0);
  const total = done + (stats.slipped_open || 0);
  return {
    onTimeRate: done ? (stats.on_time || 0) / done : 0,
    lateRate: done ? (stats.late || 0) / done : 0,
    slipRate: total ? ((stats.late || 0) + (stats.slipped_open || 0)) / total : 0,
    done,
    sample: total,
  };
}

// The soonest upcoming day whose existing planned load + addMinutes stays under
// capacity. `scheduleLoad` is getScheduleLoad() output. Returns an offset in
// days from scheduleLoad.from (0 = that day), or null if no day in the window
// has room. Used for New Task's "pick a lighter day".
export function soonestOpenDay(scheduleLoad, capacity, addMinutes) {
  if (!capacity || !capacity.avgMinutes || !scheduleLoad) return null;
  const cap = capacity.avgMinutes * OVERLOAD;
  const load = new Map((scheduleLoad.by_day || []).map((d) => [d.day, d.est_minutes || 0]));
  const base = scheduleLoad.from;
  const days = scheduleLoad.days || 14;
  for (let i = 0; i <= days; i += 1) {
    const day = addDaysStr(base, i);
    if ((load.get(day) || 0) + addMinutes <= cap) return i;
  }
  return null;
}

// Days to clear an open backlog (in realistic minutes) at the learned pace.
export function forecastDays(openBacklogMinutes, capacity) {
  if (!capacity || !capacity.avgMinutes || openBacklogMinutes <= 0) return null;
  return Math.ceil(openBacklogMinutes / capacity.avgMinutes);
}

// Minutes for a given YYYY-MM-DD in a getScheduleLoad() result (0 if that day
// carries no planned work).
export function loadForDay(scheduleLoad, day) {
  if (!scheduleLoad) return 0;
  const row = (scheduleLoad.by_day || []).find((d) => d.day === day);
  return row ? row.est_minutes || 0 : 0;
}

export function addDaysStr(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Whole days from isoA to isoB (B - A), UTC-aligned.
export function daysBetween(isoA, isoB) {
  const a = new Date(`${isoA}T00:00:00Z`);
  const b = new Date(`${isoB}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}
