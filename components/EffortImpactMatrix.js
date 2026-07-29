// Shared 2x2 Effort/Impact selector used by both the New Goal and New
// Milestone planning screens (Step 5).

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

const QUADRANTS = [
  { effort: 'low', impact: 'high', label: 'Quick Win', sub: 'Low Effort / High Impact' },
  { effort: 'high', impact: 'high', label: 'Big Bet', sub: 'High Effort / High Impact' },
  { effort: 'low', impact: 'low', label: 'Filler', sub: 'Low Effort / Low Impact' },
  { effort: 'high', impact: 'low', label: 'Trap', sub: 'High Effort / Low Impact' },
];

export default function EffortImpactMatrix({ effort, impact, onChange }) {
  return (
    <View>
      <Text style={styles.label}>Effort / Impact</Text>
      <View style={styles.grid}>
        {QUADRANTS.map((q) => {
          const selected = q.effort === effort && q.impact === impact;
          return (
            <Pressable
              key={`${q.effort}-${q.impact}`}
              onPress={() => onChange({ effort: q.effort, impact: q.impact })}
              style={[styles.cell, selected && styles.cellSelected]}
            >
              <Text style={[styles.cellLabel, selected && styles.cellLabelSelected]}>{q.label}</Text>
              <Text style={[styles.cellSub, selected && styles.cellLabelSelected]}>{q.sub}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: {
    width: '48%',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ccc',
    marginBottom: 8,
  },
  cellSelected: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  cellLabel: { fontSize: 15, fontWeight: '700', color: '#111' },
  cellSub: { fontSize: 11, color: '#666', marginTop: 2 },
  cellLabelSelected: { color: '#fff' },
});
