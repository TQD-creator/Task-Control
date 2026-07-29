import React, { useState } from 'react';

export default function NewGoalScreen({ onSave, onCancel }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [action, setAction] = useState('');
  const [artifact, setArtifact] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const canSave = title.trim().length > 0 && action.trim().length > 0 && artifact.trim().length > 0;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      const goal = await window.api.goals.create({
        title: title.trim(),
        description: description.trim() || null,
        action: action.trim(),
        artifact: artifact.trim(),
        targetDate: targetDate.trim() || null,
      });

      await window.api.profile.addBigVagueGoal(goal.id, `${action.trim()} ${artifact.trim()}`);

      onSave?.(goal);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container">
      <h1 className="heading">New Goal</h1>

      <label className="label">Title</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Launch my portfolio site" />

      <label className="label">Description (optional)</label>
      <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Any extra context" />

      <p className="section-label">Split it: what will you do, and what will exist when it's done?</p>

      <div className="split-row">
        <div className="split-col">
          <label className="label">Action</label>
          <input className="input" value={action} onChange={(e) => setAction(e.target.value)} placeholder="Launch" />
        </div>
        <div className="split-col">
          <label className="label">Artifact</label>
          <input className="input" value={artifact} onChange={(e) => setArtifact(e.target.value)} placeholder="a personal portfolio site" />
        </div>
      </div>

      <label className="label">Target date (optional, YYYY-MM-DD)</label>
      <input className="input" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} placeholder="2026-09-01" />

      {error && <p style={{ color: '#b91c1c', marginTop: 12 }}>{error}</p>}

      <div className="actions">
        <button type="button" className="button button-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button button-save" disabled={!canSave || saving} onClick={handleSave}>
          {saving ? 'Saving...' : 'Save Goal'}
        </button>
      </div>
    </div>
  );
}
