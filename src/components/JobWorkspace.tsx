import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardList, AlertCircle, Coins, RefreshCw } from 'lucide-react';
import type { RestorationJobData } from '../types/jobData';
import type { WorkspaceEntity, WorkspaceKind } from '../types/jobWorkspace';
import type { WorkspaceTab } from './Sidebar';
import type { JobDocument } from '../services/documentCatalog';
import { getCurrentUser, isDeveloperBypassEnabled } from '../services/appsScriptService';
import { flushOutboxNow } from '../services/jobSync';
import { changeOrderJob, contractTotals, dollars, financialRevision, isOverdue } from '../services/jobWorkspaceModel';
import { readWorkspace, refreshWorkspace, resolveWorkspaceConflict, saveWorkspaceMutation, subscribeWorkspace } from '../services/jobWorkspaceService';
import { WorkItems } from './workspace/WorkItems';
import { ChangeOrders } from './workspace/ChangeOrders';
import { buttonClass, primaryClass } from './workspace/WorkspaceFields';

export const DASHBOARD_TABS: WorkspaceTab[] = ['dashboard', 'tasks', 'changeOrder', 'activity'];
type WorkspaceView = Awaited<ReturnType<typeof readWorkspace>>;
export function JobWorkspace({ job, recordId, tab, navigate, preview, online, onDocumentOrder }: {
  job: RestorationJobData; recordId?: string; tab: WorkspaceTab; navigate: (tab: WorkspaceTab) => void;
  preview: (doc: JobDocument, snapshot: RestorationJobData) => void; online: boolean;
  onDocumentOrder: (selection: { recordId: string; label: string; changeOrder: RestorationJobData['changeOrder'] } | null) => void;
}) {
  const [view, setView] = useState<WorkspaceView>({ entities: [], pending: [], snapshot: undefined });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [quickCategory, setQuickCategory] = useState<string | undefined>();
  const [taskSession, setTaskSession] = useState(0);
  const [documentOrderId, setDocumentOrderId] = useState('');
  const mounted = useRef(true);
  const readSequence = useRef(0);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const active = DASHBOARD_TABS.includes(tab);
  const user = getCurrentUser();
  const canEdit = (isDeveloperBypassEnabled() || ['editor', 'admin'].includes(user?.role ?? '')) && !!view.snapshot;
  const read = useCallback(async () => {
    if (!recordId) return;
    const sequence = ++readSequence.current;
    const next = await readWorkspace(recordId);
    if (mounted.current && sequence === readSequence.current) setView(next);
  }, [recordId]);
  const refresh = useCallback((): Promise<void> => {
    if (!recordId) return Promise.resolve();
    if (refreshInFlight.current) return refreshInFlight.current;
    setLoading(true);
    refreshInFlight.current = (async () => {
      try {
        await read();
        if (navigator.onLine) { await refreshWorkspace(recordId); if (mounted.current) setError(''); }
        await read();
      } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : String(err)); }
      finally { if (mounted.current) setLoading(false); refreshInFlight.current = null; }
    })();
    return refreshInFlight.current;
  }, [recordId, read]);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeWorkspace(() => { void read().catch(err => { if (mounted.current) setError(String(err)); }); });
    return () => { mounted.current = false; unsubscribe(); };
  }, [read]);
  useEffect(() => {
    if (!active || !recordId) return;
    void refresh();
    const tick = () => { if (document.visibilityState === 'visible' && navigator.onLine) void refresh(); };
    const timer = window.setInterval(tick, 60000);
    window.addEventListener('online', tick); window.addEventListener('focus', tick);
    return () => { window.clearInterval(timer); window.removeEventListener('online', tick); window.removeEventListener('focus', tick); };
  }, [active, recordId, refresh]);

  async function save(kind: WorkspaceKind, id: string, data: Record<string, any>, revision: number): Promise<boolean> {
    if (busy || !recordId) return false;
    const financial = kind === 'contract' || (kind === 'changeOrder' && ['Approved', 'Voided'].includes(data.status));
    setError(''); setMessage('');
    if (financial && (!online || view.pending.length)) { setError('Connect and sync pending changes before confirming a financial decision.'); return false; }
    if (kind === 'changeOrder' && (!data.number?.trim() || !data.scopeDescription?.trim() || !data.date || !Number.isSafeInteger(data.amountCents) || data.amountCents < 0 || !Number.isInteger(Number(data.addedDays)) || Number(data.addedDays) < 0)) {
      setError('Enter a change order number, date, scope, non-negative amount, and whole added days.'); return false;
    }
    if (kind === 'contract' && (data.originalCents < 0 || !Number.isSafeInteger(data.originalCents))) { setError('The original contract must be a non-negative amount.'); return false; }
    setBusy(true);
    try {
      const operationId = crypto.randomUUID();
      await saveWorkspaceMutation({ operationId, recordId, id, kind, data, expectedRevision: revision,
        ...(financial ? { financialRevision: financialRevision(view.snapshot?.entities ?? []) } : {}) });
      await read();
      if (online) { await flushOutboxNow(); await refresh(); }
      const latest = await readWorkspace(recordId);
      const queued = latest.pending.find(op => op.mutation?.operationId === operationId);
      if (!mounted.current) return false;
      setView(latest);
      if (queued?.lastError) { setError(queued.lastError); return false; }
      setMessage(queued ? (financial ? 'Financial decision is awaiting cloud confirmation. Confirmed totals remain unchanged.' : 'Saved on this device. Waiting to sync.') : 'Saved and synced.');
      return !financial || !queued;
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : String(err)); return false; }
    finally { if (mounted.current) setBusy(false); }
  }
  const totals = contractTotals(view.entities);
  const documentOrders = view.entities.filter(e => e.kind === 'changeOrder' && e.data.status !== 'Voided' && e.data.status !== 'Rejected');
  const documentOrder = documentOrderId === 'legacy' ? undefined : documentOrders.find(e => e.id === documentOrderId) ?? documentOrders.filter(e => e.data.status === 'Approved').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  useEffect(() => {
    onDocumentOrder(recordId && documentOrder && totals.reviewed ? { recordId, label: `${documentOrder.data.number} (${documentOrder.data.status})`, changeOrder: changeOrderJob(job, documentOrder, view.entities).changeOrder } : null);
  }, [recordId, documentOrder, totals.reviewed, job, view.entities, onDocumentOrder]);
  const work = view.entities.filter(e => e.kind === 'workItem');
  const open = work.filter(e => !['Done', 'Cancelled'].includes(e.data.status));
  const failed = view.pending.filter((op, index, all) => op.lastError && all.findIndex(other => other.mutation?.id === op.mutation?.id && other.lastError) === index);
  function quick(category: string) { setQuickCategory(category); setTaskSession(n => n + 1); navigate('tasks'); }
  async function reconcile(entity: WorkspaceEntity, keep: boolean) {
    setBusy(true); setError('');
    try { await resolveWorkspaceConflict(recordId!, entity, keep); await flushOutboxNow(); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { if (mounted.current) setBusy(false); }
  }
  const editors = { entities: view.entities, canEdit, busy, save };
  return <div hidden={!active} className="space-y-5">
    {!recordId ? <div className="rounded-xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-semibold">Save this job to start its dashboard</h2><p className="mt-2 text-sm text-slate-600">Enter the customer details and save the job. Its tasks, issues, and contract ledger will stay linked to that saved record.</p><button className={`${buttonClass} mt-4`} onClick={() => navigate('customer')}>Enter customer details</button></div> : <>
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wider text-red-700">Customer job workspace · {job.customer.jobNumber}</p><h1 className="mt-1 break-words text-2xl font-semibold tracking-tight text-slate-900">{job.customer.customerName || 'Unnamed customer'}</h1><p className="mt-1 break-words text-sm text-slate-600">{job.customer.lossAddress || 'Loss address not entered'}</p></div>
          <button disabled={loading || busy} onClick={() => void refresh()} className={buttonClass}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />Refresh dashboard</button></div>
        <div className="mt-4 flex flex-wrap gap-2" role="navigation" aria-label="Customer dashboard">{[['dashboard', 'Overview'], ['tasks', 'Tasks & Issues'], ['changeOrder', 'Change Orders'], ['activity', 'Activity'], ['documents', 'Documents']].map(([id, label]) => <button key={id} className={tab === id ? primaryClass : buttonClass} aria-current={tab === id ? 'page' : undefined} onClick={() => navigate(id as WorkspaceTab)}>{label}</button>)}</div>
      </div>
      <div aria-live="polite" className="space-y-2">{loading && !view.snapshot && <p className="text-sm text-slate-600">Loading this job’s dashboard…</p>}
        {!online && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Offline · {view.snapshot ? 'Showing this device’s saved dashboard. New work saves here until you reconnect.' : 'This dashboard has not been cached on this device.'}</p>}
        {view.pending.length > 0 && <p className="text-sm text-amber-800">{view.pending.length} dashboard change{view.pending.length === 1 ? '' : 's'} awaiting sync. Financial totals include cloud-confirmed decisions only.</p>}
        {message && <p className="text-sm text-emerald-800">{message}</p>}{error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      </div>
      {failed.map(op => {
        const m = op.mutation!;
        const local = view.entities.find(e => e.id === m.id && e.kind === m.kind) ?? { ...m, revision: m.expectedRevision + 1, updatedAt: '', updatedBy: '' } as WorkspaceEntity;
        const latest = view.snapshot?.entities.find(e => e.id === m.id && e.kind === m.kind);
        return <section key={op.id} className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3" aria-label="Saved change needs review"><h3 className="font-semibold">Saved change needs review</h3><p className="text-sm">{op.lastError}</p><div className="grid gap-3 sm:grid-cols-2"><div><h4 className="text-sm font-semibold">Your device version</h4><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(local.data, null, 2)}</pre></div><div><h4 className="text-sm font-semibold">Latest cloud version</h4><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{latest ? JSON.stringify(latest.data, null, 2) : 'Not created in the cloud'}</pre></div></div><div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={busy || !online} onClick={() => void reconcile(local, false)}>Use latest cloud version</button>{m.kind !== 'contract' && !['Approved', 'Voided'].includes(m.data.status) && <button className={buttonClass} disabled={busy || !online} onClick={() => void reconcile(local, true)}>Reapply my version</button>}</div></section>;
      })}
      {tab === 'dashboard' && <section aria-label="Customer overview" className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
          { label: totals.reviewed ? 'Current contract total' : 'Contract review required', value: totals.reviewed ? dollars(totals.currentCents) : 'Unverified', icon: Coins },
          { label: 'Open tasks & issues', value: String(open.length), icon: ClipboardList },
          { label: 'Overdue work', value: String(open.filter(e => isOverdue(e.data)).length), icon: AlertCircle },
          { label: 'My open assignments', value: String(open.filter(e => e.data.assignee === user?.email.toLowerCase()).length), icon: ClipboardList },
        ].map(({ label, value, icon: Icon }) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4"><Icon className="mb-3 h-5 w-5 text-red-600" aria-hidden /><p className="text-sm text-slate-600">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p></div>)}</div>
        <div className="flex flex-wrap gap-2">{canEdit && <><button className={primaryClass} onClick={() => quick('Issue')}>Log an issue</button><button className={buttonClass} onClick={() => quick('Task')}>Create a task</button></>}<button className={buttonClass} onClick={() => navigate('changeOrder')}>View contract &amp; changes</button><button className={buttonClass} onClick={() => navigate('customer')}>Edit job details</button></div>
        <div className="grid gap-4 lg:grid-cols-2"><section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3"><h2 className="font-semibold">Customer &amp; team</h2><dl className="space-y-2 text-sm">{[['Phone', job.customer.mobilePhone || job.customer.mainPhone || 'Not entered'], ['Email', job.customer.email || 'Not entered'], ['Claim', job.insurance.claimNumber || 'Not entered'], ['Project manager', job.team.projectManager || 'Not assigned'], ['Estimator', job.team.estimator || 'Not assigned'], ['Coordinator', job.team.coordinator || 'Not assigned']].map(([label, value]) => <div key={label} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3"><dt className="text-slate-500">{label}</dt><dd className="break-words text-slate-900">{value}</dd></div>)}</dl></section>
          <section className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="font-semibold">Contract position</h2>{totals.reviewed ? <dl className="mt-3 space-y-2 text-sm">{[['Original contract', totals.originalCents], ['Approved net changes', totals.approvedCents], ['Pending net changes', totals.pendingCents], ['Projected with pending', totals.projectedCents]].map(([label, cents]) => <div key={label} className="flex flex-wrap justify-between gap-2"><dt className="text-slate-600">{label}</dt><dd className="font-semibold tabular-nums">{dollars(Number(cents))}</dd></div>)}</dl> : <p className="mt-3 text-sm text-amber-800">Legacy estimate: {dollars(Math.round((Number(job.changeOrder.originalContractSum || job.financials.totalApprovedRcv || 0) + Number(job.changeOrder.netPreviousChanges || 0) + (job.changeOrder.changeType === 'increase' ? 1 : job.changeOrder.changeType === 'decrease' ? -1 : 0) * Number(job.changeOrder.changeAmount || 0)) * 100))}. Unverified; review the opening balance and change-order approvals.</p>}</section></div>
        <section className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="font-semibold">Open issues</h2>{open.filter(e => e.data.category === 'Issue').length === 0 ? <p className="mt-3 text-sm text-slate-600">No open issues logged.</p> : <ul className="mt-3 space-y-2">{open.filter(e => e.data.category === 'Issue').slice(0, 5).map(e => <li key={e.id} className="text-sm break-words"><span className="font-semibold">{e.data.title}</span> · {e.data.status} · {e.data.assignee || 'Unassigned'}</li>)}</ul>}</section>
      </section>}
      <div hidden={tab !== 'tasks'}><WorkItems key={taskSession} {...editors} staff={view.snapshot?.staff ?? []} email={user?.email.toLowerCase() ?? ''} initialCategory={quickCategory} /></div>
      <div hidden={tab !== 'changeOrder'} className="space-y-4">
        {totals.reviewed && <label className="block rounded-xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-700">Change order for documents and complete packet
          <select className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm" value={documentOrder?.id ?? 'legacy'} onChange={e => setDocumentOrderId(e.target.value)}>
            <option value="legacy">Legacy job form (unreviewed)</option>{documentOrders.map(e => <option key={e.id} value={e.id}>{e.data.number} ({e.data.status})</option>)}
          </select>
        </label>}
        <ChangeOrders {...editors} job={job} online={online} pendingCount={view.pending.length} preview={preview} />
      </div>
      {(tab === 'activity' || tab === 'dashboard') && <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label="Job activity"><h2 className="font-semibold">{tab === 'dashboard' ? 'Recent activity' : 'Activity'}</h2>{!view.snapshot?.activity.length ? <p className="mt-3 text-sm text-slate-600">No activity recorded yet.</p> : <ol className="mt-3 divide-y divide-slate-100">{view.snapshot.activity.slice(0, tab === 'dashboard' ? 8 : undefined).map(event => <li key={event.id} className="py-3"><p className="break-words text-sm text-slate-900">{event.detail}</p><p className="mt-1 break-words text-xs text-slate-500">{event.actor} · {new Date(event.at).toLocaleString()}</p></li>)}</ol>}</section>}
      {view.snapshot && <p className="text-xs text-slate-500">Dashboard last refreshed {new Date(view.snapshot.fetchedAt).toLocaleString()}.</p>}
    </>}
  </div>;
}
