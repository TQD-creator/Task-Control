// Turn the estimation_calibration ratios the app already learns into a visible
// suggestion. Each completion updates a per Effort/Impact bucket running average
// of actual/estimate (profileEngine.updateCalibration); until now that only ever
// biased the AI planner's prompt. Here we surface it on manual task creation.

const BUCKET_LABELS = {
  low_effort_low_impact: 'Low effort / Low impact',
  low_effort_high_impact: 'Low effort / High impact',
  high_effort_low_impact: 'High effort / Low impact',
  high_effort_high_impact: 'High effort / High impact',
};

export function bucketKey(effort, impact) {
  return `${effort}_effort_${impact}_impact`;
}

// Returns null when there's not enough history to say anything useful, else
// { ratio, samples, suggested, label, over } for the chosen quadrant.
// `typedMinutes` is the user's current estimate; `suggested` scales it by the
// learned ratio (rounded to 5 min). Requires a small sample count so a single
// fluke completion doesn't start second-guessing every estimate.
export function suggestEstimate(profile, effort, impact, typedMinutes, minSamples = 2) {
  const cal = profile?.estimation_calibration;
  if (!cal) return null;
  const key = bucketKey(effort, impact);
  const bucket = cal[key];
  if (!bucket || bucket.sample_count < minSamples) return null;

  const ratio = bucket.avg_actual_to_estimate_ratio;
  // Only worth surfacing when history diverges from the estimate by >10%.
  if (ratio >= 0.9 && ratio <= 1.1) return null;

  const base = Number.isFinite(typedMinutes) && typedMinutes > 0 ? typedMinutes : 30;
  const suggested = Math.max(5, Math.round((base * ratio) / 5) * 5);
  return {
    ratio,
    samples: bucket.sample_count,
    suggested,
    label: BUCKET_LABELS[key] || key,
    over: ratio > 1,
  };
}
