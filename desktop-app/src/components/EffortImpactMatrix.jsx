import React from 'react';

const QUADRANTS = [
  { effort: 'low', impact: 'high', label: 'Quick Win', sub: 'Low Effort / High Impact' },
  { effort: 'high', impact: 'high', label: 'Big Bet', sub: 'High Effort / High Impact' },
  { effort: 'low', impact: 'low', label: 'Filler', sub: 'Low Effort / Low Impact' },
  { effort: 'high', impact: 'low', label: 'Trap', sub: 'High Effort / Low Impact' },
];

export default function EffortImpactMatrix({ effort, impact, onChange }) {
  return (
    <div>
      <span className="label">Effort / Impact</span>
      <div className="matrix-grid">
        {QUADRANTS.map((q) => {
          const selected = q.effort === effort && q.impact === impact;
          return (
            <button
              type="button"
              key={`${q.effort}-${q.impact}`}
              className={`matrix-cell${selected ? ' selected' : ''}`}
              onClick={() => onChange({ effort: q.effort, impact: q.impact })}
            >
              <div className="matrix-cell-label">{q.label}</div>
              <div className="matrix-cell-sub">{q.sub}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
