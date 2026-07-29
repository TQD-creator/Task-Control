// Main Dashboard (Step 6): active task queue across all goals, with the
// Proof of Completion -> (conditional) Time Debt justification flow wired to
// the DB layer (Step 2) and Personalization Engine (Step 3).

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { getActiveTaskQueue, completeTask } from '../db/database';
import { loadProfile, saveProfile, recordTaskCompletion } from '../profile/profileEngine';
import ProofOfCompletionModal from '../components/ProofOfCompletionModal';
import TimeDebtJustificationModal from '../components/TimeDebtJustificationModal';

const EFFORT_IMPACT_COLORS = {
  'low-low': '#9ca3af',
  'low-high': '#16a34a',
  'high-low': '#f59e0b',
  'high-high': '#2563eb',
};

function Badge({ effort, impact }) {
  const color = EFFORT_IMPACT_COLORS[`${effort}-${impact}`];
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text style={styles.badgeText}>{effort}/{impact}</Text>
    </View>
  );
}

export default function DashboardScreen({ onAddGoal }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [proofTask, setProofTask] = useState(null);
  const [pendingCompletion, setPendingCompletion] = useState(null); // { task, actualMinutes, note }

  const refresh = useCallback(async () => {
    const queue = await getActiveTaskQueue();
    setTasks(queue);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function handleRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  async function finalizeCompletion(task, actualMinutes, note, justification) {
    const completed = await completeTask(task.id, actualMinutes);

    const profile = await loadProfile();
    recordTaskCompletion(profile, completed, { justification });
    await saveProfile(profile);

    setProofTask(null);
    setPendingCompletion(null);
    await refresh();
  }

  function handleProofSubmit(actualMinutes, note) {
    const overrun = actualMinutes > proofTask.estimated_minutes;
    if (overrun) {
      setPendingCompletion({ task: proofTask, actualMinutes, note });
    } else {
      finalizeCompletion(proofTask, actualMinutes, note, null);
    }
  }

  function handleJustificationSubmit(justification) {
    const { task, actualMinutes, note } = pendingCompletion;
    finalizeCompletion(task, actualMinutes, note, justification);
  }

  function handleJustificationBack() {
    setPendingCompletion(null);
    // proofTask stays open so the user can adjust the actual time.
  }

  const overrunMinutes = pendingCompletion ? pendingCompletion.actualMinutes - pendingCompletion.task.estimated_minutes : 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.heading}>Today's Queue</Text>
        {onAddGoal && (
          <Pressable style={styles.addButton} onPress={onAddGoal}>
            <Text style={styles.addButtonText}>+ Goal</Text>
          </Pressable>
        )}
      </View>

      {!loading && tasks.length === 0 && (
        <Text style={styles.empty}>No active tasks. Add a goal to get started.</Text>
      )}

      <FlatList
        data={tasks}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardContext}>{item.goal_title} / {item.milestone_title}</Text>
              <Badge effort={item.effort} impact={item.impact} />
            </View>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <View style={styles.cardFooter}>
              <Text style={styles.cardMeta}>
                {item.scheduled_date ?? 'unscheduled'} - est. {item.estimated_minutes} min
              </Text>
              <Pressable style={styles.completeButton} onPress={() => setProofTask(item)}>
                <Text style={styles.completeButtonText}>Complete</Text>
              </Pressable>
            </View>
          </View>
        )}
      />

      <ProofOfCompletionModal
        visible={!!proofTask && !pendingCompletion}
        task={proofTask}
        onSubmit={handleProofSubmit}
        onClose={() => setProofTask(null)}
      />

      <TimeDebtJustificationModal
        visible={!!pendingCompletion}
        overrunMinutes={overrunMinutes}
        onSubmit={handleJustificationSubmit}
        onBack={handleJustificationBack}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f7f8' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 8 },
  heading: { fontSize: 22, fontWeight: '700' },
  addButton: { backgroundColor: '#2563eb', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  addButtonText: { color: '#fff', fontWeight: '700' },
  empty: { textAlign: 'center', color: '#888', marginTop: 40 },
  list: { padding: 16, gap: 12 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 1 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardContext: { fontSize: 11, color: '#888', flexShrink: 1, marginRight: 8 },
  cardTitle: { fontSize: 16, fontWeight: '600', marginTop: 6, marginBottom: 10 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardMeta: { fontSize: 12, color: '#888' },
  completeButton: { backgroundColor: '#16a34a', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  completeButtonText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
});
