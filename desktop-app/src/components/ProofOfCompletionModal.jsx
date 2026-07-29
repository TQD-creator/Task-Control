import React, { useState, useEffect } from 'react';

export default function ProofOfCompletionModal({ visible, task, onSubmit, onClose }) {
  const [actualMinutes, setActualMinutes] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (visible) {
      setActualMinutes(task?.estimated_minutes ? String(task.estimated_minutes) : '');
      setNote('');
    }
  }, [visible, task]);

  if (!visible || !task) return null;

  const parsedMinutes = parseInt(actualMinutes, 10);
  const canSubmit = Number.isFinite(parsedMinutes) && parsedMinutes >= 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-heading">Proof of Completion</h2>
        <div>{task.title}</div>
        <div className="modal-meta">Estimated: {task.estimated_minutes} min</div>

        <label className="label">Actual time spent (minutes)</label>
        <input
          className="input"
          type="number"
          min="0"
          value={actualMinutes}
          onChange={(e) => setActualMinutes(e.target.value)}
          placeholder="e.g. 45"
        />

        <label className="label">Proof / notes (optional)</label>
        <textarea
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What did you actually produce?"
        />

        <div className="actions">
          <button type="button" className="button button-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button button-complete"
            disabled={!canSubmit}
            onClick={() => onSubmit(parsedMinutes, note.trim() || null)}
          >
            Mark Complete
          </button>
        </div>
      </div>
    </div>
  );
}
