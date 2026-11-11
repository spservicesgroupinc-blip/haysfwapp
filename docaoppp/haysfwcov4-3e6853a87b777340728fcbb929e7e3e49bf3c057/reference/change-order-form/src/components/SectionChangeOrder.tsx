import React from 'react';
import { FileEdit, DollarSign, Calendar, PlusCircle, MinusCircle } from 'lucide-react';
import { ChangeOrderData, RestorationJobData } from '../types/jobData';
import { DOC } from '../services/documentCatalog';
import { formatCurrency } from '../services/pdfService';
import { SectionPdfActions, type PdfPreviewRequest } from './SectionPdfActions';

interface SectionChangeOrderProps {
  data: ChangeOrderData;
  contractRcv: number | '';
  jobData: RestorationJobData;
  onPreview: PdfPreviewRequest;
  onChange: (field: keyof ChangeOrderData, value: any) => void;
}

export const SectionChangeOrder: React.FC<SectionChangeOrderProps> = ({
  data,
  contractRcv,
  jobData,
  onPreview,
  onChange,
}) => {
  const origSum =
    typeof data.originalContractSum === 'number'
      ? data.originalContractSum
      : typeof contractRcv === 'number'
      ? contractRcv
      : 0;

  const prevChanges = typeof data.netPreviousChanges === 'number' ? data.netPreviousChanges : 0;
  const currentDelta =
    (data.changeType === 'decrease' ? -1 : data.changeType === 'increase' ? 1 : 0) *
    (typeof data.changeAmount === 'number' ? data.changeAmount : 0);
  const newContractTotal = origSum + prevChanges + currentDelta;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
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
        <div className="flex items-center space-x-2 bg-slate-50 p-1.5 rounded-xl border border-slate-200">
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
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Change Order Number *
          </label>
          <input
            type="text"
            value={data.changeOrderNumber}
            onChange={(e) => onChange('changeOrderNumber', e.target.value)}
            placeholder="CO-01"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-semibold focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Change Order Date */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Change Order Date
          </label>
          <input
            type="date"
            value={data.changeOrderDate}
            onChange={(e) => onChange('changeOrderDate', e.target.value)}
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Change Type: Increase / Decrease */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Contract Adjustment
          </label>
          <select
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
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Change Amount ($) *
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <DollarSign className="w-4 h-4" />
            </span>
            <input
              type="number"
              step="0.01"
              value={data.changeAmount}
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
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Added Working Days
          </label>
          <input
            type="number"
            value={data.addedDays}
            onChange={(e) =>
              onChange('addedDays', e.target.value === '' ? '' : parseInt(e.target.value))
            }
            placeholder="5"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Summary Mini Bar */}
        <div className="sm:col-span-3 bg-slate-50 p-3 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div>
            <span className="text-slate-400 block text-[10px]">Orig Contract Sum:</span>
            <span className="font-semibold text-slate-800">{formatCurrency(origSum)}</span>
          </div>
          <div>
            <span className="text-slate-400 block text-[10px]">Adjustment:</span>
            <span
              className={`font-semibold ${
                currentDelta >= 0 ? 'text-emerald-600' : 'text-rose-600'
              }`}
            >
              {currentDelta >= 0 ? '+' : ''}
              {formatCurrency(currentDelta)}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-[10px]">New Adjusted Total:</span>
            <span className="font-black text-slate-900 text-sm">
              {formatCurrency(newContractTotal)}
            </span>
          </div>
        </div>

        {/* Scope Description */}
        <div className="sm:col-span-2 lg:col-span-4">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            This contract is changed as follows (Scope Description) *
          </label>
          <textarea
            rows={3}
            value={data.scopeDescription}
            onChange={(e) => onChange('scopeDescription', e.target.value)}
            placeholder="Detailed description of additional repairs, materials, and labor required..."
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>
      </div>

      <SectionPdfActions jobData={jobData} docs={[DOC.changeOrder]} onPreview={onPreview} />
    </div>
  );
};
