// Shared Proof of Completion -> (conditional) Time Debt justification ->
// (conditional) Punishment menu flow. The flat "All tasks" queue, the per-goal
// milestone view, and the single-task lockdown all need the exact same
// sequencing, so it's pulled out here instead of duplicated.

import { useState } from 'react';
import { rollPunishments } from '../lib/punishments.js';

export function useTaskCompletion(onCompleted) {
  const [proofTask, setProofTask] = useState(null);
  const [pendingCompletion, setPendingCompletion] = useState(null); // { task, actualMinutes }
  // When an Unga Bunga defense-mechanism overrun owes a punishment, we hold the
  // completion result here and show the menu; onCompleted is deferred until the
  // user serves a punishment, since picking the harsh 'lock' arms the penalty
  // focus lock that onCompleted then reacts to.
  const [punishment, setPunishment] = useState(null); // { options, result }

  async function finalize(task, actualMinutes, justification) {
    // justification is a plain string / null (encouraging tone) or a structured
    // { defense_mechanism, note } (Unga Bunga Time Debt modal). The main process
    // returns { task, profile, penaltyPending }.
    const result = await window.api.tasks.complete(task.id, actualMinutes, justification);
    setProofTask(null);
    setPendingCompletion(null);
    if (result?.penaltyPending) {
      setPunishment({ options: rollPunishments(), result });
    } else {
      await onCompleted?.(result);
    }
  }

  // Serve the chosen punishment: log it (and arm the penalty lock for 'lock'),
  // drive the boredom timer for 'no_device', then run the deferred onCompleted
  // so the shell picks up any newly-armed lock.
  async function serve(choice) {
    const result = punishment?.result;
    await window.api.profile.servePunishment({ ...choice, task_id: result?.task?.id ?? null });
    if (choice.category === 'no_device') {
      await window.api.timer.openWidget(null);
      await window.api.timer.startBoredom();
    }
    setPunishment(null);
    await onCompleted?.(result);
  }

  function handleProofSubmit(actualMinutes) {
    const overrun = actualMinutes > proofTask.estimated_minutes;
    if (overrun) {
      setPendingCompletion({ task: proofTask, actualMinutes });
    } else {
      finalize(proofTask, actualMinutes, null);
    }
  }

  function handleJustificationSubmit(justification) {
    const { task, actualMinutes } = pendingCompletion;
    finalize(task, actualMinutes, justification);
  }

  function handleJustificationBack() {
    setPendingCompletion(null);
    // proofTask stays open so the user can adjust the actual time.
  }

  const overrunMinutes = pendingCompletion ? pendingCompletion.actualMinutes - pendingCompletion.task.estimated_minutes : 0;

  return {
    proofTask,
    setProofTask,
    pendingCompletion,
    overrunMinutes,
    handleProofSubmit,
    handleJustificationSubmit,
    handleJustificationBack,
    punishmentOptions: punishment?.options ?? null,
    serve,
  };
}
