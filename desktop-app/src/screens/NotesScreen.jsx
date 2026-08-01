// Quick Note pad — low-friction capture with "/" slash-command classification,
// a batch "process" step (the boundary), and a Chores manager.
//
//   /plan  → routes to Quick Capture (AI breakdown), one at a time
//   /chore → a one-off chore reminder
//   /daily → a repeating daily chore
//   (no slash) → a plain kept note
//
// Notes/chores are cheap rows in the existing DB; nothing here is heavy.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { parseNoteInput, SLASH_COMMANDS, KIND_META, parseClassification, isStructuredNote, groupStructuredNotes } from '../lib/notes.js';

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function NotesScreen({ onBack, onOpenPlan, initialTab = 'notes' }) {
  const [tab, setTab] = useState(initialTab === 'chores' ? 'chores' : 'notes');
  const [notesList, setNotesList] = useState([]);
  const [chores, setChores] = useState([]);
  const [text, setText] = useState('');
  const [showProcess, setShowProcess] = useState(false);
  const [selected, setSelected] = useState({});
  const inputRef = useRef(null);

  const refreshNotes = useCallback(async () => setNotesList(await window.api.notes.list()), []);
  const refreshChores = useCallback(async () => setChores(await window.api.chores.list()), []);
  useEffect(() => { refreshNotes(); refreshChores(); }, [refreshNotes, refreshChores]);

  // ---- Notes tab ----------------------------------------------------------
  const trimmed = text.trim();
  const showSlash = /^\/\w*$/.test(trimmed); // '/', '/pl', '/daily' before a space
  const slashMatches = SLASH_COMMANDS.filter((c) => c.cmd.startsWith(trimmed.toLowerCase()));

  async function addNote() {
    const { kind, text: body } = parseNoteInput(text);
    if (!body) return;
    await window.api.notes.create({ text: body, kind });
    setText('');
    await refreshNotes();
  }
  function pickCommand(cmd) {
    setText(cmd + ' ');
    inputRef.current?.focus();
  }
  async function deleteNote(id) { await window.api.notes.delete(id); await refreshNotes(); }

  // ---- Structured notes (Classification / Header / Sub-Header / Content) ----
  const [sClass, setSClass] = useState('');
  const [sHeader, setSHeader] = useState('');
  const [sSub, setSSub] = useState('');
  const [sContent, setSContent] = useState('');
  const [flash, setFlash] = useState('');
  const [expanded, setExpanded] = useState({});           // note id -> bool
  const [editNoteId, setEditNoteId] = useState(null);     // structured note being edited
  const [editContent, setEditContent] = useState('');
  const headerRef = useRef(null);

  async function addStructured() {
    const header = sHeader.trim();
    const content = sContent.trim();
    if (!header || !content) return; // Header is the identity; Content is the body
    const res = await window.api.notes.create({
      text: content,
      classification: parseClassification(sClass),
      header,
      subHeader: sSub.trim(),
    });
    // Clear only Content/Sub-Header so rapid appends to the same Header/Class flow.
    setSContent('');
    setSSub('');
    setFlash(res?.merged ? `Merged into “${header}”.` : `Saved “${header}”.`);
    setTimeout(() => setFlash(''), 2500);
    headerRef.current?.focus();
    await refreshNotes();
  }

  function toggleExpand(id) { setExpanded((e) => ({ ...e, [id]: !e[id] })); }
  function startEditNote(n) { setEditNoteId(n.id); setEditContent(n.text); }
  async function saveEditNote() {
    await window.api.notes.update(editNoteId, { text: editContent });
    setEditNoteId(null);
    await refreshNotes();
  }

  const structuredGroups = groupStructuredNotes(notesList);
  const plainNotes = notesList.filter((n) => !isStructuredNote(n));

  const openClassified = notesList.filter((n) => n.status === 'open' && n.kind !== 'note' && !isStructuredNote(n));
  const batchable = openClassified.filter((n) => n.kind === 'chore' || n.kind === 'daily');
  const planNotes = openClassified.filter((n) => n.kind === 'plan');

  function toggleSel(id) { setSelected((s) => ({ ...s, [id]: !s[id] })); }
  function selectAll() {
    const all = {};
    batchable.forEach((n) => { all[n.id] = true; });
    setSelected(all);
  }
  async function processSelected() {
    for (const n of batchable) {
      if (!selected[n.id]) continue;
      await window.api.chores.create({ title: n.text, recurrence: n.kind === 'daily' ? 'daily' : 'once', sourceNoteId: n.id });
      await window.api.notes.update(n.id, { status: 'processed', processed_at: new Date().toISOString() });
    }
    setSelected({});
    await refreshNotes();
    await refreshChores();
  }
  async function analyzePlan(n) {
    await window.api.notes.update(n.id, { status: 'processed', processed_at: new Date().toISOString() });
    onOpenPlan(n.text);
  }
  async function dismissNote(id) { await window.api.notes.update(id, { status: 'dismissed' }); await refreshNotes(); }

  // ---- Chores tab ---------------------------------------------------------
  const [chTitle, setChTitle] = useState('');
  const [chRec, setChRec] = useState('daily');
  const [chTime, setChTime] = useState('');
  const [chDue, setChDue] = useState('');
  const [editId, setEditId] = useState(null);
  const [edit, setEdit] = useState({ title: '', time_of_day: '', recurrence: 'daily' });

  async function addChore() {
    if (!chTitle.trim()) return;
    await window.api.chores.create({
      title: chTitle.trim(),
      recurrence: chRec,
      timeOfDay: chTime || null,
      dueDate: chRec === 'once' ? (chDue || null) : null,
    });
    setChTitle(''); setChTime(''); setChDue('');
    await refreshChores();
  }
  const isDoneToday = (c) => c.last_done_date === todayStr();
  async function toggleDailyDone(c) {
    if (isDoneToday(c)) await window.api.chores.update(c.id, { last_done_date: null });
    else await window.api.chores.markDone(c.id);
    await refreshChores();
  }
  async function finishOnce(c) { await window.api.chores.markDone(c.id); await refreshChores(); }
  async function toggleActive(c) { await window.api.chores.update(c.id, { active: c.active ? 0 : 1 }); await refreshChores(); }
  async function deleteChore(id) { await window.api.chores.delete(id); await refreshChores(); }
  function startEdit(c) {
    setEditId(c.id);
    setEdit({ title: c.title, time_of_day: c.time_of_day || '', recurrence: c.recurrence });
  }
  async function saveEdit() {
    await window.api.chores.update(editId, {
      title: edit.title.trim() || 'Untitled',
      time_of_day: edit.time_of_day || null,
      recurrence: edit.recurrence,
    });
    setEditId(null);
    await refreshChores();
  }

  return (
    <div className="container notes-screen">
      <div className="screen-header">
        <button type="button" className="button button-cancel" onClick={onBack}>← Back</button>
        <h1 className="heading" style={{ margin: 0 }}>📝 Notes</h1>
        <div className="notes-tabs">
          <button type="button" className={`notes-tab${tab === 'notes' ? ' is-active' : ''}`} onClick={() => setTab('notes')}>Notes</button>
          <button type="button" className={`notes-tab${tab === 'chores' ? ' is-active' : ''}`} onClick={() => setTab('chores')}>Chores</button>
        </div>
      </div>

      {tab === 'notes' && (
        <>
          <div className="snote-capture">
            <div className="snote-fields">
              <div className="snote-field snote-field-class">
                <label>Classification</label>
                <input
                  className="input"
                  placeholder="\work"
                  value={sClass}
                  onChange={(e) => setSClass(e.target.value)}
                  title="Free-form group label — type it with a leading \"
                />
              </div>
              <div className="snote-field">
                <label>Header</label>
                <input ref={headerRef} className="input" placeholder="Standup" value={sHeader} onChange={(e) => setSHeader(e.target.value)} />
              </div>
              <div className="snote-field">
                <label>Sub-header</label>
                <input className="input" placeholder="Blockers" value={sSub} onChange={(e) => setSSub(e.target.value)} />
              </div>
            </div>
            <textarea
              className="input snote-content-input"
              placeholder="Content…  (Enter to save · Shift+Enter for a new line)"
              rows={3}
              value={sContent}
              onChange={(e) => setSContent(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addStructured(); } }}
            />
            <div className="snote-capture-foot">
              <span className="snote-flash">{flash}</span>
              <span className="snote-merge-hint">Same Classification + Header + Sub-header appends here instead of duplicating.</span>
              <button type="button" className="button button-save" onClick={addStructured} disabled={!sHeader.trim() || !sContent.trim()}>Save note</button>
            </div>
          </div>

          <div className="note-add">
            <div className="note-add-input">
              <input
                ref={inputRef}
                className="input"
                placeholder="…or a quick line  (type / to classify → chore / daily / plan)"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !showSlash) addNote(); }}
              />
              {showSlash && slashMatches.length > 0 && (
                <div className="slash-menu">
                  {slashMatches.map((c) => (
                    <button key={c.cmd} type="button" className="slash-item" onClick={() => pickCommand(c.cmd)}>
                      <span className="slash-cmd">{c.cmd}</span>
                      <span className="slash-hint">{c.label} {c.hint}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" className="button button-save" onClick={addNote}>Add</button>
          </div>

          {openClassified.length > 0 && (
            <button type="button" className="button button-cancel note-process-toggle" onClick={() => setShowProcess((s) => !s)}>
              {showProcess ? 'Hide processing' : `Process (${openClassified.length})`}
            </button>
          )}

          {showProcess && openClassified.length > 0 && (
            <div className="note-process">
              <div className="note-process-head">
                <span>Route these where they belong.</span>
                {batchable.length > 0 && (
                  <div className="note-process-actions">
                    <button type="button" className="button button-cancel" onClick={selectAll}>Select all</button>
                    <button type="button" className="button button-save" onClick={processSelected}>Process selected</button>
                  </div>
                )}
              </div>
              {batchable.map((n) => (
                <label key={n.id} className="note-proc-row">
                  <input type="checkbox" checked={!!selected[n.id]} onChange={() => toggleSel(n.id)} />
                  <span className={`note-chip note-chip-${n.kind}`}>{KIND_META[n.kind].label}</span>
                  <span className="note-proc-text">{n.text}</span>
                  <button type="button" className="note-x" onClick={() => dismissNote(n.id)}>✕</button>
                </label>
              ))}
              {planNotes.map((n) => (
                <div key={n.id} className="note-proc-row">
                  <span className="note-chip note-chip-plan">Plan</span>
                  <span className="note-proc-text">{n.text}</span>
                  <button type="button" className="button button-save note-analyze" onClick={() => analyzePlan(n)}>Analyze →</button>
                  <button type="button" className="note-x" onClick={() => dismissNote(n.id)}>✕</button>
                </div>
              ))}
              <p className="note-proc-hint">Plans open Quick Capture one at a time; chores &amp; daily items batch-create.</p>
            </div>
          )}

          {structuredGroups.length > 0 && (
            <div className="snote-groups">
              {structuredGroups.map((g) => (
                <div key={g.classification || '__ungrouped'} className="snote-group">
                  <div className="snote-group-head">
                    {g.classification
                      ? <span className="snote-class-chip">\{g.classification}</span>
                      : <span className="snote-class-chip snote-class-none">Ungrouped</span>}
                    <span className="snote-group-count">{g.items.length}</span>
                  </div>
                  {g.items.map((n) => (
                    <div key={n.id} className="snote-item">
                      <button type="button" className="snote-row" onClick={() => toggleExpand(n.id)}>
                        <span className="snote-caret">{expanded[n.id] ? '▾' : '▸'}</span>
                        <span className="snote-title">{n.header}</span>
                        {n.sub_header && <span className="snote-sub">· {n.sub_header}</span>}
                      </button>
                      {expanded[n.id] && (
                        <div className="snote-body">
                          {editNoteId === n.id ? (
                            <>
                              <textarea className="input snote-content-input" rows={4} value={editContent} onChange={(e) => setEditContent(e.target.value)} />
                              <div className="snote-body-actions">
                                <button type="button" className="button button-save" onClick={saveEditNote}>Save</button>
                                <button type="button" className="button button-cancel" onClick={() => setEditNoteId(null)}>Cancel</button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="snote-content">{n.text}</div>
                              <div className="snote-body-actions">
                                <button type="button" className="chore-link" onClick={() => startEditNote(n)}>Edit</button>
                                <button type="button" className="note-x" onClick={() => deleteNote(n.id)}>✕</button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          <div className="note-list">
            {notesList.length === 0 && <p className="empty-state">Nothing yet. Add a structured note above, or type <code>/</code> for a quick classified line.</p>}
            {plainNotes.map((n) => (
              <div key={n.id} className={`note-row${n.status === 'processed' ? ' is-processed' : ''}`}>
                <span className={`note-chip note-chip-${n.kind}`}>{KIND_META[n.kind].label}</span>
                <span className="note-text">{n.text}</span>
                {n.status === 'processed' && <span className="note-done">✓ processed</span>}
                <button type="button" className="note-x" onClick={() => deleteNote(n.id)}>✕</button>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'chores' && (
        <>
          <div className="chore-add">
            <input className="input" placeholder="New chore…" value={chTitle}
              onChange={(e) => setChTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addChore()} />
            <select value={chRec} onChange={(e) => setChRec(e.target.value)}>
              <option value="daily">Daily</option>
              <option value="once">One-off</option>
            </select>
            <input className="input chore-time" type="time" value={chTime} onChange={(e) => setChTime(e.target.value)} title="Optional time of day" />
            {chRec === 'once' && (
              <input className="input" type="date" value={chDue} onChange={(e) => setChDue(e.target.value)} title="Due date" />
            )}
            <button type="button" className="button button-save" onClick={addChore}>Add</button>
          </div>

          <div className="chore-list">
            {chores.length === 0 && <p className="empty-state">No chores yet. Add a daily habit or a one-off, or classify a note with <code>/daily</code>.</p>}
            {chores.map((c) => (
              editId === c.id ? (
                <div key={c.id} className="chore-row chore-editing">
                  <input className="input" value={edit.title} onChange={(e) => setEdit((x) => ({ ...x, title: e.target.value }))} />
                  <select value={edit.recurrence} onChange={(e) => setEdit((x) => ({ ...x, recurrence: e.target.value }))}>
                    <option value="daily">Daily</option>
                    <option value="once">One-off</option>
                  </select>
                  <input className="input chore-time" type="time" value={edit.time_of_day} onChange={(e) => setEdit((x) => ({ ...x, time_of_day: e.target.value }))} />
                  <button type="button" className="button button-save" onClick={saveEdit}>Save</button>
                  <button type="button" className="button button-cancel" onClick={() => setEditId(null)}>Cancel</button>
                </div>
              ) : (
                <div key={c.id} className={`chore-row${c.active ? '' : ' is-paused'}`}>
                  {c.recurrence === 'daily' ? (
                    <label className="chore-check">
                      <input type="checkbox" checked={isDoneToday(c)} onChange={() => toggleDailyDone(c)} disabled={!c.active} />
                    </label>
                  ) : (
                    <span className="chore-check">{c.active ? '○' : '✓'}</span>
                  )}
                  <div className="chore-main">
                    <span className={`chore-title${isDoneToday(c) ? ' done' : ''}`}>{c.title}</span>
                    <span className="chore-meta">
                      <span className={`note-chip note-chip-${c.recurrence === 'daily' ? 'daily' : 'chore'}`}>{c.recurrence === 'daily' ? 'Daily' : 'One-off'}</span>
                      {c.time_of_day && <span className="chore-time-badge">⏰ {c.time_of_day}</span>}
                      {c.recurrence === 'once' && c.due_date && <span className="chore-time-badge">📅 {c.due_date}</span>}
                      {!c.active && <span className="chore-paused-badge">paused</span>}
                    </span>
                  </div>
                  <div className="chore-actions">
                    {c.recurrence === 'once' && c.active && (
                      <button type="button" className="button button-complete chore-btn" onClick={() => finishOnce(c)}>Done</button>
                    )}
                    <button type="button" className="chore-link" onClick={() => toggleActive(c)}>{c.active ? 'Pause' : 'Resume'}</button>
                    <button type="button" className="chore-link" onClick={() => startEdit(c)}>Edit</button>
                    <button type="button" className="note-x" onClick={() => deleteChore(c.id)}>✕</button>
                  </div>
                </div>
              )
            ))}
          </div>
        </>
      )}
    </div>
  );
}
