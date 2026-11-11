import React from 'react';
import { Users, Building, ShieldCheck, Mail, Phone, MapPin } from 'lucide-react';
import { TeamData, BranchData, RestorationJobData } from '../types/jobData';
import { DOC } from '../services/documentCatalog';
import { SectionPdfActions, type PdfPreviewRequest } from './SectionPdfActions';

interface SectionTeamProps {
  data: TeamData;
  branch: BranchData;
  jobData: RestorationJobData;
  onPreview: PdfPreviewRequest;
  onChange: (field: keyof TeamData, value: string) => void;
}

export const SectionTeam: React.FC<SectionTeamProps> = ({
  data,
  branch,
  jobData,
  onPreview,
  onChange,
}) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-5">
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-slate-100">
        <div className="p-2 rounded-lg bg-slate-100 text-slate-500">
          <Users className="w-4 h-4" />
        </div>
        <div>
          <h3 className="text-[15px] font-semibold text-slate-900">Team &amp; Assignment</h3>
          <p className="text-xs text-slate-500">
            Internal restoration participants, estimators, supervisors, and pre-filled branch defaults
          </p>
        </div>
      </div>

      {/* Pre-filled Hardcoded Defaults Notice Box */}
      <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
            <Building className="w-4 h-4 text-red-600" />
            Branch Headquarters (Pre-filled Defaults)
          </span>
          <span className="text-[10px] bg-red-100 text-red-700 font-semibold px-2 py-0.5 rounded border border-red-200">
            Locked Defaults
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs text-slate-600">
          <div>
            <span className="text-slate-400 block text-[10px]">Office Address:</span>
            <span className="font-medium text-slate-800">{branch.address}, {branch.cityStateZip}</span>
          </div>
          <div>
            <span className="text-slate-400 block text-[10px]">Phone / Fax:</span>
            <span className="font-medium text-slate-800">{branch.phone} / {branch.fax}</span>
          </div>
          <div>
            <span className="text-slate-400 block text-[10px]">General Manager:</span>
            <span className="font-medium text-slate-800">{branch.managerName}</span>
          </div>
          <div>
            <span className="text-slate-400 block text-[10px]">Manager Email:</span>
            <span className="font-medium text-slate-800">{branch.managerEmail}</span>
          </div>
        </div>
      </div>

      {/* Team Form Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Estimator */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Estimator *
          </label>
          <input
            type="text"
            value={data.estimator}
            onChange={(e) => onChange('estimator', e.target.value)}
            placeholder="Russell Shive"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-medium focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Project Manager */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Project Manager *
          </label>
          <input
            type="text"
            value={data.projectManager}
            onChange={(e) => onChange('projectManager', e.target.value)}
            placeholder="e.g. Markus Henderson"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-medium focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Supervisor */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Supervisor
          </label>
          <input
            type="text"
            value={data.supervisor}
            onChange={(e) => onChange('supervisor', e.target.value)}
            placeholder="Kenny Belford"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Coordinator */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Coordinator
          </label>
          <input
            type="text"
            value={data.coordinator}
            onChange={(e) => onChange('coordinator', e.target.value)}
            placeholder="Rhnea Schinbeckler"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Foreman */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Foreman
          </label>
          <input
            type="text"
            value={data.foreman}
            onChange={(e) => onChange('foreman', e.target.value)}
            placeholder="To be determined"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Marketing Person */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Marketing Person
          </label>
          <input
            type="text"
            value={data.marketingPerson}
            onChange={(e) => onChange('marketingPerson', e.target.value)}
            placeholder="Cecilia Rolf"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Accounting Person */}
        <div className="sm:col-span-2">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Accounting Person
          </label>
          <input
            type="text"
            value={data.accountingPerson}
            onChange={(e) => onChange('accountingPerson', e.target.value)}
            placeholder="Jami Hillock"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>
      </div>

      <SectionPdfActions jobData={jobData} docs={[DOC.preliminaryReport]} onPreview={onPreview} />
    </div>
  );
};
