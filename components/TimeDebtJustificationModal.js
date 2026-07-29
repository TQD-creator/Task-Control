// "Time Debt" justification modal (Step 6). Shown only when actual time
// exceeds the estimate, right after Proof of Completion — the justification
// text is stored on the ledger entry created by profileEngine.recordTaskCompletion.

import React, { useState, useEffect } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet } from 'react-native';

export default function TimeDebtJustificationModal({ visible, overrunMinutes, onSubmit, onBack }) {
  const [justification, setJustification] = useState('');

  useEffect(() => {
    if (visible) setJustification('');
  }, [visible]);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onBack}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.heading}>You ran over by {overrunMinutes} min</Text>
          <Text style={styles.body}>
            This adds {overrunMinutes} minutes to your Time Debt. What happened? A quick note helps future estimates.
          </Text>

          <TextInput
            style={styles.input}
            value={justification}
            onChangeText={setJustification}
            placeholder="e.g. Underestimated the setup step"
            multiline
          />

          <View style={styles.actions}>
            <Pressable style={[styles.button, styles.backButton]} onPress={onBack}>
              <Text style={styles.backButtonText}>Back</Text>
            </Pressable>
            <Pressable style={[styles.button, styles.submitButton]} onPress={() => onSubmit(justification.trim() || null)}>
              <Text style={styles.submitButtonText}>Add to Time Debt</Text>
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
  heading: { fontSize: 18, fontWeight: '700', marginBottom: 8, color: '#b91c1c' },
  body: { fontSize: 14, color: '#444', marginBottom: 16, lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 70,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 20 },
  button: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8 },
  backButton: { backgroundColor: '#eee' },
  backButtonText: { color: '#333', fontWeight: '600' },
  submitButton: { backgroundColor: '#b91c1c' },
  submitButtonText: { color: '#fff', fontWeight: '700' },
});
