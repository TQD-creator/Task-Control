// Preparation phase — the sympathetic "help me get ready" flow for one task.
// Shows the tools/materials to gather, a get-ready checklist, a "what you've
// done" notes box (all saved to tasks.prep_json), and the follow-ups the task
// leaves behind. A "Suggest prep" button asks the local AI to propose all of it;
// nothing is saved until the user accepts. Works fully manually if the AI is
// unavailable.

import React, { useCallback, useEffect, useState } from 'react';
import { copy } from '../lib/tone.js';
import { KIND_LABELS } from '../lib/followUps.js';

function parsePrep(task) {
  try {
    const p = task?.prep_json ? JSON.parse(task.prep_json) : null;
    if (p && typeof p === 'object') {
      return { tools: p.tools || [], checklist: p.checklist || [], notes: p.notes || '' };
    }
  } catch { /* fall through to empty */ }
  return { tools: [], checklist: [], notes: '' };
}

export default function PrepScreen({ task, tone, onBack, onChanged }) {
  const [prep, setPrep] = useState(() => parsePrep(task));
  const [followups, setFollowups] = useState([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState(null);
  const [aiError, setAiError] = useState(null);
  const [newTool, setNewTool] = useState('');
  const [newStep, setNewStep] = useState('');
  const [draft, setDraft] = useState({ kind: 'submit', label: '', question: '', dueDate: '' });

  const refreshFollowups = useCallback(async () => {
    setFollowups(await window.api.followups.byTask(task.id));
  }, [task.id]);

  useEffect(() => { refreshFollowups(); }, [refreshFollowups]);

  const savePrep = useCallback(async (next) => {
    await window.api.tasks.update(task.id, { prep_json: JSON.stringify(next ?? prep) });
  }, [task.id, prep]);

  // Tools / checklist / notes editing (local until saved).
  function addTool() {
    if (!newTool.trim()) return;
    setPrep((p) => ({ ...p, tools: [...p.tools, newTool.trim()] }));
    setNewTool('');
  }
  function removeTool(i) { setPrep((p) => ({ ...p, tools: p.tools.filter((_, x) => x !== i) })); }
  function addStep() {
    if (!newStep.trim()) return;
    setPrep((p) => ({ ...p, checklist: [...p.checklist, { text: newStep.trim(), done: false }] }));
    setNewStep('');
  }
  function toggleStep(i) {
    setPrep((p) => ({ ...p, checklist: p.checklist.map((c, x) => (x === i ? { ...c, done: !c.done } : c)) }));
  }
  function removeStep(i) { setPrep((p) => ({ ...p, checklist: p.checklist.filter((_, x) => x !== i) })); }

  // AI suggestion (advisory; user accepts items into the real prep).
  async function suggest() {
    setSuggesting(true); setAiError(null); setSuggestion(null);
    try {
      setSuggestion(await window.api.ai.generatePrep(task.id));
    } catch (e) {
      setAiError(e?.message || 'Could not reach the local AI. You can still fill this in yourself.');
    } finally {
      setSuggesting(false);
    }
  }
  function acceptTool(t) { setPrep((p) => (p.tools.includes(t) ? p : { ...p, tools: [...p.tools, t] })); }
  function acceptStep(s) { setPrep((p) => ({ ...p, checklist: [...p.checklist, { text: s, done: false }] })); }
  async function acceptFollowup(f) {
    await window.api.followups.create({ taskId: task.id, kind: f.kind, label: f.label, question: f.question });
    await refreshFollowups();
    onChanged?.();
  }

  async function addManualFollowup() {
    if (!draft.label.trim()) return;
    await window.api.followups.create({
      taskId: task.id,
      kind: draft.kind,
      label: draft.label.trim(),
      question: draft.question.trim() || null,
      dueDate: draft.dueDate || null,
    });
    setDraft({ kind: 'submit', label: '', question: '', dueDate: '' });
    await refreshFollowups();
    onChanged?.();
  }
  async function removeFollowup(id) {
    await window.api.followups.delete(id);
    await refreshFollowups();
    onChanged?.();
  }

  async function startTimer() {
    await savePrep();
    window.api.timer.openWidget(task.milestone_id);
    onBack();
  }
  async function saveAndBack() { await savePrep(); onBack(); }

  return (
    <div className="container prep-screen">
      <div className="screen-header">
        <button type="button" className="button button-cancel" onClick={saveAndBack}>← Save & back</button>
        <h1 className="heading" style={{ margin: 0 }}>🧰 {copy(tone, 'prepHeading')}</h1>
      </div>

      <div className="prep-task">
        <div className="prep-task-title">{task.title}</div>
        {(task.action || task.artifact) && (
          <div className="prep-task-artifact">{[task.action, task.artifact].filter(Boolean).join(' → ')}</div>
        )}
        <p className="prep-body">{copy(tone, 'prepBody')}</p>
      </div>

      <div className="prep-suggest-row">
        <button type="button" className="button button-save" onClick={suggest} disabled={suggesting}>
          {suggesting ? 'Thinking…' : '✨ Suggest prep'}
        </button>
        {aiError && <span className="prep-ai-error">{aiError}</span>}
      </div>

      {suggestion && (
        <div className="prep-suggestion">
          <div className="prep-suggestion-title">Suggestions — tap to add</div>
          {suggestion.tools?.length > 0 && (
            <div className="prep-suggestion-group">
              <span className="prep-suggestion-label">Tools</span>
              {suggestion.tools.map((t, i) => (
                <button key={i} type="button" className="prep-chip" onClick={() => acceptTool(t)}>+ {t}</button>
              ))}
            </div>
          )}
          {suggestion.checklist?.length > 0 && (
            <div className="prep-suggestion-group">
              <span className="prep-suggestion-label">Steps</span>
              {suggestion.checklist.map((s, i) => (
                <button key={i} type="button" className="prep-chip" onClick={() => acceptStep(s)}>+ {s}</button>
              ))}
            </div>
          )}
          {suggestion.followups?.length > 0 && (
            <div className="prep-suggestion-group">
              <span className="prep-suggestion-label">Follow-ups</span>
              {suggestion.followups.map((f, i) => (
                <button key={i} type="button" className="prep-chip prep-chip-followup" onClick={() => acceptFollowup(f)}>
                  + {f.label} <em>({KIND_LABELS[f.kind] || f.kind})</em>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="prep-section">
        <h2 className="prep-h2">Tools & materials</h2>
        {prep.tools.length === 0 && <p className="prep-hint">What do you need in front of you?</p>}
        <ul className="prep-tools">
          {prep.tools.map((t, i) => (
            <li key={i}><span>{t}</span><button type="button" className="prep-x" onClick={() => removeTool(i)}>✕</button></li>
          ))}
        </ul>
        <div className="prep-add">
          <input className="input" placeholder="Add a tool / file / account" value={newTool}
            onChange={(e) => setNewTool(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTool()} />
          <button type="button" className="button button-cancel" onClick={addTool}>Add</button>
        </div>
      </div>

      <div className="prep-section">
        <h2 className="prep-h2">Get-ready checklist</h2>
        <ul className="prep-checklist">
          {prep.checklist.map((c, i) => (
            <li key={i} className={c.done ? 'done' : ''}>
              <label>
                <input type="checkbox" checked={c.done} onChange={() => toggleStep(i)} />
                <span>{c.text}</span>
              </label>
              <button type="button" className="prep-x" onClick={() => removeStep(i)}>✕</button>
            </li>
          ))}
        </ul>
        <div className="prep-add">
          <input className="input" placeholder="Add a get-ready step" value={newStep}
            onChange={(e) => setNewStep(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addStep()} />
          <button type="button" className="button button-cancel" onClick={addStep}>Add</button>
        </div>
      </div>

      <div className="prep-section">
        <h2 className="prep-h2">What you've done</h2>
        <textarea className="input" placeholder="Jot what you've prepared / where you left off…"
          value={prep.notes} onChange={(e) => setPrep((p) => ({ ...p, notes: e.target.value }))} />
      </div>

      <div className="prep-section">
        <h2 className="prep-h2">Follow-ups <span className="prep-count">{followups.filter((f) => f.state !== 'resolved').length}</span></h2>
        {followups.length === 0 && <p className="prep-hint">Loose ends this task will leave — the app will remind you.</p>}
        <ul className="prep-followups">
          {followups.map((f) => (
            <li key={f.id} className={f.state === 'resolved' ? 'resolved' : ''}>
              <div>
                <span className="prep-fu-kind">{KIND_LABELS[f.kind] || 'Follow-up'}</span>
                <span className="prep-fu-label">{f.label}</span>
                {f.state === 'resolved' && <span className="prep-fu-done">✓ done</span>}
              </div>
              <button type="button" className="prep-x" onClick={() => removeFollowup(f.id)}>✕</button>
            </li>
          ))}
        </ul>
        <div className="prep-followup-form">
          <select value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value }))}>
            <option value="submit">Submit by a deadline</option>
            <option value="notify_wait">Email someone & await reply</option>
            <option value="custom">Other loose end</option>
          </select>
          <input className="input" placeholder="Label (e.g. Submit on the portal)" value={draft.label}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} />
          {draft.kind === 'submit' && (
            <input className="input" type="date" value={draft.dueDate}
              onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value }))} title="Start nudging near this date" />
          )}
          <button type="button" className="button button-cancel" onClick={addManualFollowup}>Add follow-up</button>
        </div>
      </div>

      <div className="prep-footer">
        <button type="button" className="button button-save" onClick={startTimer}>▶ Start & time it</button>
      </div>
    </div>
  );
}
