import React, { useState } from 'react';
import type { StaffMember, WorkspaceEntity, WorkspaceKind } from '../../types/jobWorkspace';
import { isOverdue } from '../../services/jobWorkspaceModel';
import { Badge, Field, inputClass, buttonClass, primaryClass } from './WorkspaceFields';

export interface WorkspaceEditorProps {
  entities: WorkspaceEntity[];
  canEdit: boolean;
  busy: boolean;
  save: (kind: WorkspaceKind, id: string, data: Record<string, any>, revision: number) => Promise<boolean>;
}
const blank = (category = 'Task') => ({ title: '', description: '', category, status: 'Open', priority: 'Normal', assignee: '', dueDate: '', changeOrderId: '' });
export function WorkItems({ entities, canEdit, busy, save, staff, email, initialCategory }: WorkspaceEditorProps & { staff: StaffMember[]; email: string; initialCategory?: string }) {
  const [editing, setEditing] = useState<WorkspaceEntity | null>(null);
  const [creating, setCreating] = useState(!!initialCategory);
  const [draft, setDraft] = useState<Record<string, any>>(() => blank(initialCategory));
  const [filter, setFilter] = useState('open');
  const [category, setCategory] = useState('all');
  const [assignee, setAssignee] = useState('all');
  const [overdue, setOverdue] = useState(false);
  const [comment, setComment] = useState('');
  const items = entities.filter(e => e.kind === 'workItem');
  const visible = items.filter(e => (filter === 'all' || (filter === 'open' ? !['Done', 'Cancelled'].includes(e.data.status) : e.data.status === filter)) &&
    (category === 'all' || e.data.category === category) && (assignee === 'all' || e.data.assignee === (assignee === 'mine' ? email : assignee)) && (!overdue || isOverdue(e.data)))
    .sort((a, b) => Number(isOverdue(b.data)) - Number(isOverdue(a.data)) || b.updatedAt.localeCompare(a.updatedAt));
  const update = (key: string, value: string) => setDraft(prev => ({ ...prev, [key]: value }));
  function open(item: WorkspaceEntity) { setEditing(item); setDraft({ ...item.data }); setCreating(false); setComment(''); }
  const selected = editing ? entities.find(e => e.kind === 'workItem' && e.id === editing.id) : null;
  const comments = entities.filter(e => e.kind === 'comment' && e.data.parentId === editing?.id).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  return <section aria-label="Tasks and issues" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold text-slate-900">Tasks &amp; Issues</h2><p className="text-sm text-slate-600">Assign work, track blockers, and keep the conversation with the job.</p></div>
      {canEdit && <button disabled={busy} className={primaryClass} onClick={() => { setEditing(null); setCreating(true); setDraft(blank()); }}>New task or issue</button>}</div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Field label="Status filter"><select className={inputClass} value={filter} onChange={e => setFilter(e.target.value)}>{['open', 'all', 'Open', 'In Progress', 'Blocked', 'Done', 'Cancelled'].map(v => <option key={v} value={v}>{v === 'open' ? 'All open work' : v === 'all' ? 'All statuses' : v}</option>)}</select></Field>
      <Field label="Category filter"><select className={inputClass} value={category} onChange={e => setCategory(e.target.value)}><option value="all">Tasks and issues</option><option>Task</option><option>Issue</option></select></Field>
      <Field label="Assignee filter"><select className={inputClass} value={assignee} onChange={e => setAssignee(e.target.value)}><option value="all">Everyone</option><option value="mine">My Tasks</option><option value="">Unassigned</option>{staff.map(s => <option key={s.email} value={s.email}>{s.name}</option>)}</select></Field>
      <label className="flex min-h-11 items-center gap-2 self-end text-sm text-slate-700"><input type="checkbox" checked={overdue} onChange={e => setOverdue(e.target.checked)} />Overdue only</label>
    </div>
    {(creating || editing) && <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
      <h3 className="font-semibold text-slate-900">{editing ? 'Work item details' : 'New task or issue'}</h3>
      {selected && selected.revision !== editing?.revision && <p className="text-sm text-amber-800">This item changed since you opened it. Your entered text is preserved; saving will request a review if needed.</p>}
      <form className="space-y-4" onSubmit={async e => { e.preventDefault(); if (await save('workItem', editing?.id ?? crypto.randomUUID(), draft, editing?.revision ?? 0)) { setCreating(false); setEditing(null); } }}>
        <fieldset disabled={!canEdit || busy} className="space-y-4">
          <Field label="Title"><input className={inputClass} required maxLength={200} value={draft.title} onChange={e => update('title', e.target.value)} /></Field>
          <Field label="Description"><textarea className={inputClass} rows={3} maxLength={6000} value={draft.description} onChange={e => update('description', e.target.value)} /></Field>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="Category"><select className={inputClass} value={draft.category} onChange={e => update('category', e.target.value)}><option>Task</option><option>Issue</option></select></Field>
            <Field label="Status"><select className={inputClass} value={draft.status} onChange={e => update('status', e.target.value)}>{['Open', 'In Progress', 'Blocked', 'Done', 'Cancelled'].map(s => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Priority"><select className={inputClass} value={draft.priority} onChange={e => update('priority', e.target.value)}>{['Low', 'Normal', 'High', 'Urgent'].map(s => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Assigned to"><select className={inputClass} value={draft.assignee} onChange={e => update('assignee', e.target.value)}><option value="">Unassigned</option>{draft.assignee && !staff.some(s => s.email === draft.assignee) && <option value={draft.assignee}>{draft.assignee} (inactive)</option>}{staff.map(s => <option key={s.email} value={s.email}>{s.name}</option>)}</select></Field>
            <Field label="Due date"><input className={inputClass} type="date" value={draft.dueDate} onChange={e => update('dueDate', e.target.value)} /></Field>
            <Field label="Linked change order"><select className={inputClass} value={draft.changeOrderId} onChange={e => update('changeOrderId', e.target.value)}><option value="">None</option>{entities.filter(e => e.kind === 'changeOrder').map(e => <option key={e.id} value={e.id}>{e.data.number} — {e.data.status}</option>)}</select></Field>
          </div>
        </fieldset>
        <div className="flex gap-2">{canEdit && <button disabled={busy} className={primaryClass}>{busy ? 'Saving…' : 'Save work item'}</button>}<button type="button" className={buttonClass} onClick={() => { setCreating(false); setEditing(null); }}>Close details</button></div>
      </form>
      {editing && <section className="border-t border-slate-200 pt-4 space-y-3" aria-label="Comments"><h4 className="font-semibold">Comments</h4>
        {comments.length === 0 && <p className="text-sm text-slate-500">No comments yet.</p>}
        {comments.map(c => <div key={c.id} className="rounded-lg bg-slate-50 p-3"><p className="whitespace-pre-wrap break-words text-sm">{c.data.body}</p><p className="mt-2 text-xs text-slate-500 break-all">{c.updatedBy} · {new Date(c.updatedAt).toLocaleString()}</p></div>)}
        {canEdit && <form className="space-y-2" onSubmit={async e => { e.preventDefault(); if (await save('comment', crypto.randomUUID(), { parentId: editing.id, body: comment }, 0)) setComment(''); }}><Field label="Add a comment"><textarea required maxLength={4000} className={inputClass} value={comment} onChange={e => setComment(e.target.value)} /></Field><button disabled={busy} className={buttonClass}>Post comment</button></form>}
      </section>}
    </div>}
    <div className="space-y-2">{visible.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">{items.length ? 'No work matches these filters.' : 'No tasks or issues yet. Log the first item to start tracking work.'}</p>}
      {visible.map(item => <button disabled={busy} key={item.id} onClick={() => open(item)} className="block w-full rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600">
        <div className="flex flex-wrap gap-2 items-center"><Badge>{item.data.category}</Badge><Badge>{item.data.status}</Badge><Badge>{item.data.priority}</Badge>{isOverdue(item.data) && <span className="text-xs font-bold text-red-700">Overdue</span>}</div>
        <p className="mt-2 font-semibold break-words text-slate-900">{item.data.title}</p><p className="mt-1 text-sm break-words text-slate-600">{staff.find(s => s.email === item.data.assignee)?.name || item.data.assignee || 'Unassigned'}{item.data.dueDate ? ` · Due ${item.data.dueDate}` : ''}</p>
      </button>)}
    </div>
  </section>;
}
