import React from 'react';
import { CalendarClock } from 'lucide-react';
import { FinancialData, RestorationJobData } from '../types/jobData';
import { DOC } from '../services/documentCatalog';
import { formatCurrency } from '../services/pdfService';
import { SectionPdfActions, type PdfPreviewRequest } from './SectionPdfActions';

interface FinancialSummaryCardProps {
  financials: FinancialData;
  jobData: RestorationJobData;
  onPreview: PdfPreviewRequest;
  onRcvChange: (val: number | '') => void;
  onDeductibleChange: (val: number | '') => void;
}

const INPUT_CLASS =
  'w-full h-10 pl-7 pr-3 rounded-lg border border-slate-300 bg-white text-[15px] font-semibold text-slate-900 tabular-nums ' +
  'placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15 transition';

export const FinancialSummaryCard: React.FC<FinancialSummaryCardProps> = ({
  financials,
  jobData,
  onPreview,
  onRcvChange,
  onDeductibleChange,
}) => {
  const toNumber = (raw: string): number | '' => (raw === '' ? '' : parseFloat(raw));

  const schedule = [
    {
      label: 'Down payment',
      note: 'Due before work begins',
      share: '50%',
      amount: financials.downPayment,
      barClass: 'bg-slate-900',
    },
    {
      label: 'Mid-progress',
      note: 'Due at the halfway point',
      share: '25%',
      amount: financials.midProgressPayment,
      barClass: 'bg-slate-500',
    },
    {
      label: 'Balance',
      note: 'Due on final walk-through',
      share: '25%',
      amount: financials.balancePayment,
      barClass: 'bg-slate-300',
    },
  ];

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm">
      {/* Header */}
      <div className="px-3 sm:px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-slate-900 tracking-tight">
            Contract Financials
          </h2>
          <p className="mt-0.5 text-[12px] text-slate-500">
            Calculated automatically and applied to the agreement and checklist
          </p>
        </div>

        <div className="flex items-center gap-2 text-[12px] text-slate-500">
          <CalendarClock className="w-4 h-4 text-slate-400" />
          <span>
            Commence{' '}
            <span className="font-semibold text-slate-900 tabular-nums">
              {financials.commenceDays} days
            </span>
          </span>
          <span className="text-slate-300 select-none">·</span>
          <span>
            Complete{' '}
            <span className="font-semibold text-slate-900 tabular-nums">
              {financials.completeDays} days
            </span>
          </span>
        </div>
      </div>

      {/* Inputs + headline figure */}
      <div className="p-3 sm:p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="rcv-input"
              className="block text-[12px] font-medium text-slate-600 mb-1.5"
            >
              Total approved RCV
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
                $
              </span>
              <input
                id="rcv-input"
                type="number"
                step="0.01"
                inputMode="decimal"
                value={financials.totalApprovedRcv}
                onChange={(e) => onRcvChange(toNumber(e.target.value))}
                placeholder="0.00"
                className={INPUT_CLASS}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">Replacement cost value from the carrier</p>
          </div>

          <div>
            <label
              htmlFor="deductible-input"
              className="block text-[12px] font-medium text-slate-600 mb-1.5"
            >
              Deductible
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
                $
              </span>
              <input
                id="deductible-input"
                type="number"
                step="0.01"
                inputMode="decimal"
                value={financials.deductible}
                onChange={(e) => onDeductibleChange(toNumber(e.target.value))}
                placeholder="0.00"
                className={INPUT_CLASS}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">Collected from the property owner</p>
          </div>
        </div>

        <div className="lg:col-span-5">
          <div className="h-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3.5 flex flex-col justify-center">
            <p className="text-[12px] font-medium text-slate-600">Net claim value</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums leading-none">
              {formatCurrency(financials.netClaimValue)}
            </p>
            <p className="mt-2 text-[11px] text-slate-500">
              Total RCV minus the deductible — the insurer&rsquo;s responsibility.
            </p>
          </div>
        </div>
      </div>

      {/* Payment schedule */}
      <div className="px-3 sm:px-5 py-4 border-t border-slate-100">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-semibold text-slate-900">Payment schedule</h3>
          <span className="text-[11px] text-slate-500">Split of the approved RCV</span>
        </div>

        <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          {schedule.map((item) => (
            <div
              key={item.label}
              className={item.barClass}
              style={{ width: item.share }}
              aria-hidden
            />
          ))}
        </div>

        <dl className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4">
          {schedule.map((item) => (
            <div key={item.label}>
              <dt className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-slate-600">{item.label}</span>
                <span className="text-[11px] font-semibold text-slate-400 tabular-nums">
                  {item.share}
                </span>
              </dt>
              <dd className="mt-1 text-[15px] font-semibold text-slate-900 tabular-nums">
                {formatCurrency(item.amount)}
              </dd>
              <dd className="mt-0.5 text-[11px] text-slate-500">{item.note}</dd>
            </div>
          ))}
        </dl>
      </div>

      <SectionPdfActions
        jobData={jobData}
        docs={[DOC.contract, DOC.cancellationNotice]}
        onPreview={onPreview}
        className="mt-0 px-3 sm:px-5 pb-4"
      />
    </section>
  );
};
