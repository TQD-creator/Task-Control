// Top-level screen switcher. No navigation library is wired in yet, so this
// is a plain state machine between Dashboard -> New Goal -> New Milestone.

import React, { useState } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import DashboardScreen from './screens/DashboardScreen';
import NewGoalScreen from './screens/NewGoalScreen';
import NewMilestoneScreen from './screens/NewMilestoneScreen';

export default function App() {
  const [screen, setScreen] = useState({ name: 'dashboard' });

  return (
    <SafeAreaView style={styles.container}>
      {screen.name === 'dashboard' && (
        <DashboardScreen onAddGoal={() => setScreen({ name: 'newGoal' })} />
      )}

      {screen.name === 'newGoal' && (
        <NewGoalScreen
          onCancel={() => setScreen({ name: 'dashboard' })}
          onSave={(goal) => setScreen({ name: 'newMilestone', goalId: goal.id })}
        />
      )}

      {screen.name === 'newMilestone' && (
        <NewMilestoneScreen
          goalId={screen.goalId}
          onCancel={() => setScreen({ name: 'dashboard' })}
          onSave={() => setScreen({ name: 'dashboard' })}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
