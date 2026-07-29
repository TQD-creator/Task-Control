// Goal selector row: "All" + one tag per goal + a trailing "+ Goal" tag.
// Selecting a goal tag switches the Dashboard from the flat cross-goal task
// queue to that goal's own milestone/task breakdown (see GoalMilestonesView),
// which is what makes it possible to tell goals and their milestones apart.
//
// Each goal tag also carries its own pin toggle — pinned goals sort first
// (see getGoals()'s ORDER BY is_pinned DESC in database.js) so frequently
// used or high-priority goals stay reachable without hunting through a long
// wrapped row.

import React from 'react';

export default function GoalTabs({ goals, selectedGoalId, onSelect, onAddGoal, onTogglePin, onCapture }) {
  return (
    <div className="goal-tabs">
      <button
        type="button"
        className={`goal-chip${selectedGoalId === null ? ' selected' : ''}`}
        onClick={() => onSelect(null)}
      >
        All
      </button>

      {goals.map((goal) => {
        const pinned = !!goal.is_pinned;
        return (
          <div
            key={goal.id}
            className={`goal-chip goal-chip-tag${selectedGoalId === goal.id ? ' selected' : ''}`}
            onClick={() => onSelect(goal.id)}
            role="button"
            tabIndex={0}
          >
            <button
              type="button"
              className={`goal-chip-pin${pinned ? ' pinned' : ''}`}
              title={pinned ? 'Unpin' : 'Pin'}
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin(goal.id, !pinned);
              }}
            >
              📌
            </button>
            <span className="goal-chip-label">{goal.title}</span>
          </div>
        );
      })}

      <button type="button" className="goal-chip goal-chip-add" onClick={onAddGoal}>
        + Goal
      </button>

      <button type="button" className="goal-chip goal-chip-add" onClick={onCapture}>
        💡 Capture
      </button>
    </div>
  );
}