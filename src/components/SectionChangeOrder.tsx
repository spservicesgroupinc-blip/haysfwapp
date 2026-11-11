import React from 'react';
import { FileEdit, DollarSign, Plus, Loader2 } from 'lucide-react';
import { ChangeOrderData, RestorationJobData } from '../types/jobData';
import { DOC } from '../services/documentCatalog';
import { formatCurrency } from '../services/pdfService';
import { SectionPdfActions, type PdfPreviewRequest } from './SectionPdfActions';
import { calculateChangeOrder } from '../services/changeOrders';

interface SectionChangeOrderProps {
  data: ChangeOrderData;
  jobData: RestorationJobData;
  onPreview: PdfPreviewRequest;
  onChange: (field: keyof ChangeOrderData, value: any) => void;
  onRecordOrder?: () => Promise<void>;
  hidePdfActions?: boolean;
  lockContractSums?: boolean;
  isSaving?: boolean;
}

export const SectionChangeOrder: React.FC<SectionChangeOrderProps> = ({
  data,
  jobData,
  onPreview,
  onChange,
  onRecordOrder,
  isSaving,
  hidePdfActions = false,
  lockContractSums = false,
}) => {
  const history = jobData.changeOrderHistory ?? [];
  const totals = calculateChangeOrder(jobData);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-5">
      <fieldset disabled={isSaving} className="min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-slate-100 text-slate-500">
            <FileEdit className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900">Change Order</h3>
            <p className="text-xs text-slate-500">
              Contract addendum for unforeseen damage, customer upgrades, and timeline modifications
            </p>
          </div>
        </div>

        {/* Insurance vs Non-Insurance Selection */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-50 p-1.5 rounded-xl border border-slate-200">
          <button
            type="button"
            onClick={() => onChange('isInsuranceRelated', true)}
            className={`px-2.5 py-1 text-xs font-bold rounded-lg transition ${
              data.isInsuranceRelated
                ? 'bg-red-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Insurance Related
          </button>
          <button
            type="button"
            onClick={() => onChange('isInsuranceRelated', false)}
            className={`px-2.5 py-1 text-xs font-bold rounded-lg transition ${
              !data.isInsuranceRelated
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Non-Insurance (100% upfront)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Change Order # */}
        <div>
          <label htmlFor="change-order-number" className="block text-xs font-semibold text-slate-700 mb-1">
            Change Order Number *
          </label>
          <input
            id="change-order-number"
            aria-label="Change Order Number"
            type="text"
            value={data.changeOrderNumber}
            onChange={(e) => onChange('changeOrderNumber', e.target.value)}
            placeholder="CO-01"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-semibold focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Change Order Date */}
        <div>
          <label htmlFor="change-order-date" className="block text-xs font-semibold text-slate-700 mb-1">
            Change Order Date
          </label>
          <input
            id="change-order-date"
            aria-label="Change Order Date"
            type="date"
            value={data.changeOrderDate}
            onChange={(e) => onChange('changeOrderDate', e.target.value)}
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Change Type: Increase / Decrease */}
        <div>
          <label htmlFor="change-order-adjustment" className="block text-xs font-semibold text-slate-700 mb-1">
            Contract Adjustment
          </label>
          <select
            id="change-order-adjustment"
            aria-label="Contract Adjustment"
            value={data.changeType}
            onChange={(e) => onChange('changeType', e.target.value)}
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-medium focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          >
            <option value="increase">Increased (+)</option>
            <option value="decrease">Decreased (-)</option>
            <option value="unchanged">Unchanged ($0)</option>
          </select>
        </div>

        {/* Change Amount */}
        <div>
          <label htmlFor="change-order-amount" className="block text-xs font-semibold text-slate-700 mb-1">
            Change Amount ($) *
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <DollarSign className="w-4 h-4" />
            </span>
            <input
              id="change-order-amount"
              aria-label="Change Amount"
              type="number"
              min="0"
              step="0.01"
              disabled={data.changeType === 'unchanged'}
              value={data.changeType === 'unchanged' ? 0 : data.changeAmount}
              onChange={(e) =>
                onChange('changeAmount', e.target.value === '' ? '' : parseFloat(e.target.value))
              }
              placeholder="0.00"
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-bold focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
            />
          </div>
        </div>

        {/* Added Days */}
        <div>
          <label htmlFor="change-order-days" className="block text-xs font-semibold text-slate-700 mb-1">
            Added Working Days
          </label>
          <input
            id="change-order-days"
            aria-label="Added Working Days"
            type="number"
            min="0"
            step="1"
            value={data.addedDays}
            onChange={(e) =>
              onChange('addedDays', e.target.value === '' ? '' : Number(e.target.value))
            }
            placeholder="5"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Summary Mini Bar */}
        <div className="sm:col-span-2 lg:col-span-3 bg-slate-50 p-3 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs" aria-label="Change order totals">
          <div>
            <span className="text-slate-400 block text-[10px]">Orig Contract Sum:</span>
            <span className="font-semibold text-slate-800">{formatCurrency(totals.original)}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[11px]">Previous changes:</span>
            <span className="font-semibold text-slate-800">{formatCurrency(totals.previous)}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[11px]">Before this order:</span>
            <span className="font-semibold text-slate-800">{formatCurrency(totals.prior)}</span>
          </div>
          <div>
            <span className="text-slate-400 block text-[10px]">Adjustment:</span>
            <span
              className={`font-semibold ${
                totals.adjustment >= 0 ? 'text-emerald-600' : 'text-rose-600'
              }`}
            >
              {totals.adjustment >= 0 ? '+' : ''}
              {formatCurrency(totals.adjustment)}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-[10px]">New Adjusted Total:</span>
            <span className="font-black text-slate-900 text-sm">
              {formatCurrency(totals.total)}
            </span>
          </div>
        </div>

        {history.length === 0 && <>
          <div className="sm:col-span-2">
            <label htmlFor="change-order-original" className="block text-xs font-semibold text-slate-700 mb-1">Original contract sum ($)</label>
            <input id="change-order-original" type="number" min="0" step="0.01" value={data.originalContractSum}
              readOnly={lockContractSums}
              placeholder={String(jobData.financials.totalApprovedRcv || '0.00')}
              onChange={event => onChange('originalContractSum', event.target.value === '' ? '' : Number(event.target.value))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <p className="mt-1 text-xs text-slate-500">Uses the approved RCV if blank. Locked after recording the first order.</p>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="change-order-opening" className="block text-xs font-semibold text-slate-700 mb-1">Earlier changes made outside this app (net $)</label>
            <input id="change-order-opening" type="number" step="0.01" value={data.netPreviousChanges}
              readOnly={lockContractSums}
              onChange={event => onChange('netPreviousChanges', event.target.value === '' ? '' : Number(event.target.value))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <p className="mt-1 text-xs text-slate-500">Use a negative amount for net decreases. Leave at $0 for a new job.</p>
          </div>
        </>}

        {/* Scope Description */}
        <div className="sm:col-span-2 lg:col-span-4">
          <label htmlFor="change-order-scope" className="block text-xs font-semibold text-slate-700 mb-1">
            This contract is changed as follows (Scope Description) *
          </label>
          <textarea
            id="change-order-scope"
            aria-label="Scope Description"
            rows={3}
            value={data.scopeDescription}
            onChange={(e) => onChange('scopeDescription', e.target.value)}
            placeholder="Detailed description of additional repairs, materials, and labor required..."
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>
      </div>

      {onRecordOrder && <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm text-slate-700">Record an authorized order to include it in all following balances. Previews and repeated downloads do not add it again.</p>
        <button type="button" onClick={() => void onRecordOrder()} disabled={isSaving}
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Record order & start next
        </button>
        <p className="mt-2 text-xs text-slate-500">Keeps this order in the job history and opens a new draft with the next number. Recorded orders cannot be edited; use another order for corrections.</p>
      </div>}

      {!hidePdfActions && <SectionPdfActions jobData={jobData} docs={[DOC.changeOrder]} onPreview={onPreview} />}
      </fieldset>

      {history.length > 0 && <section className="mt-6 border-t border-slate-200 pt-4" aria-label="Recorded change orders">
        <h4 className="font-semibold text-slate-900">Recorded change orders ({history.length})</h4>
        <div className="mt-3 space-y-3">
          {history.map(order => {
            const historicalJob = { ...jobData, changeOrder: order, changeOrderHistory: [] };
            const historicalTotals = calculateChangeOrder(historicalJob);
            const doc = { ...DOC.changeOrder, id: 'recordedChangeOrder',
              label: `${order.changeOrderNumber} — ${formatCurrency(historicalTotals.adjustment)}`,
              title: `Change Order ${order.changeOrderNumber} (recorded)`,
              generator: () => DOC.changeOrder.generator(historicalJob),
              buildFileName: () => DOC.changeOrder.buildFileName(historicalJob) };
            return <div key={order.id} className="rounded-lg border border-slate-200 p-3">
              <p className="text-sm font-semibold text-slate-900">{order.changeOrderNumber} · {order.changeOrderDate} · Total after order: {formatCurrency(historicalTotals.total)}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">{order.scopeDescription}</p>
              <SectionPdfActions jobData={historicalJob} docs={[doc]} onPreview={onPreview} />
            </div>;
          })}
        </div>
      </section>}
    </div>
  );
};
