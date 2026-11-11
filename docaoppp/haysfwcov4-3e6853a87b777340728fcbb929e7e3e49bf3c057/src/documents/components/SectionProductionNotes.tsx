import React from 'react';
import { StickyNote } from 'lucide-react';
import { RestorationJobData } from '../types/jobData';
import { DOC } from '../services/documentCatalog';
import { SectionPdfActions, type PdfPreviewRequest } from './SectionPdfActions';

interface SectionProductionNotesProps {
  productionNotes: RestorationJobData['productionNotes'];
  jobData: RestorationJobData;
  onPreview: PdfPreviewRequest;
  onChange: (field: keyof RestorationJobData['productionNotes'], value: string) => void;
}

const FIELDS: Array<{
  key: keyof RestorationJobData['productionNotes'];
  label: string;
  placeholder: string;
}> = [
  {
    key: 'scopeSummary',
    label: 'Scope & Repairs Summary',
    placeholder: 'Narrative of the repairs and scope of work for this loss...',
  },
  {
    key: 'materialsAndEquipment',
    label: 'Materials & Equipment',
    placeholder: 'Materials, finishes, and equipment staged or ordered for the job...',
  },
  {
    key: 'scheduleAndAccess',
    label: 'Schedule & Access',
    placeholder: 'Start times, crew schedule, lockbox codes, and site access details...',
  },
  {
    key: 'safetyConsiderations',
    label: 'Safety Considerations',
    placeholder: 'Known hazards, containment, PPE, or site-specific safety notes...',
  },
  {
    key: 'communicationNotes',
    label: 'Communication Notes',
    placeholder: 'Customer, adjuster, and crew communication preferences or updates...',
  },
  {
    key: 'additionalNotes',
    label: 'Additional Information',
    placeholder: 'Anything else the production team should know...',
  },
];

export const SectionProductionNotes: React.FC<SectionProductionNotesProps> = ({
  productionNotes,
  jobData,
  onPreview,
  onChange,
}) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-5">
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-slate-100">
        <div className="p-2 rounded-lg bg-slate-100 text-slate-500">
          <StickyNote className="w-4 h-4" />
        </div>
        <div>
          <h3 className="text-[15px] font-semibold text-slate-900">Production Notes</h3>
          <p className="text-xs text-slate-500">
            Loss and damage details are filled in automatically; add any extra production information below
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {FIELDS.map((field) => (
          <div key={field.key} className={field.key === 'scopeSummary' || field.key === 'additionalNotes' ? 'md:col-span-2' : ''}>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {field.label}
            </label>
            <textarea
              rows={field.key === 'scopeSummary' || field.key === 'additionalNotes' ? 3 : 2}
              value={productionNotes[field.key]}
              onChange={(e) => onChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition resize-y"
            />
          </div>
        ))}
      </div>

      <SectionPdfActions jobData={jobData} docs={[DOC.productionNotes]} onPreview={onPreview} />
    </div>
  );
};
