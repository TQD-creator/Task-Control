// "Quick Capture" — for when you're too lazy to fill in Action/Artifact
// fields yourself, or just had a random thought. Dump it in a category tag
// and an AI pass figures out the actual goal and breaks it down; nothing is
// saved yet, it just hands the result to CaptureReviewScreen.

import React, { useState } from 'react';

const CATEGORIES = ['Self-Improvement', 'Creative', 'Project Idea'];

export default function CaptureScreen({ onAnalyzed, onCancel, initialText = '' }) {
  const [rawText, setRawText] = useState(initialText);
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [customCategory, setCustomCategory] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);

  const effectiveCategory = useCustom ? customCategory.trim() : category;
  const canSubmit = rawText.trim().length > 0 && effectiveCategory.length > 0;

  async function handleAnalyze() {
    if (!canSubmit || analyzing) return;
    setAnalyzing(true);
    setError(null);
    try {
      const result = await window.api.ai.analyzeCapture(rawText.trim(), effectiveCategory);
      onAnalyzed({ result, rawText: rawText.trim(), category: effectiveCategory });
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="container">
      <h1 className="heading">Quick Capture</h1>
      <p className="section-label" style={{ marginTop: 0 }}>
        Dump whatever's on your mind — a stray idea, a half-formed thought. AI will figure out the goal and break it down; you'll review before anything is saved.
      </p>

      <label className="label">What's on your mind?</label>
      <textarea
        className="input"
        style={{ minHeight: 140 }}
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        placeholder="e.g. I keep thinking I should actually learn to cook a few real meals instead of ordering out every night, maybe start with like 5 solid recipes..."
        autoFocus
      />

      <label className="label">Category</label>
      <div className="matrix-grid" style={{ marginBottom: 8 }}>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className={`matrix-cell${!useCustom && category === c ? ' selected' : ''}`}
            style={{ width: 'auto', padding: '8px 16px' }}
            onClick={() => { setCategory(c); setUseCustom(false); }}
          >
            <span className="matrix-cell-label" style={{ fontSize: 13 }}>{c}</span>
          </button>
        ))}
        <button
          type="button"
          className={`matrix-cell${useCustom ? ' selected' : ''}`}
          style={{ width: 'auto', padding: '8px 16px' }}
          onClick={() => setUseCustom(true)}
        >
          <span className="matrix-cell-label" style={{ fontSize: 13 }}>Other...</span>
        </button>
      </div>

      {useCustom && (
        <input
          className="input"
          value={customCategory}
          onChange={(e) => setCustomCategory(e.target.value)}
          placeholder="Type your own category"
        />
      )}

      {error && <p style={{ color: '#b91c1c', marginTop: 12 }}>{error}</p>}

      <div className="actions">
        <button type="button" className="button button-cancel" onClick={onCancel} disabled={analyzing}>
          Cancel
        </button>
        <button type="button" className="button button-save" disabled={!canSubmit || analyzing} onClick={handleAnalyze}>
          {analyzing ? 'Analyzing...' : 'Analyze with AI'}
        </button>
      </div>
    </div>
  );
}
