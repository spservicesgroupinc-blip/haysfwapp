import React from 'react';
import { Shield, FileCheck, Calendar, Clock, DollarSign, AlertCircle } from 'lucide-react';
import { InsuranceData, RestorationJobData } from '../types/jobData';
import { DOC } from '../services/documentCatalog';
import { SectionPdfActions, type PdfPreviewRequest } from './SectionPdfActions';

interface SectionInsuranceProps {
  data: InsuranceData;
  jobData: RestorationJobData;
  onPreview: PdfPreviewRequest;
  onChange: (field: keyof InsuranceData, value: any) => void;
}

export const SectionInsurance: React.FC<SectionInsuranceProps> = ({
  data,
  jobData,
  onPreview,
  onChange,
}) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-5">
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-slate-100">
        <div className="p-2 rounded-lg bg-slate-100 text-slate-500">
          <Shield className="w-4 h-4" />
        </div>
        <div>
          <h3 className="text-[15px] font-semibold text-slate-900">Insurance &amp; Claim</h3>
          <p className="text-xs text-slate-500">
            Carrier, adjusters, policy numbers, loss timeline, and field inspection details
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Insurance Carrier */}
        <div>
          <label htmlFor="insurance-carrier" className="block text-xs font-semibold text-slate-700 mb-1">
            Insurance Carrier *
          </label>
          <input
            id="insurance-carrier"
            type="text"
            value={data.carrier}
            onChange={(e) => onChange('carrier', e.target.value)}
            placeholder="Insurance company"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-medium focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Claim Number */}
        <div>
          <label htmlFor="insurance-claimNumber" className="block text-xs font-semibold text-slate-700 mb-1">
            Claim Number *
          </label>
          <input
            id="insurance-claimNumber"
            type="text"
            value={data.claimNumber}
            onChange={(e) => onChange('claimNumber', e.target.value)}
            placeholder="CLM-000000"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-semibold focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Policy Number */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Policy Number
          </label>
          <input
            type="text"
            value={data.policyNumber}
            onChange={(e) => onChange('policyNumber', e.target.value)}
            placeholder="e.g. SF-IN-9841209"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Primary Adjuster */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Primary Adjuster Name *
          </label>
          <input
            type="text"
            value={data.primaryAdjuster}
            onChange={(e) => onChange('primaryAdjuster', e.target.value)}
            placeholder="e.g. David Miller"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Adjuster Phone */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Adjuster Phone Number
          </label>
          <input
            type="tel"
            value={data.adjusterPhone || ''}
            onChange={(e) => onChange('adjusterPhone', e.target.value)}
            placeholder="1-000-000-0000"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Adjuster Email */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Adjuster Email
          </label>
          <input
            type="email"
            value={data.adjusterEmail || ''}
            onChange={(e) => onChange('adjusterEmail', e.target.value)}
            placeholder="e.g. dmiller@statefarmclaims.com"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Independent Adjuster */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Independent Adjuster
          </label>
          <input
            type="text"
            value={data.independentAdjuster}
            onChange={(e) => onChange('independentAdjuster', e.target.value)}
            placeholder="e.g. Midwest Property Adjusters"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Broker / Agent */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Broker / Agent
          </label>
          <input
            type="text"
            value={data.brokerAgent}
            onChange={(e) => onChange('brokerAgent', e.target.value)}
            placeholder="e.g. Sarah Jenkins Agency"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Agent Phone */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Agent Phone Number
          </label>
          <input
            type="tel"
            value={data.agentPhone || ''}
            onChange={(e) => onChange('agentPhone', e.target.value)}
            placeholder="1-000-000-0000"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Reported By */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Reported By
          </label>
          <input
            type="text"
            value={data.reportedBy}
            onChange={(e) => onChange('reportedBy', e.target.value)}
            placeholder="e.g. Insured"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Referred By */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Referred By
          </label>
          <input
            type="text"
            value={data.referredBy}
            onChange={(e) => onChange('referredBy', e.target.value)}
            placeholder="e.g. Insurance Carrier Roster"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Date of Loss */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Date of Loss *
          </label>
          <input
            type="date"
            value={data.dateOfLoss}
            onChange={(e) => onChange('dateOfLoss', e.target.value)}
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Time of Loss */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Time of Loss
          </label>
          <input
            type="time"
            value={data.timeOfLoss}
            onChange={(e) => onChange('timeOfLoss', e.target.value)}
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Date Received */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Date Received
          </label>
          <input
            type="date"
            value={data.dateReceived}
            onChange={(e) => onChange('dateReceived', e.target.value)}
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Date Inspected */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Date Inspected
          </label>
          <input
            type="date"
            value={data.dateInspected}
            onChange={(e) => onChange('dateInspected', e.target.value)}
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Type of Loss */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Type of Loss (Primary)
          </label>
          <select
            value={data.typeOfLoss}
            onChange={(e) => onChange('typeOfLoss', e.target.value)}
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          >
            <option value="Water - Supply Line Burst">Water - Supply Line Burst</option>
            <option value="Water - Sewage Backup">Water - Sewage Backup</option>
            <option value="Fire & Smoke Damage">Fire & Smoke Damage</option>
            <option value="Storm / Wind / Hail">Storm / Wind / Hail</option>
            <option value="Vehicle Impact / Structural">Vehicle Impact / Structural</option>
            <option value="Mold Remediation">Mold Remediation</option>
          </select>
        </div>

        {/* Type of Loss Secondary */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Secondary Loss Type
          </label>
          <input
            type="text"
            value={data.typeOfLossSecondary}
            onChange={(e) => onChange('typeOfLossSecondary', e.target.value)}
            placeholder="e.g. Structural Flooring Damage"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Rough Estimate Amount */}
        <div className="sm:col-span-2">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Rough Estimate Amount ($)
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <DollarSign className="w-4 h-4" />
            </span>
            <input
              type="number"
              step="0.01"
              value={data.roughEstimateAmount}
              onChange={(e) =>
                onChange(
                  'roughEstimateAmount',
                  e.target.value === '' ? '' : parseFloat(e.target.value)
                )
              }
              placeholder="18500.00"
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
            />
          </div>
        </div>

        {/* Loss Description */}
        <div className="sm:col-span-2 lg:col-span-4">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Loss Description (Appears on Preliminary Report)
          </label>
          <textarea
            rows={2}
            value={data.lossDescription}
            onChange={(e) => onChange('lossDescription', e.target.value)}
            placeholder="Describe the cause, affected areas, and initial assessment..."
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Special Instructions & Findings */}
        <div className="sm:col-span-2 lg:col-span-2">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Special Instructions
          </label>
          <textarea
            rows={2}
            value={data.specialInstructions}
            onChange={(e) => onChange('specialInstructions', e.target.value)}
            placeholder="Gate codes, homeowner schedule, pets on premise..."
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        <div className="sm:col-span-2 lg:col-span-2">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Detailed Findings
          </label>
          <textarea
            rows={2}
            value={data.detailedFindings}
            onChange={(e) => onChange('detailedFindings', e.target.value)}
            placeholder="Moisture readings, structural concerns, containment details..."
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>
      </div>

      <SectionPdfActions jobData={jobData} docs={[DOC.preliminaryReport]} onPreview={onPreview} />
    </div>
  );
};
