// Dependency-free chart primitives (plain SVG/CSS) for the Insights screen.
// The repo intentionally avoids adding chart libraries, so these are small and
// purpose-built rather than general-purpose.

import React from 'react';

// A labeled horizontal bar. Used for the estimate-accuracy view where `value`
// is an actual/estimate ratio: 1.0 = dead-on. A baseline marker is drawn at
// `baseline` so over/under-estimation reads at a glance.
export function BarRow({ label, value, max = 2, baseline = 1, sublabel, over }) {
  const pct = Math.min(100, (value / max) * 100);
  const basePct = Math.min(100, (baseline / max) * 100);
  return (
    <div className="bar-row">
      <div className="bar-row-head">
        <span className="bar-row-label">{label}</span>
        <span className="bar-row-value">{value.toFixed(2)}×{sublabel ? ` · ${sublabel}` : ''}</span>
      </div>
      <div className="bar-track">
        <div className={`bar-fill${over ? ' bar-fill-over' : ' bar-fill-under'}`} style={{ width: `${pct}%` }} />
        <div className="bar-baseline" style={{ left: `${basePct}%` }} title={`baseline ${baseline}×`} />
      </div>
    </div>
  );
}

// GitHub-style contribution heatmap. `data` is [{ day: 'YYYY-MM-DD', count }].
// Renders `weeks` columns of 7 day-cells ending today (UTC-aligned to match the
// SQLite date() grouping the stats come from).
export function Heatmap({ data = [], weeks = 8 }) {
  const counts = new Map(data.map((d) => [d.day, d.count]));
  const max = data.reduce((m, d) => Math.max(m, d.count), 0);

  // End on today (UTC), start on the Sunday of the earliest visible week.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const totalDays = weeks * 7;
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - (totalDays - 1));
  start.setUTCDate(start.getUTCDate() - start.getUTCDay()); // back up to Sunday

  const cols = [];
  const cursor = new Date(start);
  while (cursor <= today) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const key = cursor.toISOString().slice(0, 10);
      const count = cursor <= today ? counts.get(key) || 0 : null;
      week.push({ key, count });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    cols.push(week);
  }

  function level(count) {
    if (count == null) return 'hm-empty';
    if (count === 0) return 'hm-0';
    if (max <= 1) return 'hm-4';
    const q = count / max;
    if (q > 0.66) return 'hm-4';
    if (q > 0.33) return 'hm-3';
    return 'hm-2';
  }

  return (
    <div className="heatmap" role="img" aria-label="Task completions over recent weeks">
      {cols.map((week, ci) => (
        <div className="heatmap-col" key={ci}>
          {week.map((cell) => (
            <div
              key={cell.key}
              className={`heatmap-cell ${level(cell.count)}`}
              title={cell.count == null ? '' : `${cell.key}: ${cell.count} completed`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
