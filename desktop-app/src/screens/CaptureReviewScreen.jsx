// Review/edit the AI's proposed Goal + Milestones + Tasks before any of it
// touches the database. Nothing is written until "Save to Task Control" is
// pressed — you can edit titles/estimates or drop anything the model got
// wrong first.

import React, { useState } from 'react';

const EFFORT_IMPACT_COLORS = {
  'low-low': '#9ca3af',
  'low-high': '#16a34a',
  'high-low': '#f59e0b',
  'high-high': '#2563eb',
};

function Badge({ effort, impact }) {
  const color = EFFORT_IMPACT_COLORS[`${effort}-${impact}`] ?? '#9ca3af';
  return (
    <span className="badge" style={{ backgroundColor: color }}>
      {effort}/{impact}
    </span>
  );
}

function normalizeDraft(result) {
  const goal = result?.goal ?? {};
  const milestones = Array.isArray(result?.milestones) ? result.milestones : [];
  return {
    goal: {
      title: goal.title ?? '',
      action: goal.action ?? '',
      artifact: goal.artifact ?? '',
    },
    milestones: milestones.map((m) => ({
      title: m.title ?? 'Untitled milestone',
      action: m.action ?? '',
      artifact: m.artifact ?? '',
      effort: m.effort === 'high' ? 'high' : 'low',
      impact: m.impact === 'high' ? 'high' : 'low',
      day_offset: Number.isFinite(m.day_offset) ? m.day_offset : 0,
      tasks: Array.isArray(m.tasks)
        ? m.tasks.map((t) => ({
            title: t.title ?? 'Untitled task',
            action: t.action ?? '',
            artifact: t.artifact ?? '',
            effort: t.effort === 'high' ? 'high' : 'low',
            impact: t.impact === 'high' ? 'high' : 'low',
            day_offset: Number.isFinite(t.day_offset) ? t.day_offset : 0,
            estimated_minutes: Number.isFinite(t.estimated_minutes) ? t.estimated_minutes : 30,
          }))
        : [],
    })),
  };
}

export default function CaptureReviewScreen({ analysis, onSaved, onCancel }) {
  const [draft, setDraft] = useState(() => normalizeDraft(analysis.result));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function updateGoalField(field, value) {
    setDraft((d) => ({ ...d, goal: { ...d.goal, [field]: value } }));
  }

  function updateMilestoneField(mIndex, field, value) {
    setDraft((d) => ({
      ...d,
      milestones: d.milestones.map((m, i) => (i === mIndex ? { ...m, [field]: value } : m)),
    }));
  }

  function removeMilestone(mIndex) {
    setDraft((d) => ({ ...d, milestones: d.milestones.filter((_, i) => i !== mIndex) }));
  }

  function updateTaskField(mIndex, tIndex, field, value) {
    setDraft((d) => ({
      ...d,
      milestones: d.milestones.map((m, i) =>
        i === mIndex ? { ...m, tasks: m.tasks.map((t, j) => (j === tIndex ? { ...t, [field]: value } : t)) } : m
      ),
    }));
  }

  function removeTask(mIndex, tIndex) {
    setDraft((d) => ({
      ...d,
      milestones: d.milestones.map((m, i) => (i === mIndex ? { ...m, tasks: m.tasks.filter((_, j) => j !== tIndex) } : m)),
    }));
  }

  const canSave = draft.goal.title.trim().length > 0;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      const goal = await window.api.goals.create({
        title: draft.goal.title.trim(),
        action: draft.goal.action.trim() || null,
        artifact: draft.goal.artifact.trim() || null,
        category: analysis.category,
      });

      for (const milestone of draft.milestones) {
        const createdMilestone = await window.api.milestones.create({
          goalId: goal.id,
          title: milestone.title.trim(),
          action: milestone.action.trim() || null,
          artifact: milestone.artifact.trim() || null,
          effort: milestone.effort,
          impact: milestone.impact,
          dayOffset: milestone.day_offset,
        });

        for (const task of milestone.tasks) {
          await window.api.tasks.create({
            milestoneId: createdMilestone.id,
            title: task.title.trim(),
            action: task.action.trim() || null,
            artifact: task.artifact.trim() || null,
            effort: task.effort,
            impact: task.impact,
            estimatedMinutes: task.estimated_minutes,
            dayOffset: task.day_offset,
          });
        }
      }

      await window.api.profile.addBigVagueGoal(goal.id, analysis.rawText);

      onSaved(goal);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container">
      <h1 className="heading">Review before saving</h1>
      <p className="section-label" style={{ marginTop: 0 }}>Category: {analysis.category}</p>

      <label className="label">Goal title</label>
      <input className="input" value={draft.goal.title} onChange={(e) => updateGoalField('title', e.target.value)} />

      <div className="split-row">
        <div className="split-col">
          <label className="label">Action</label>
          <input className="input" value={draft.goal.action} onChange={(e) => updateGoalField('action', e.target.value)} />
        </div>
        <div className="split-col">
          <label className="label">Artifact</label>
          <input className="input" value={draft.goal.artifact} onChange={(e) => updateGoalField('artifact', e.target.value)} />
        </div>
      </div>

      {draft.milestones.length === 0 && <p className="empty-state">No milestones proposed.</p>}

      {draft.milestones.map((milestone, mIndex) => (
        <div className="milestone-block" key={mIndex}>
          <div className="milestone-block-header">
            <input
              className="input"
              style={{ fontWeight: 700, marginRight: 8 }}
              value={milestone.title}
              onChange={(e) => updateMilestoneField(mIndex, 'title', e.target.value)}
            />
            <Badge effort={milestone.effort} impact={milestone.impact} />
            <button type="button" className="goal-title-edit-icon" title="Remove milestone" onClick={() => removeMilestone(mIndex)}>
              ✕
            </button>
          </div>

          <div className="task-sublist">
            {milestone.tasks.map((task, tIndex) => (
              <div className="task-row" key={tIndex}>
                <input
                  className="input"
                  style={{ flex: 1, marginRight: 8 }}
                  value={task.title}
                  onChange={(e) => updateTaskField(mIndex, tIndex, 'title', e.target.value)}
                />
                <input
                  className="input"
                  type="number"
                  min="0"
                  style={{ width: 80, marginRight: 8 }}
                  value={task.estimated_minutes}
                  onChange={(e) => updateTaskField(mIndex, tIndex, 'estimated_minutes', parseInt(e.target.value, 10) || 0)}
                />
                <button type="button" className="goal-title-edit-icon" title="Remove task" onClick={() => removeTask(mIndex, tIndex)}>
                  ✕
                </button>
              </div>
            ))}
            {milestone.tasks.length === 0 && <p className="empty-state" style={{ margin: '8px 0' }}>No tasks.</p>}
          </div>
        </div>
      ))}

      {error && <p style={{ color: '#b91c1c', marginTop: 12 }}>{error}</p>}

      <div className="actions">
        <button type="button" className="button button-cancel" onClick={onCancel} disabled={saving}>
          Discard
        </button>
        <button type="button" className="button button-save" disabled={!canSave || saving} onClick={handleSave}>
          {saving ? 'Saving...' : 'Save to Task Control'}
        </button>
      </div>
    </div>
  );
}
