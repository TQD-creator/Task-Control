// Insights — the readout the app never had. Everything here is data the app was
// already recording silently: the time_economy ledger, the estimation_calibration
// buckets, streaks, and per-task completion aggregates. Reads only (plus the
// repay/spend controls that close the economy loop, and Backup/Restore).

import React, { useCallback, useEffect, useState } from 'react';
import { BarRow, Heatmap, LoadStrip } from '../components/charts/Charts.jsx';
import { isUngaBunga } from '../lib/tone.js';
import { learnedCapacity, reliabilityRates } from '../lib/behaviorModel.js';

const QUADRANT_ORDER = ['Quick Win', 'Big Bet', 'Filler', 'Trap'];

const BUCKET_ORDER = [
  ['low_effort_high_impact', 'Low effort / High impact'],
  ['high_effort_high_impact', 'High effort / High impact'],
  ['low_effort_low_impact', 'Low effort / Low impact'],
  ['high_effort_low_impact', 'High effort / Low impact'],
];

const LEDGER_LABELS = {
  debt: 'Time Debt',
  debt_repayment: 'Debt repaid',
  bank: 'Guilt-Free Bank',
  bank_locked: 'Bank locked (Lock In)',
  boredom_tank: 'Tanked boredom',
  punishment: 'Punishment served',
};

function fmtHours(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtMinutes(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function describeLedger(entry) {
  const label = LEDGER_LABELS[entry.type] || entry.type;
  let detail = '';
  if (entry.type === 'boredom_tank') detail = `${Math.round((entry.duration_seconds || 0) / 60)} min`;
  else if (entry.type === 'punishment') detail = entry.label || entry.category || '';
  else if (typeof entry.delta_minutes === 'number') {
    const sign = entry.delta_minutes >= 0 ? '+' : '';
    detail = `${sign}${entry.delta_minutes} min`;
  }
  const note = entry.justification || (entry.defense_mechanism ? `(${entry.defense_mechanism})` : '');
  return { label, detail, note, date: (entry.date || '').slice(0, 10) };
}

export default function InsightsScreen({ onBack, tone }) {
  const [profile, setProfile] = useState(null);
  const [stats, setStats] = useState(null);
  const [reliability, setReliability] = useState(null);
  const [scheduleLoad, setScheduleLoad] = useState(null);
  const [repayAmt, setRepayAmt] = useState('15');
  const [spendAmt, setSpendAmt] = useState('15');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [mirrorDir, setMirrorDir] = useState(null);

  const load = useCallback(async () => {
    const [p, s, rel, sched] = await Promise.all([
      window.api.profile.load(),
      window.api.stats.overview(),
      window.api.stats.reliability(),
      window.api.stats.scheduleLoad(14),
    ]);
    setProfile(p);
    setStats(s);
    setReliability(rel);
    setScheduleLoad(sched);
  }, []);

  useEffect(() => { load(); }, [load]);

  const unga = isUngaBunga(tone ?? profile?.personalization?.tone_preference);

  if (!profile || !stats) {
    return (
      <div className="container">
        <div className="insights-header">
          <button type="button" className="button button-cancel" onClick={onBack}>← Back</button>
          <h1 className="heading" style={{ margin: 0 }}>📊 Insights</h1>
        </div>
        <p className="empty-state">Loading…</p>
      </div>
    );
  }

  const econ = profile.time_economy;
  const cal = profile.estimation_calibration || {};
  const streaks = profile.streaks || {};
  const notifOn = profile.personalization?.notifications_enabled !== false;
  const ledger = [...(econ.ledger || [])].reverse().slice(0, 20);

  async function repay() {
    const n = parseInt(repayAmt, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    setBusy(true);
    setProfile(await window.api.profile.repayDebt(n, null));
    setBusy(false);
  }
  async function spend() {
    const n = parseInt(spendAmt, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    setBusy(true);
    setProfile(await window.api.profile.spendBank(n, null));
    setBusy(false);
  }
  async function toggleNotifications() {
    setProfile(await window.api.profile.setNotifications(!notifOn));
  }
  async function exportData() {
    setNotice(null);
    const res = await window.api.data.export();
    if (res?.ok) setNotice(`Backup saved to ${res.dir}`);
    else if (res && !res.canceled) setNotice(res.error || 'Export failed.');
  }
  async function sendToMirror() {
    setNotice(null);
    const res = await window.api.data.sendToMirror();
    if (!res?.ok) {
      setNotice(res?.error || 'Could not send data to Mirror.');
      return;
    }
    setNotice(res.launched
      ? 'Sent to Mirror. Opening it now…'
      : `Sent to Mirror. Open Mirror and it will offer this snapshot (${res.dir}).`);
    setMirrorDir(res.dir);
  }
  async function importData() {
    setNotice(null);
    const res = await window.api.data.import();
    if (res && !res.ok && !res.canceled) setNotice(res.error || 'Import failed.');
    // On success the app relaunches, so no further UI update is needed.
  }

  return (
    <div className="container insights">
      <div className="insights-header">
        <button type="button" className="button button-cancel" onClick={onBack}>← Back</button>
        <h1 className="heading" style={{ margin: 0 }}>📊 Insights</h1>
      </div>

      {/* Top-line numbers */}
      <div className="insights-grid">
        <div className="stat-card"><div className="stat-num">{stats.completed}</div><div className="stat-cap">Tasks completed</div></div>
        <div className="stat-card"><div className="stat-num">{stats.open}</div><div className="stat-cap">Still open</div></div>
        <div className="stat-card"><div className="stat-num">{fmtHours(stats.total_seconds)}</div><div className="stat-cap">Time tracked</div></div>
        <div className="stat-card"><div className="stat-num">🔥 {streaks.current_streak_days || 0}</div><div className="stat-cap">Day streak · best {streaks.longest_streak_days || 0}</div></div>
      </div>

      {/* Time economy */}
      <h2 className="insights-section-title">Time economy</h2>
      <div className="insights-grid-2">
        <div className="econ-card econ-debt">
          <div className="econ-label">Time Debt</div>
          <div className="econ-num">{econ.time_debt_minutes} min</div>
          <div className="econ-action">
            <input className="input econ-input" type="number" min="1" value={repayAmt} onChange={(e) => setRepayAmt(e.target.value)} />
            <button type="button" className="button button-save" disabled={busy || econ.time_debt_minutes <= 0} onClick={repay}>Repay</button>
          </div>
        </div>
        <div className="econ-card econ-bank">
          <div className="econ-label">Guilt-Free Bank</div>
          <div className="econ-num">{econ.guilt_free_bank_minutes} min</div>
          {unga ? (
            <div className="econ-note">Locked while Lock In is on — the streak is the reward.</div>
          ) : (
            <div className="econ-action">
              <input className="input econ-input" type="number" min="1" value={spendAmt} onChange={(e) => setSpendAmt(e.target.value)} />
              <button type="button" className="button button-save" disabled={busy || econ.guilt_free_bank_minutes <= 0} onClick={spend}>Spend</button>
            </div>
          )}
        </div>
      </div>

      {/* Estimate accuracy */}
      <h2 className="insights-section-title">Estimate accuracy</h2>
      {BUCKET_ORDER.every(([k]) => (cal[k]?.sample_count || 0) === 0) ? (
        <p className="empty-state">Complete a few tasks to see how your estimates hold up.</p>
      ) : (
        <div className="accuracy-list">
          {BUCKET_ORDER.map(([key, label]) => {
            const b = cal[key] || { sample_count: 0, avg_actual_to_estimate_ratio: 1 };
            if (b.sample_count === 0) return null;
            return (
              <BarRow
                key={key}
                label={label}
                value={b.avg_actual_to_estimate_ratio}
                over={b.avg_actual_to_estimate_ratio > 1}
                sublabel={`${b.sample_count} logged`}
              />
            );
          })}
          <p className="accuracy-legend">1.00× = dead-on. Over 1 means tasks run longer than you estimate.</p>
        </div>
      )}

      {/* Reliability & capacity — the adaptive layer: how work lands against its
          own dates, and the daily throughput the app has learned. */}
      <h2 className="insights-section-title">Reliability &amp; capacity</h2>
      {(() => {
        const capacity = learnedCapacity(stats.by_day);
        const rates = reliabilityRates(reliability);
        const byQuad = reliability?.by_quadrant || {};
        const plannedMinutes = (scheduleLoad?.by_day || []).reduce((s, d) => s + (d.est_minutes || 0), 0);
        const forecast = capacity && plannedMinutes > 0 ? Math.ceil(plannedMinutes / capacity.avgMinutes) : null;

        if (rates.sample === 0 && !capacity) {
          return <p className="empty-state">Complete and schedule a few tasks to learn your rhythm — on-time rate, slip rate, and your realistic daily capacity.</p>;
        }
        return (
          <>
            <div className="insights-grid">
              <div className="stat-card"><div className="stat-num">{Math.round(rates.onTimeRate * 100)}%</div><div className="stat-cap">Finished on time</div></div>
              <div className="stat-card"><div className="stat-num">{Math.round(rates.lateRate * 100)}%</div><div className="stat-cap">Finished late</div></div>
              <div className="stat-card"><div className="stat-num">{reliability?.slipped_open || 0}</div><div className="stat-cap">Slipped · open &amp; overdue</div></div>
              <div className="stat-card">
                <div className="stat-num">{capacity ? fmtMinutes(capacity.avgMinutes) : '—'}</div>
                <div className="stat-cap">{capacity ? `~${capacity.avgTasks} tasks / active day` : 'Capacity: not enough data'}</div>
              </div>
            </div>

            {QUADRANT_ORDER.some((q) => byQuad[q]) && (
              <div className="rel-quadrants">
                {QUADRANT_ORDER.filter((q) => byQuad[q]).map((q) => {
                  const c = byQuad[q];
                  const total = c.on_time + c.late + c.slipped;
                  const pctOnTime = total ? Math.round((c.on_time / total) * 100) : 0;
                  return (
                    <div className="rel-row" key={q}>
                      <span className="rel-row-label">{q}</span>
                      <div className="rel-bar-track">
                        {c.on_time > 0 && <div className="rel-seg rel-on-time" style={{ width: `${(c.on_time / total) * 100}%` }} title={`${c.on_time} on time`} />}
                        {c.late > 0 && <div className="rel-seg rel-late" style={{ width: `${(c.late / total) * 100}%` }} title={`${c.late} late`} />}
                        {c.slipped > 0 && <div className="rel-seg rel-slipped" style={{ width: `${(c.slipped / total) * 100}%` }} title={`${c.slipped} slipped`} />}
                      </div>
                      <span className="rel-row-pct">{pctOnTime}% on time</span>
                    </div>
                  );
                })}
                <p className="accuracy-legend">
                  <span className="rel-key rel-on-time" /> on time &nbsp;
                  <span className="rel-key rel-late" /> late &nbsp;
                  <span className="rel-key rel-slipped" /> slipped
                </p>
              </div>
            )}

            <h3 className="insights-subtitle">Planned load · next {scheduleLoad?.days || 14} days</h3>
            <LoadStrip load={scheduleLoad} capacityMinutes={capacity?.avgMinutes} days={scheduleLoad?.days || 14} />
            {capacity && plannedMinutes > 0 && (
              <p className="accuracy-legend">
                {fmtMinutes(plannedMinutes)} of work scheduled in view — about {forecast} day{forecast === 1 ? '' : 's'} at your ~{fmtMinutes(capacity.avgMinutes)}/day pace.
              </p>
            )}
          </>
        );
      })()}

      {/* Consistency */}
      <h2 className="insights-section-title">Consistency</h2>
      <Heatmap data={stats.by_day} weeks={stats.weeks} />

      {/* Recent activity */}
      <h2 className="insights-section-title">Recent activity</h2>
      {ledger.length === 0 ? (
        <p className="empty-state">Nothing logged yet.</p>
      ) : (
        <ul className="ledger-list">
          {ledger.map((entry, i) => {
            const d = describeLedger(entry);
            return (
              <li className="ledger-item" key={i}>
                <span className={`ledger-tag ledger-${entry.type}`}>{d.label}</span>
                <span className="ledger-detail">{d.detail}{d.note ? ` — ${d.note}` : ''}</span>
                <span className="ledger-date">{d.date}</span>
              </li>
            );
          })}
        </ul>
      )}

      {/* Settings: reminders + backup */}
      <h2 className="insights-section-title">Reminders &amp; data</h2>
      <div className="insights-settings">
        <label className="settings-row">
          <input type="checkbox" checked={notifOn} onChange={toggleNotifications} />
          Notify me about tasks due today or overdue
        </label>
        <div className="settings-row">
          <button type="button" className="button button-cancel" onClick={exportData}>Export backup…</button>
          <button type="button" className="button button-cancel" onClick={importData}>Restore backup…</button>
          <button type="button" className="button button-cancel" onClick={sendToMirror}>Send to Mirror</button>
          {mirrorDir && (
            <button type="button" className="button button-cancel" onClick={() => window.api.data.revealPath(mirrorDir)}>
              Show snapshot
            </button>
          )}
        </div>
        {notice && <p className="settings-notice">{notice}</p>}
      </div>
    </div>
  );
}
