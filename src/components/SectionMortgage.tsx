import React from 'react';
import { Landmark, Phone, Lock } from 'lucide-react';
import { MortgageData, RestorationJobData } from '../types/jobData';
import { DOC } from '../services/documentCatalog';
import { SectionPdfActions, type PdfPreviewRequest } from './SectionPdfActions';

interface SectionMortgageProps {
  data: MortgageData;
  jobData: RestorationJobData;
  onPreview: PdfPreviewRequest;
  onChange: (field: keyof MortgageData, value: any) => void;
}

export const SectionMortgage: React.FC<SectionMortgageProps> = ({
  data,
  jobData,
  onPreview,
  onChange,
}) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-slate-100 text-slate-500">
            <Landmark className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900">Mortgage &amp; Lienholder</h3>
            <p className="text-xs text-slate-500">
              Required for the Mortgage Authorization Form to communicate with the lender and release insurance drafts
            </p>
          </div>
        </div>

        {/* Boolean Toggle */}
        <div className="flex items-center space-x-3 bg-slate-50 p-1.5 rounded-xl border border-slate-200 self-start sm:self-auto">
          <span className="text-xs font-semibold text-slate-700 px-2">Mortgage on Claim?</span>
          <button
            type="button"
            onClick={() => onChange('hasMortgage', true)}
            className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
              data.hasMortgage
                ? 'bg-red-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => onChange('hasMortgage', false)}
            className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
              !data.hasMortgage
                ? 'bg-slate-700 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            No
          </button>
        </div>
      </div>

      {data.hasMortgage ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-in fade-in duration-200">
          {/* Mortgage Company */}
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Mortgage Company Name *
            </label>
            <input
              type="text"
              value={data.mortgageCompany}
              onChange={(e) => onChange('mortgageCompany', e.target.value)}
              placeholder="e.g. Chase Home Lending"
              className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-medium focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
            />
          </div>

          {/* Mortgage Phone */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Lender Phone Number
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Phone className="w-4 h-4" />
              </span>
              <input
                type="tel"
                value={data.mortgagePhone}
                onChange={(e) => onChange('mortgagePhone', e.target.value)}
                placeholder="e.g. 1-800-848-9136"
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
              />
            </div>
          </div>

          {/* Loan Number */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Loan # *
            </label>
            <input
              type="text"
              value={data.loanNumber}
              onChange={(e) => onChange('loanNumber', e.target.value)}
              placeholder="e.g. HL-88291044"
              className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
            />
          </div>

          {/* Last 4 SSN */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Owner SSN (Last 4 digits only)
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Lock className="w-4 h-4" />
              </span>
              <input
                type="text"
                maxLength={4}
                value={data.last4Ssn}
                onChange={(e) => onChange('last4Ssn', e.target.value.replace(/\D/g, ''))}
                placeholder="4482"
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition tracking-widest font-mono"
              />
            </div>
          </div>

          {/* Spouse Last 4 SSN */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Spouse SSN (Last 4 digits only)
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Lock className="w-4 h-4" />
              </span>
              <input
                type="text"
                maxLength={4}
                value={data.spouseLast4Ssn}
                onChange={(e) => onChange('spouseLast4Ssn', e.target.value.replace(/\D/g, ''))}
                placeholder="Optional"
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition tracking-widest font-mono"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-xl bg-slate-50 border border-dashed border-slate-300 text-center text-xs text-slate-500">
          Property owner owns home free and clear (No mortgage lienholder on insurance draft).
        </div>
      )}

      <SectionPdfActions jobData={jobData} docs={[DOC.mortgageAuth]} onPreview={onPreview} />
    </div>
  );
};
