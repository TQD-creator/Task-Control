// The Follow-ups inbox — where the app's check-ins get answered. A notification
// is only a nudge (OS toasts can't carry Yes/No on Windows); the actual "Did you
// submit?" / "Have they replied?" answers happen here. Each answer runs through
// the main-process state machine (window.api.followups.answer).

import React, { useCallback, useEffect, useState } from 'react';
import { questionFor, actionsFor, KIND_LABELS } from '../lib/followUps.js';

export default function FollowUpsInbox({ tone, onBack, onChanged }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setItems(await window.api.followups.pending());
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function answer(id, ans) {
    await window.api.followups.answer(id, ans);
    await refresh();
    onChanged?.();
  }

  async function remove(id) {
    await window.api.followups.delete(id);
    await refresh();
    onChanged?.();
  }

  return (
    <div className="container">
      <div className="screen-header">
        <button type="button" className="button button-cancel" onClick={onBack}>← Back</button>
        <h1 className="heading" style={{ margin: 0 }}>🧾 Follow-ups</h1>
      </div>

      {loading ? null : items.length === 0 ? (
        <p className="followup-empty">Nothing to chase right now. Loose ends will show up here.</p>
      ) : (
        <div className="followup-list">
          {items.map((f) => (
            <div key={f.id} className="followup-card">
              <div className="followup-main">
                <div className="followup-kind">{KIND_LABELS[f.kind] || 'Follow-up'}</div>
                <div className="followup-label">{f.label}</div>
                <div className="followup-task">
                  {f.task_title}{f.goal_title ? ` · ${f.goal_title}` : ''}
                </div>
                <div className="followup-question">{questionFor(f)}</div>
              </div>
              <div className="followup-actions">
                {actionsFor(f).map((a) => (
                  <button
                    key={a.answer}
                    type="button"
                    className={`button ${a.answer === 'not_yet' ? 'button-cancel' : 'button-complete'} followup-btn`}
                    onClick={() => answer(f.id, a.answer)}
                  >
                    {a.label}
                  </button>
                ))}
                <button type="button" className="followup-remove" onClick={() => remove(f.id)} title="Remove this follow-up">
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
