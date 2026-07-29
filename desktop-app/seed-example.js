// Populates the app's real data files with one example Goal -> 2 Milestones
// -> 5 Tasks, so you can launch the app and immediately test the full flow
// (Dashboard queue, Proof of Completion, Time Debt justification) instead of
// starting from an empty screen. Safe to re-run — it skips seeding if the
// example goal already exists.
//
// Run with the app CLOSED (both write to the same db/profile files):
//   npm run seed

const path = require('path');
const { getUserDataDir } = require('./electron/paths');
const db = require('./electron/db/database');
const profileEngine = require('./electron/profile/profileEngine');

const GOAL_TITLE = 'Launch my personal portfolio site';

async function main() {
  const userDataDir = getUserDataDir();
  const dbPath = path.join(userDataDir, 'task_control.db');
  const profilePath = path.join(userDataDir, 'user_profile.json');

  await db.initDatabase(dbPath);

  const existing = db.getGoals().find((g) => g.title === GOAL_TITLE);
  if (existing) {
    console.log(`Example goal "${GOAL_TITLE}" already exists (id ${existing.id}) — skipping seed.`);
    console.log(`Delete it from the app, or delete ${dbPath}, if you want a fresh copy.`);
    return;
  }

  const goal = db.createGoal({
    title: GOAL_TITLE,
    description: 'A simple developer portfolio with a homepage and an about page.',
    action: 'Launch',
    artifact: 'a personal portfolio site',
  });

  const homepage = db.createMilestone({
    goalId: goal.id,
    title: 'Design the homepage',
    action: 'Design',
    artifact: 'the homepage layout',
    effort: 'low',
    impact: 'high',
    dayOffset: 0,
  });

  db.createTask({
    milestoneId: homepage.id,
    title: 'Sketch a wireframe',
    action: 'Sketch',
    artifact: 'a homepage wireframe',
    effort: 'low',
    impact: 'low',
    estimatedMinutes: 30,
    dayOffset: 0,
  });

  db.createTask({
    milestoneId: homepage.id,
    title: 'Pick a color palette',
    action: 'Choose',
    artifact: 'a color palette',
    effort: 'low',
    impact: 'high',
    estimatedMinutes: 20,
    dayOffset: 0,
  });

  db.createTask({
    milestoneId: homepage.id,
    title: 'Build the homepage in code',
    action: 'Build',
    artifact: 'the coded homepage',
    effort: 'high',
    impact: 'high',
    estimatedMinutes: 90,
    dayOffset: 1,
  });

  const aboutPage = db.createMilestone({
    goalId: goal.id,
    title: 'Write the About page content',
    action: 'Write',
    artifact: 'About page copy',
    effort: 'low',
    impact: 'high',
    dayOffset: 3,
  });

  db.createTask({
    milestoneId: aboutPage.id,
    title: 'Draft your bio',
    action: 'Draft',
    artifact: 'a short bio',
    effort: 'low',
    impact: 'high',
    estimatedMinutes: 45,
    dayOffset: 3,
  });

  db.createTask({
    milestoneId: aboutPage.id,
    title: "Get a friend's feedback",
    action: 'Get',
    artifact: 'feedback on the bio',
    effort: 'low',
    impact: 'low',
    estimatedMinutes: 15,
    dayOffset: 4,
  });

  const profile = profileEngine.loadProfile(profilePath);
  profileEngine.addBigVagueGoal(profile, goal.id, `${goal.action} ${goal.artifact}`);
  profileEngine.saveProfile(profilePath, profile);

  console.log(`Seeded goal "${goal.title}" (id ${goal.id}) with 2 milestones and 5 tasks.`);
  console.log(`DB:      ${dbPath}`);
  console.log(`Profile: ${profilePath}`);
  console.log('\nLaunch the app (npm run dev) to see them in Today\'s Queue.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});