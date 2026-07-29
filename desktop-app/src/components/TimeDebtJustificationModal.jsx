import React, { useState, useEffect } from 'react';
import { copy, isUngaBunga, DEFENSE_MECHANISMS } from '../lib/tone.js';

// Overrun justification. In the default (encouraging) tone this is a free-text
// note. In Unga Bunga tone the free text is replaced by a required "Direction of
// Mind" pick — because for an avoidant profile a text box is just a place to
// write a sophisticated excuse. The chosen defense mechanism is logged to the
// ledger, and 'dopamine' additionally triggers the single-task penalty lock.
export default function TimeDebtJustificationModal({ visible, overrunMinutes, tone, onSubmit, onBack }) {
  const unga = isUngaBunga(tone);
  const [justification, setJustification] = useState('');
  const [mechanism, setMechanism] = useState(null);

  useEffect(() => {
    if (visible) {
      setJustification('');
      setMechanism(null);
    }
  }, [visible]);

  if (!visible) return null;

  function handleSubmit() {
    if (unga) {
      // Structured payload; parseJustification in profileEngine reads it.
      onSubmit({ defense_mechanism: mechanism, note: null });
    } else {
      onSubmit(justification.trim() || null);
    }
  }

  const disabled = unga && !mechanism;

  return (
    <div className="modal-backdrop" onClick={onBack}>
      <div className={`modal-card${unga ? ' modal-card-unga' : ''}`} onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-heading modal-heading-danger">
          {unga ? copy(tone, 'debtHeading') : `You ran over by ${overrunMinutes} min`}
        </h2>
        <p className="modal-body">
          {unga
            ? copy(tone, 'debtBody')
            : `This adds ${overrunMinutes} minutes to your Time Debt. What happened? A quick note helps future estimates.`}
        </p>

        {unga ? (
          <div className="defense-list">
            {DEFENSE_MECHANISMS.map((m) => (
              <label
                key={m.value}
                className={`defense-option${mechanism === m.value ? ' defense-option-selected' : ''}`}
              >
                <input
                  type="radio"
                  name="defense-mechanism"
                  value={m.value}
                  checked={mechanism === m.value}
                  onChange={() => setMechanism(m.value)}
                />
                <span>{m.label}</span>
              </label>
            ))}
          </div>
        ) : (
          <textarea
            className="input"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="e.g. Underestimated the setup step"
          />
        )}

        <div className="actions">
          <button type="button" className="button button-cancel" onClick={onBack}>
            Back
          </button>
          <button type="button" className="button button-danger" onClick={handleSubmit} disabled={disabled}>
            {copy(tone, 'debtSubmit')}
          </button>
        </div>
      </div>
    </div>
  );
}
