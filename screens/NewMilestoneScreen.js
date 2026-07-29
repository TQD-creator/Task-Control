// "New Milestone" planning screen (Step 5). Same Action/Artifact split as
// New Goal, plus the Effort/Impact matrix and a relative day_offset from the
// parent Goal's start date (consumed by db/database.js's relative scheduling).

import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert } from 'react-native';
import { createMilestone } from '../db/database';
import EffortImpactMatrix from '../components/EffortImpactMatrix';

export default function NewMilestoneScreen({ goalId, onSave, onCancel }) {
  const [title, setTitle] = useState('');
  const [action, setAction] = useState('');
  const [artifact, setArtifact] = useState('');
  const [effort, setEffort] = useState('low');
  const [impact, setImpact] = useState('low');
  const [dayOffset, setDayOffset] = useState('0');
  const [saving, setSaving] = useState(false);

  const canSave = title.trim().length > 0 && action.trim().length > 0 && artifact.trim().length > 0;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const parsedOffset = parseInt(dayOffset, 10);
      const milestone = await createMilestone({
        goalId,
        title: title.trim(),
        action: action.trim(),
        artifact: artifact.trim(),
        effort,
        impact,
        dayOffset: Number.isFinite(parsedOffset) ? parsedOffset : 0,
      });
      onSave?.(milestone);
    } catch (err) {
      Alert.alert('Could not save milestone', err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>New Milestone</Text>

      <Text style={styles.label}>Title</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Ship the homepage" />

      <View style={styles.splitRow}>
        <View style={styles.splitCol}>
          <Text style={styles.label}>Action</Text>
          <TextInput style={styles.input} value={action} onChangeText={setAction} placeholder="Build" />
        </View>
        <View style={styles.splitCol}>
          <Text style={styles.label}>Artifact</Text>
          <TextInput style={styles.input} value={artifact} onChangeText={setArtifact} placeholder="the homepage layout" />
        </View>
      </View>

      <View style={styles.matrixWrap}>
        <EffortImpactMatrix effort={effort} impact={impact} onChange={({ effort, impact }) => { setEffort(effort); setImpact(impact); }} />
      </View>

      <Text style={styles.label}>Starts (days from goal start)</Text>
      <TextInput style={styles.input} value={dayOffset} onChangeText={setDayOffset} placeholder="0" keyboardType="numeric" />

      <View style={styles.actions}>
        <Pressable style={[styles.button, styles.cancelButton]} onPress={onCancel}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.saveButton, !canSave && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={!canSave || saving}
        >
          <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save Milestone'}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 4 },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: '#333', marginTop: 12, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  splitRow: { flexDirection: 'row', gap: 12 },
  splitCol: { flex: 1 },
  matrixWrap: { marginTop: 20 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 28 },
  button: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8 },
  cancelButton: { backgroundColor: '#eee' },
  cancelButtonText: { color: '#333', fontWeight: '600' },
  saveButton: { backgroundColor: '#2563eb' },
  saveButtonText: { color: '#fff', fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
});
