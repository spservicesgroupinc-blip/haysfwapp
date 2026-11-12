import React, { useState } from 'react';
import type { RestorationJobData } from '../../types/jobData';
import type { WorkspaceEntity } from '../../types/jobWorkspace';
import { changeOrderJob, contractTotals, dollars, moneyToCents, signedChange } from '../../services/jobWorkspaceModel';
import { SectionChangeOrder } from '../SectionChangeOrder';
import { DOC, type JobDocument } from '../../services/documentCatalog';
import { Field, Badge, inputClass, buttonClass, primaryClass } from './WorkspaceFields';
import type { WorkspaceEditorProps } from './WorkItems';

export function ChangeOrders({ entities, canEdit, busy, save, job, online, pendingCount, preview }: WorkspaceEditorProps & {
  job: RestorationJobData; online: boolean; pendingCount: number; preview: (doc: JobDocument, job: RestorationJobData) => void;
}) {
  const orders = entities.filter(e => e.kind === 'changeOrder').sort((a, b) => a.data.number.localeCompare(b.data.number, 'en', { numeric: true }));
  const contract = entities.find(e => e.kind === 'contract');
  const totals = contractTotals(entities);
  const [review, setReview] = useState(false);
  const [original, setOriginal] = useState('');
  const [opening, setOpening] = useState('0');
  const [reason, setReason] = useState('');
  const [reviewRevision, setReviewRevision] = useState(0);
  const [selected, setSelected] = useState<WorkspaceEntity | null>(null);
  const [draft, setDraft] = useState<Record<string, any> | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [error, setError] = useState('');
  const financialReady = online && pendingCount === 0 && !busy;
  const legacy = job.changeOrder;
  const hasLegacy = !!legacy.scopeDescription || (typeof legacy.changeAmount === 'number' && legacy.changeAmount !== 0);
  function openReview() {
    setReviewRevision(contract?.revision ?? 0);
    setOriginal(String(contract ? contract.data.originalCents / 100 : typeof legacy.originalContractSum === 'number' ? legacy.originalContractSum : job.financials.totalApprovedRcv));
    setOpening(String(contract ? contract.data.openingCents / 100 : typeof legacy.netPreviousChanges === 'number' ? legacy.netPreviousChanges : 0));
    setReason(''); setReview(true);
  }
  function newOrder() {
    const number = Math.max(0, ...orders.map(e => Number(e.data.number.match(/(\d+)$/)?.[1]) || 0)) + 1;
    setSelected(null); setVoidReason('');
    setDraft({ number: `CO-${String(number).padStart(2, '0')}`, date: new Date().toLocaleDateString('en-CA'),
      scopeDescription: '', isInsuranceRelated: true, amountCents: 0, changeType: 'increase', addedDays: 0, status: 'Draft' });
  }
  const frozen = draft && ['Approved', 'Voided'].includes(draft.status);
  const pdfEntity = draft ? { ...(selected ?? { id: 'preview', kind: 'changeOrder', recordId: job.recordId!, revision: 0, updatedAt: '', updatedBy: '' }), data: draft } as WorkspaceEntity : null;
  const pdfJob = pdfEntity ? changeOrderJob(job, pdfEntity, entities) : null;
  const update = (key: string, value: any) => setDraft(current => {
    if (!current) return current;
    const map: Record<string, string> = { changeOrderNumber: 'number', changeOrderDate: 'date', changeAmount: 'amountCents' };
    return { ...current, [map[key] ?? key]: key === 'changeAmount' ? Math.round(Number(value || 0) * 100) : value };
  });
  async function persist(status: string) {
    if (!draft) return;
    if (await save('changeOrder', selected?.id ?? crypto.randomUUID(), { ...draft, status }, selected?.revision ?? 0)) { setDraft(null); setSelected(null); }
  }
  return <section aria-label="Change orders" className="space-y-4">
    <div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-xl font-semibold text-slate-900">Change Orders</h2><p className="text-sm text-slate-600">Keep every change and its approval history with the contract.</p></div>{canEdit && <button disabled={busy} className={primaryClass} onClick={newOrder}>New change order</button>}</div>
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <h3 className="font-semibold text-slate-900">{totals.reviewed ? 'Verified contract position' : 'Contract review required'}</h3>
      {totals.reviewed ? <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[
        ['Original contract', totals.originalCents], ['Approved net changes', totals.approvedCents], ['Current contract total', totals.currentCents], ['Pending net changes', totals.pendingCents], ['Projected with pending', totals.projectedCents],
      ].map(([label, cents]) => <div key={label}><dt className="text-sm text-slate-600">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{dollars(Number(cents))}</dd></div>)}</dl> :
        <p className="text-sm text-amber-800">Existing figures have no approval history. Confirm the opening balance before a verified total or new approval is available.</p>}
      {canEdit && <button className={buttonClass} onClick={openReview}>{totals.reviewed ? 'Review opening balance' : 'Review contract'}</button>}
    </div>
    {review && <form className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-4" onSubmit={async e => {
      e.preventDefault(); setError('');
      try { if (await save('contract', 'contract', { originalCents: moneyToCents(original), openingCents: moneyToCents(opening), reason, reviewed: true }, reviewRevision)) setReview(false); }
      catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    }}>
      <h3 className="font-semibold text-slate-900">Confirm the contract opening balance</h3><p className="text-sm text-slate-700">Use the original signed contract and approved historical changes. The opening adjustment must exclude any order entered in this ledger, including the legacy order if you import it.</p>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Original contract amount"><input className={inputClass} type="number" step="0.01" min="0" required value={original} onChange={e => setOriginal(e.target.value)} /></Field><Field label="Approved opening adjustment (+/−)"><input className={inputClass} type="number" step="0.01" required value={opening} onChange={e => setOpening(e.target.value)} /></Field></div>
      <Field label="Review note"><textarea className={inputClass} required={!!contract} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <p className="text-sm text-slate-600">Online confirmation is required. Insurance RCV remains a separate figure.</p>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2"><button disabled={!financialReady} className={primaryClass}>Confirm opening balance</button><button type="button" className={buttonClass} onClick={() => setReview(false)}>Cancel review</button></div>
    </form>}
    {hasLegacy && !orders.some(e => e.id === 'legacy-change-order') && <div className="rounded-xl border border-amber-200 bg-white p-4 space-y-3"><p className="text-sm text-slate-700">The original job form contains an unreviewed change order: <strong>{legacy.changeOrderNumber}</strong>. Import it as a draft to review its approval, or keep it as a legacy document.</p>
      <div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={() => preview(DOC.changeOrder, job)}>Preview legacy PDF</button>{canEdit && <button className={buttonClass} disabled={busy} onClick={() => void save('changeOrder', 'legacy-change-order', { number: legacy.changeOrderNumber || 'CO-LEGACY', date: legacy.changeOrderDate,
        scopeDescription: legacy.scopeDescription || 'Imported legacy change — review scope', isInsuranceRelated: legacy.isInsuranceRelated, amountCents: Math.round(Number(legacy.changeAmount || 0) * 100), changeType: legacy.changeType, addedDays: Number(legacy.addedDays || 0), status: 'Draft' }, 0)}>Import legacy order as draft</button>}</div></div>}
    {!!job.changeOrderHistory?.length && <section aria-label="Legacy order review" className="rounded-xl border border-amber-200 bg-white p-4 space-y-3">
      <h3 className="font-semibold text-slate-900">Legacy recorded orders</h3><p className="text-sm text-slate-600">These earlier orders keep their original PDFs. Review their approval before including them in the new ledger. Exclude any imported amounts from the approved opening adjustment.</p>
      {job.changeOrderHistory.map(order => <div key={order.id} className="border-t border-slate-100 pt-3 space-y-2"><p className="text-sm font-semibold">{order.changeOrderNumber} · {order.changeOrderDate}</p><p className="whitespace-pre-wrap break-words text-sm text-slate-600">{order.scopeDescription}</p><div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={() => preview(DOC.changeOrder, { ...job, changeOrder: order, changeOrderHistory: [] })}>Preview legacy {order.changeOrderNumber}</button>
        {canEdit && !orders.some(e => e.id === `legacy-${order.id}`) && <button disabled={busy} className={buttonClass} onClick={() => void save('changeOrder', `legacy-${order.id}`, { number: order.changeOrderNumber, date: order.changeOrderDate,
          scopeDescription: order.scopeDescription, isInsuranceRelated: order.isInsuranceRelated, amountCents: Math.round(Math.abs(Number(order.changeAmount || 0)) * 100), changeType: order.changeType, addedDays: Number(order.addedDays || 0), status: 'Draft' }, 0)}>Import {order.changeOrderNumber} as draft</button>}
      </div></div>)}
    </section>}
    {draft && pdfJob && <div className="space-y-3">
      <div className="flex flex-wrap gap-3 items-center"><h3 className="font-semibold text-slate-900">{selected ? draft.number : 'New change order'}</h3><Badge>{draft.status}</Badge><button className={buttonClass} onClick={() => setDraft(null)}>Close change order</button></div>
      <fieldset disabled={!canEdit || !!frozen || busy} className="min-w-0">
        <SectionChangeOrder lockContractSums hidePdfActions={!totals.reviewed} data={pdfJob.changeOrder} jobData={pdfJob} onChange={(key, value) => {
          if (key !== 'originalContractSum' && key !== 'netPreviousChanges') update(key, value);
        }} onPreview={doc => preview(doc, pdfJob)} />
      </fieldset>
      <p className="text-sm text-slate-600">Contract sums are calculated from the reviewed opening balance and approved ledger. Edit scope and amounts here; approval freezes the financial snapshot.</p>
      {frozen && <button className={buttonClass} onClick={() => preview(DOC.changeOrder, pdfJob)}>Preview {draft.number} PDF</button>}
      {canEdit && !frozen && <div className="flex flex-wrap gap-2"><button className={primaryClass} disabled={busy} onClick={() => void persist('Draft')}>Save draft change</button><button className={buttonClass} disabled={busy} onClick={() => void persist('Submitted')}>Mark submitted</button><button className={buttonClass} disabled={!financialReady || !totals.reviewed} onClick={() => void persist('Approved')}>Approve change</button><button className={buttonClass} disabled={busy} onClick={() => void persist('Rejected')}>Reject change</button></div>}
      {canEdit && draft.status === 'Approved' && <form className="space-y-2" onSubmit={async e => { e.preventDefault(); if (await save('changeOrder', selected!.id, { ...draft, status: 'Voided', voidReason }, selected!.revision)) setDraft(null); }}><Field label="Reason for voiding"><textarea required maxLength={1000} className={inputClass} value={voidReason} onChange={e => setVoidReason(e.target.value)} /></Field><button disabled={!financialReady} className={buttonClass}>Void approved order</button></form>}
    </div>}
    <div className="space-y-2">{orders.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">No change orders in the ledger yet.</p>}{orders.map(order => <button disabled={busy} key={order.id} className="block w-full rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-red-300 focus-visible:ring-2 focus-visible:ring-red-600" onClick={() => { setSelected(order); setDraft({ ...order.data }); setVoidReason(''); }}>
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><strong>{order.data.number}</strong><Badge>{order.data.status}</Badge></div><span className="font-semibold tabular-nums">{dollars(signedChange(order.data))}</span></div><p className="mt-2 break-words text-sm text-slate-600">{order.data.scopeDescription}</p><p className="mt-2 text-xs text-slate-500">{order.data.date}{order.data.approvedBy ? ` · Approved by ${order.data.approvedBy}` : ''}{order.data.voidReason ? ` · Voided: ${order.data.voidReason}` : ''}</p>
    </button>)}</div>
  </section>;
}
