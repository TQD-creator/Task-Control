import React, { useState } from 'react';
import EffortImpactMatrix from '../components/EffortImpactMatrix.jsx';

export default function NewMilestoneScreen({ goalId, onSave, onCancel }) {
  const [title, setTitle] = useState('');
  const [action, setAction] = useState('');
  const [artifact, setArtifact] = useState('');
  const [effort, setEffort] = useState('low');
  const [impact, setImpact] = useState('low');
  const [dayOffset, setDayOffset] = useState('0');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const canSave = title.trim().length > 0 && action.trim().length > 0 && artifact.trim().length > 0;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      const parsedOffset = parseInt(dayOffset, 10);
      const milestone = await window.api.milestones.create({
        goalId,
        title: title.trim(),
        action: action.trim(),
        artifact: artifact.trim(),
        effort,
        impact,
        dayOffset: Number.isFinite(parsedOffset) ? parsedOffset : 0,
      });
      onSave?.(milestone);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container">
      <h1 className="heading">New Milestone</h1>

      <label className="label">Title</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Ship the homepage" />

      <div className="split-row">
        <div className="split-col">
          <label className="label">Action</label>
          <input className="input" value={action} onChange={(e) => setAction(e.target.value)} placeholder="Build" />
        </div>
        <div className="split-col">
          <label className="label">Artifact</label>
          <input className="input" value={artifact} onChange={(e) => setArtifact(e.target.value)} placeholder="the homepage layout" />
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <EffortImpactMatrix effort={effort} impact={impact} onChange={({ effort, impact }) => { setEffort(effort); setImpact(impact); }} />
      </div>

      <label className="label">Starts (days from goal start)</label>
      <input className="input" type="number" value={dayOffset} onChange={(e) => setDayOffset(e.target.value)} placeholder="0" />

      {error && <p style={{ color: '#b91c1c', marginTop: 12 }}>{error}</p>}

      <div className="actions">
        <button type="button" className="button button-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button button-save" disabled={!canSave || saving} onClick={handleSave}>
          {saving ? 'Saving...' : 'Save Milestone'}
        </button>
      </div>
    </div>
  );
}
