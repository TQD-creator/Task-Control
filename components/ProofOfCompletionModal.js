// "Proof of Completion" modal (Step 6). Captures how long a task actually
// took before it's marked complete — the actual_minutes value that feeds the
// Time Debt / Guilt-Free Bank calculation in profile/profileEngine.js.

import React, { useState, useEffect } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet } from 'react-native';

export default function ProofOfCompletionModal({ visible, task, onSubmit, onClose }) {
  const [actualMinutes, setActualMinutes] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (visible) {
      setActualMinutes(task?.estimated_minutes ? String(task.estimated_minutes) : '');
      setNote('');
    }
  }, [visible, task]);

  if (!task) return null;

  const parsedMinutes = parseInt(actualMinutes, 10);
  const canSubmit = Number.isFinite(parsedMinutes) && parsedMinutes >= 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.heading}>Proof of Completion</Text>
          <Text style={styles.taskTitle}>{task.title}</Text>
          <Text style={styles.meta}>Estimated: {task.estimated_minutes} min</Text>

          <Text style={styles.label}>Actual time spent (minutes)</Text>
          <TextInput
            style={styles.input}
            value={actualMinutes}
            onChangeText={setActualMinutes}
            keyboardType="numeric"
            placeholder="e.g. 45"
          />

          <Text style={styles.label}>Proof / notes (optional)</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={note}
            onChangeText={setNote}
            placeholder="What did you actually produce?"
            multiline
          />

          <View style={styles.actions}>
            <Pressable style={[styles.button, styles.cancelButton]} onPress={onClose}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.submitButton, !canSubmit && styles.buttonDisabled]}
              disabled={!canSubmit}
              onPress={() => onSubmit(parsedMinutes, note.trim() || null)}
            >
              <Text style={styles.submitButtonText}>Mark Complete</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 20 },
  heading: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  taskTitle: { fontSize: 15, color: '#333', marginBottom: 2 },
  meta: { fontSize: 12, color: '#888', marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: '#333', marginTop: 10, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  multiline: { minHeight: 60, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 20 },
  button: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8 },
  cancelButton: { backgroundColor: '#eee' },
  cancelButtonText: { color: '#333', fontWeight: '600' },
  submitButton: { backgroundColor: '#16a34a' },
  submitButtonText: { color: '#fff', fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
});
