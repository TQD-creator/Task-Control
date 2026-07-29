// "New Task" screen — the gap flagged in USER_GUIDE.md: Goals and Milestones
// had creation screens but Tasks didn't. Same Action/Artifact + Effort/Impact
// pattern as NewMilestoneScreen, scoped to a single milestone.

import React, { useEffect, useState } from 'react';
import EffortImpactMatrix from '../components/EffortImpactMatrix.jsx';
import { suggestEstimate } from '../lib/calibration.js';

export default function NewTaskScreen({ milestoneId, onSave, onCancel }) {
  const [title, setTitle] = useState('');
  const [action, setAction] = useState('');
  const [artifact, setArtifact] = useState('');
  const [effort, setEffort] = useState('low');
  const [impact, setImpact] = useState('low');
  const [estimatedMinutes, setEstimatedMinutes] = useState('30');
  const [dayOffset, setDayOffset] = useState('0');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [profile, setProfile] = useState(null);

  // Load the profile once so we can offer a calibration-based estimate hint.
  useEffect(() => {
    window.api.profile.load().then(setProfile).catch(() => {});
  }, []);

  // A suggestion for the current quadrant, if the user has enough history there.
  const hint = suggestEstimate(profile, effort, impact, parseInt(estimatedMinutes, 10));

  const canSave = title.trim().length > 0;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      const parsedMinutes = parseInt(estimatedMinutes, 10);
      const parsedOffset = parseInt(dayOffset, 10);
      const task = await window.api.tasks.create({
        milestoneId,
        title: title.trim(),
        action: action.trim() || null,
        artifact: artifact.trim() || null,
        effort,
        impact,
        estimatedMinutes: Number.isFinite(parsedMinutes) ? parsedMinutes : 0,
        dayOffset: Number.isFinite(parsedOffset) ? parsedOffset : 0,
      });
      onSave?.(task);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container">
      <h1 className="heading">New Task</h1>

      <label className="label">Title</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sketch a wireframe" />

      <div className="split-row">
        <div className="split-col">
          <label className="label">Action (optional)</label>
          <input className="input" value={action} onChange={(e) => setAction(e.target.value)} placeholder="Sketch" />
        </div>
        <div className="split-col">
          <label className="label">Artifact (optional)</label>
          <input className="input" value={artifact} onChange={(e) => setArtifact(e.target.value)} placeholder="a wireframe" />
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <EffortImpactMatrix effort={effort} impact={impact} onChange={({ effort, impact }) => { setEffort(effort); setImpact(impact); }} />
      </div>

      <div className="split-row">
        <div className="split-col">
          <label className="label">Estimated minutes</label>
          <input className="input" type="number" min="0" value={estimatedMinutes} onChange={(e) => setEstimatedMinutes(e.target.value)} />
          {hint && (
            <p className="calibration-hint">
              History: <strong>{hint.label}</strong> tasks run ~{hint.ratio.toFixed(1)}× your estimate
              {' '}({hint.samples} logged). Consider{' '}
              <button type="button" className="calibration-hint-apply" onClick={() => setEstimatedMinutes(String(hint.suggested))}>
                {hint.suggested} min
              </button>.
            </p>
          )}
        </div>
        <div className="split-col">
          <label className="label">Starts (days from milestone start)</label>
          <input className="input" type="number" value={dayOffset} onChange={(e) => setDayOffset(e.target.value)} />
        </div>
      </div>

      {error && <p style={{ color: '#b91c1c', marginTop: 12 }}>{error}</p>}

      <div className="actions">
        <button type="button" className="button button-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button button-save" disabled={!canSave || saving} onClick={handleSave}>
          {saving ? 'Saving...' : 'Save Task'}
        </button>
      </div>
    </div>
  );
}