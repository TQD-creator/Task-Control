import React from 'react';

// The post-overrun punishment menu (Unga Bunga tone). Shown after a
// defense-mechanism overrun: three randomly-drawn punishments + the harsh
// `lock` final straw (see src/lib/punishments.js). Picking one is mandatory —
// there is no backdrop dismiss and no cancel button. The parent (via
// useTaskCompletion) serves the choice: logging it, driving the boredom timer
// for a `no_device` pick, or arming the penalty lock for the `lock` pick.
export default function PunishmentModal({ visible, options, onServe }) {
  if (!visible || !options) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-card modal-card-unga punishment-card">
        <h2 className="modal-heading modal-heading-danger">Pay the price.</h2>
        <p className="modal-body">
          A demon just won. You don't walk away clean — pick your punishment and serve it now.
        </p>

        <div className="punishment-list">
          {options.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`punishment-option${p.category === 'lock' ? ' punishment-option-harsh' : ''}`}
              onClick={() => onServe(p)}
            >
              <span className="punishment-icon">{p.icon}</span>
              <span className="punishment-text">
                <span className="punishment-cat">{p.category_label}</span>
                <span className="punishment-label">{p.label}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
