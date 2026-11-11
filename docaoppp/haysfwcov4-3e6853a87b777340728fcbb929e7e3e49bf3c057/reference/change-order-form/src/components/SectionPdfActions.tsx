import React, { useState } from 'react';
import { Eye, FileDown, FileText, Loader2 } from 'lucide-react';
import type { RestorationJobData } from '../types/jobData';
import type { JobDocument } from '../services/documentCatalog';
import { downloadPdf } from '../services/pdfService';

/** Opens the in-app PDF preview modal (same handler the Documents & Output panel uses). */
export type PdfPreviewRequest = (doc: JobDocument) => void;

interface SectionPdfActionsProps {
  /** The live record the document is generated from. */
  jobData: RestorationJobData;
  /** Documents this form page feeds (usually one, at most two). */
  docs: JobDocument[];
  onPreview: PdfPreviewRequest;
  className?: string;
}

/**
 * Quick Preview / Download row rendered at the bottom of a form card, so a single document can be
 * checked or exported from the page the user is already working on.
 */
export const SectionPdfActions: React.FC<SectionPdfActionsProps> = ({
  jobData,
  docs,
  onPreview,
  className,
}) => {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleDownload = async (doc: JobDocument) => {
    try {
      setDownloadingId(doc.id);
      const bytes = await doc.generator(jobData);
      downloadPdf(bytes, doc.buildFileName(jobData));
    } catch (err) {
      console.error(`Failed generating ${doc.title}:`, err);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className={`mt-5 pt-4 border-t border-slate-100 ${className ?? ''}`}>
      <div className="flex flex-col gap-2.5">
        {docs.map((doc) => {
          const isDownloading = downloadingId === doc.id;
          return (
            <div key={doc.id} className="flex flex-wrap items-center justify-between gap-3">
              <span className="inline-flex min-w-0 items-center gap-2 text-[12px] text-slate-500">
                <FileText className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                <span className="truncate font-medium text-slate-600">{doc.label}</span>
                <span className="shrink-0 rounded border border-red-200/80 bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
                  {doc.code}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => onPreview(doc)}
                  title={`Preview ${doc.title} PDF`}
                  aria-label={`Preview ${doc.title} PDF`}
                  className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  <Eye className="mr-1.5 w-3.5 h-3.5 text-slate-500" />
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => handleDownload(doc)}
                  disabled={isDownloading}
                  title={`Download ${doc.title} PDF`}
                  aria-label={`Download ${doc.title} PDF`}
                  className="inline-flex items-center rounded-lg bg-slate-900 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-red-600 disabled:opacity-50"
                >
                  {isDownloading ? (
                    <Loader2 className="mr-1.5 w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FileDown className="mr-1.5 w-3.5 h-3.5" />
                  )}
                  Download
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
