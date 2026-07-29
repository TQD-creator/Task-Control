// "New Goal" planning screen (Step 5). Captures the user's Big Vague Goal
// with a split Action/Artifact input pair, and records it in user_profile.json
// so the LLM (Step 4) has continuity across sessions.

import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert } from 'react-native';
import { createGoal } from '../db/database';
import { loadProfile, saveProfile, addBigVagueGoal } from '../profile/profileEngine';

export default function NewGoalScreen({ onSave, onCancel }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [action, setAction] = useState('');
  const [artifact, setArtifact] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [saving, setSaving] = useState(false);

  const canSave = title.trim().length > 0 && action.trim().length > 0 && artifact.trim().length > 0;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const goal = await createGoal({
        title: title.trim(),
        description: description.trim() || null,
        action: action.trim(),
        artifact: artifact.trim(),
        targetDate: targetDate.trim() || null,
      });

      const profile = await loadProfile();
      addBigVagueGoal(profile, goal.id, `${action.trim()} ${artifact.trim()}`);
      await saveProfile(profile);

      onSave?.(goal);
    } catch (err) {
      Alert.alert('Could not save goal', err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>New Goal</Text>

      <Text style={styles.label}>Title</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Launch my portfolio site" />

      <Text style={styles.label}>Description (optional)</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={description}
        onChangeText={setDescription}
        placeholder="Any extra context"
        multiline
      />

      <Text style={styles.sectionLabel}>Split it: what will you do, and what will exist when it's done?</Text>

      <View style={styles.splitRow}>
        <View style={styles.splitCol}>
          <Text style={styles.label}>Action</Text>
          <TextInput style={styles.input} value={action} onChangeText={setAction} placeholder="Launch" />
        </View>
        <View style={styles.splitCol}>
          <Text style={styles.label}>Artifact</Text>
          <TextInput style={styles.input} value={artifact} onChangeText={setArtifact} placeholder="a personal portfolio site" />
        </View>
      </View>

      <Text style={styles.label}>Target date (optional, YYYY-MM-DD)</Text>
      <TextInput style={styles.input} value={targetDate} onChangeText={setTargetDate} placeholder="2026-09-01" />

      <View style={styles.actions}>
        <Pressable style={[styles.button, styles.cancelButton]} onPress={onCancel}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.saveButton, !canSave && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={!canSave || saving}
        >
          <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save Goal'}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 4 },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: '#333', marginTop: 12, marginBottom: 4 },
  sectionLabel: { fontSize: 13, color: '#666', marginTop: 20, marginBottom: 8, fontStyle: 'italic' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  splitRow: { flexDirection: 'row', gap: 12 },
  splitCol: { flex: 1 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 28 },
  button: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8 },
  cancelButton: { backgroundColor: '#eee' },
  cancelButtonText: { color: '#333', fontWeight: '600' },
  saveButton: { backgroundColor: '#2563eb' },
  saveButtonText: { color: '#fff', fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
});
