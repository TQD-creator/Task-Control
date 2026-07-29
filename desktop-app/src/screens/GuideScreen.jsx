// Almighty Guide screen: kicks off the live-web RAG pipeline for one task,
// shows which phase the (slow, minutes-long) agentic loop is in, then renders
// the grounded tutorial with its source citations. If no Tavily key is set,
// it prompts for one first instead of failing.

import React, { useCallback, useEffect, useRef, useState } from 'react';

const PHASE_LABELS = {
  formulating: 'Formulating a search query…',
  searching: 'Searching the web…',
  evaluating: 'Checking whether the results are good enough…',
  retrying: 'Results were weak — rewriting the query and trying again…',
  synthesizing: 'Writing your tutorial from the sources…',
};

function KeyPrompt({ onSaved }) {
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!key.trim() || saving) return;
    setSaving(true);
    await window.api.settings.setTavilyKey(key.trim());
    onSaved();
  }

  return (
    <div className="container">
      <h1 className="heading">Connect web search</h1>
      <p className="section-label" style={{ marginTop: 0 }}>
        The Guide reads live web results via Tavily. Paste a Tavily API key (free tier at tavily.com) to enable it.
        It's stored locally on this machine and never leaves it except to call Tavily.
      </p>
      <label className="label">Tavily API key</label>
      <input className="input" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="tvly-..." />
      <div className="actions">
        <button type="button" className="button button-save" disabled={!key.trim() || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save key'}
        </button>
      </div>
    </div>
  );
}

export default function GuideScreen({ taskId, taskTitle, onBack }) {
  const [hasKey, setHasKey] = useState(null); // null = still checking
  const [phase, setPhase] = useState(null);
  const [phaseExtra, setPhaseExtra] = useState({});
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const startedRef = useRef(false);

  const run = useCallback(async () => {
    setError(null);
    setResult(null);
    setPhase('formulating');
    const unsubscribe = window.api.guide.onProgress((p) => {
      if (p.taskId !== taskId) return;
      setPhase(p.phase);
      setPhaseExtra(p);
    });
    try {
      const res = await window.api.guide.generate(taskId);
      setResult(res);
      setPhase(null);
    } catch (err) {
      setError(err.message);
      setPhase(null);
    } finally {
      unsubscribe();
    }
  }, [taskId]);

  // Check key on mount; auto-start the run once a key is present.
  useEffect(() => {
    window.api.settings.hasTavilyKey().then(setHasKey);
  }, []);

  useEffect(() => {
    if (hasKey && !startedRef.current) {
      startedRef.current = true;
      run();
    }
  }, [hasKey, run]);

  if (hasKey === null) return <div className="container">Checking configuration…</div>;
  if (!hasKey) return <KeyPrompt onSaved={() => setHasKey(true)} />;

  return (
    <div className="container">
      <button type="button" className="button button-cancel" onClick={onBack} style={{ marginBottom: 16 }}>
        ← Back
      </button>
      <h1 className="heading" style={{ marginBottom: 4 }}>Guide: {taskTitle}</h1>

      {phase && (
        <div className="guide-progress">
          <div className="guide-spinner" />
          <div>
            <div className="guide-phase-label">{PHASE_LABELS[phase] ?? phase}</div>
            {phaseExtra.query && <div className="task-card-meta">query: “{phaseExtra.query}”</div>}
            <div className="task-card-meta">This can take a few minutes on this machine — the local model is slow.</div>
          </div>
        </div>
      )}

      {error && (
        <div>
          <p style={{ color: '#b91c1c' }}>{error}</p>
          <button type="button" className="button button-save" onClick={run}>Try again</button>
        </div>
      )}

      {result && (
        <div className="guide-result">
          <h2 style={{ marginBottom: 4 }}>{result.guide.title}</h2>
          <p className="guide-summary">{result.guide.summary}</p>

          <ol className="guide-steps">
            {result.guide.steps.map((step, i) => (
              <li key={i} className="guide-step">
                <div className="guide-step-heading">{step.heading}</div>
                <div className="guide-step-detail">{step.detail}</div>
              </li>
            ))}
          </ol>

          {result.guide.caveats?.length > 0 && (
            <div className="guide-caveats">
              <div className="guide-section-title">Not covered / watch out for</div>
              <ul>
                {result.guide.caveats.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}

          <div className="guide-sources">
            <div className="guide-section-title">Sources ({result.attempts} search attempt{result.attempts === 1 ? '' : 's'})</div>
            <ul>
              {result.sources.map((s, i) => (
                <li key={i}>
                  <a href={s.url} target="_blank" rel="noreferrer">{s.title || s.url}</a>
                </li>
              ))}
            </ul>
          </div>

          <button type="button" className="button button-cancel" onClick={run} style={{ marginTop: 12 }}>
            Regenerate
          </button>
        </div>
      )}
    </div>
  );
}
