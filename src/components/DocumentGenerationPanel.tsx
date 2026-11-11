import React, { useState } from 'react';
import {
  FileDown,
  Eye,
  Layers,
  FileCheck2,
  HardDriveUpload,
  TableProperties,
  CheckCircle2,
  Loader2,
  ExternalLink,
  ShieldCheck,
  Archive,
  AlertCircle,
  FileText,
} from 'lucide-react';
import JSZip from 'jszip';
import { RestorationJobData } from '../types/jobData';
import {
  JOB_DOCUMENTS,
  buildCombinedPacketFileName,
  safeCustomerName,
  safeJobNumber,
  type JobDocument,
} from '../services/documentCatalog';
import {
  generateCompletePacket,
  downloadPdf,
  formatCurrency,
} from '../services/pdfService';
import { PdfPreviewRequest } from './SectionPdfActions';
import { getMissingJobFields, type MissingJobField } from '../services/jobReadiness';

interface DocumentGenerationPanelProps {
  jobData: RestorationJobData;
  onPreview: PdfPreviewRequest;
  onSaveToDrive: () => void;
  onSyncToSheets: () => void;
  isDriveLoading: boolean;
  isSheetsLoading: boolean;
  driveSuccessLink?: string;
  sheetsSuccessLink?: string;
  onReviewField?: (field: MissingJobField) => void;
}

export const DocumentGenerationPanel: React.FC<DocumentGenerationPanelProps> = ({
  jobData,
  onPreview,
  onSaveToDrive,
  onSyncToSheets,
  isDriveLoading,
  isSheetsLoading,
  driveSuccessLink,
  sheetsSuccessLink,
  onReviewField,
}) => {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [isZipping, setIsZipping] = useState(false);
  const [lastGeneratedSummary, setLastGeneratedSummary] = useState<{
    timestamp: string;
    filesCount: number;
    calculatedRCV: string;
    calculatedNet: string;
    calculatedDown: string;
    unresolvedFields: string[];
  } | null>(null);

  // Exact deliverables mapping required by Hays Intake to Production specification.
  const combinedFileName = buildCombinedPacketFileName(jobData);

  // The eight standalone deliverables — generators and file names come from the shared catalog
  // so the per-section quick actions always match this panel.
  const docList: JobDocument[] = JOB_DOCUMENTS;

  const missingFields = getMissingJobFields(jobData);
  const unresolvedList = missingFields.map((field) => field.label);

  const isQualityGatePassed = unresolvedList.length === 0;

  const handleDownload = async (doc: JobDocument) => {
    try {
      setDownloadingId(doc.id);
      const bytes = await doc.generator(jobData);
      downloadPdf(bytes, doc.buildFileName(jobData));
      setLastGeneratedSummary({
        timestamp: new Date().toLocaleTimeString(),
        filesCount: 1,
        calculatedRCV: formatCurrency(jobData.financials.totalApprovedRcv),
        calculatedNet: formatCurrency(jobData.financials.netClaimValue),
        calculatedDown: formatCurrency(jobData.financials.downPayment),
        unresolvedFields: unresolvedList,
      });
    } catch (err) {
      console.error('Failed generating document:', err);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDownloadCompletePacket = async () => {
    try {
      setDownloadingId('packet');
      const bytes = await generateCompletePacket(jobData);
      downloadPdf(bytes, combinedFileName);
      setLastGeneratedSummary({
        timestamp: new Date().toLocaleTimeString(),
        filesCount: 1,
        calculatedRCV: formatCurrency(jobData.financials.totalApprovedRcv),
        calculatedNet: formatCurrency(jobData.financials.netClaimValue),
        calculatedDown: formatCurrency(jobData.financials.downPayment),
        unresolvedFields: unresolvedList,
      });
    } catch (err) {
      console.error('Failed generating complete packet:', err);
    } finally {
      setDownloadingId(null);
    }
  };

  // Download All as ZIP archive
  const handleDownloadZipPackage = async () => {
    try {
      setIsZipping(true);
      const zip = new JSZip();

      // 1. Generate Combined Packet
      const combinedBytes = await generateCompletePacket(jobData);
      zip.file(combinedFileName, combinedBytes);

      // 2. Generate each individual document
      for (const doc of docList) {
        const bytes = await doc.generator(jobData);
        zip.file(doc.buildFileName(jobData), bytes);
      }

      // 3. Generate summary text file
      const summaryText = `HAYS + SONS COMPLETE RESTORATION
Production Packet Summary
Generated: ${new Date().toLocaleString()}
------------------------------------------------
Job Number: ${jobData.customer.jobNumber}
Customer: ${jobData.customer.customerName}
Loss Address: ${jobData.customer.lossAddress}
Insurance Carrier: ${jobData.insurance.carrier}
Claim Number: ${jobData.insurance.claimNumber}
Primary Adjuster: ${jobData.insurance.primaryAdjuster}

Financial Reconciliation:
Total Approved RCV: ${formatCurrency(jobData.financials.totalApprovedRcv)}
Deductible: ${formatCurrency(jobData.financials.deductible)}
Net Claim Value: ${formatCurrency(jobData.financials.netClaimValue)}
Down Payment (50%): ${formatCurrency(jobData.financials.downPayment)}
Mid-Progress (25%): ${formatCurrency(jobData.financials.midProgressPayment)}
Balance Due (25%): ${formatCurrency(jobData.financials.balancePayment)}
Contract Timelines: ${jobData.financials.commenceDays} days commence, ${jobData.financials.completeDays} days complete

Files Included:
- ${combinedFileName}
${docList.map((d) => `- ${d.buildFileName(jobData)}`).join('\n')}
`;
      zip.file(`README_Production_Summary_${safeJobNumber}.txt`, summaryText);

      // 4. Download Zip
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Hays_Production_Packet_${safeJobNumber(jobData)}_${safeCustomerName(jobData)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      setLastGeneratedSummary({
        timestamp: new Date().toLocaleTimeString(),
        filesCount: 9,
        calculatedRCV: formatCurrency(jobData.financials.totalApprovedRcv),
        calculatedNet: formatCurrency(jobData.financials.netClaimValue),
        calculatedDown: formatCurrency(jobData.financials.downPayment),
        unresolvedFields: unresolvedList,
      });
    } catch (err) {
      console.error('ZIP package error:', err);
    } finally {
      setIsZipping(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-3">
            <span className="p-2 rounded-lg bg-slate-100 text-slate-500">
              <Layers className="w-4 h-4" />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-slate-900 tracking-tight">
                Documents
              </h2>
              <p className="text-[12px] text-slate-500 mt-0.5">
                Review, preview, and download the production packet or individual forms
              </p>
            </div>
          </div>
        </div>

        {/* Workspace Cloud Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onSaveToDrive}
            disabled={isDriveLoading}
            type="button"
            className="inline-flex items-center px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 transition shadow-sm disabled:opacity-50"
            title="Save the complete PDF packet to shared Drive storage through Google Apps Script"
          >
            {isDriveLoading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin text-red-600" />
            ) : (
              <HardDriveUpload className="w-4 h-4 mr-2 text-blue-600" />
            )}
            Save to Google Drive
          </button>

          <button
            onClick={onSyncToSheets}
            disabled={isSheetsLoading}
            type="button"
            className="inline-flex items-center px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 transition shadow-sm disabled:opacity-50"
            title="Update this job in the shared Google Sheets database through Google Apps Script"
          >
            {isSheetsLoading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin text-emerald-600" />
            ) : (
              <TableProperties className="w-4 h-4 mr-2 text-emerald-600" />
            )}
            Sync to Google Sheets
          </button>
        </div>
      </div>

      {/* Quality Gate Status Strip */}
      <div className="mt-4 p-3 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs bg-slate-50 border-slate-200">
        <div className="flex items-center gap-2.5">
          {isQualityGatePassed ? (
            <div className="p-1 rounded-full bg-emerald-100 text-emerald-700">
              <ShieldCheck className="w-4 h-4" />
            </div>
          ) : (
            <div className="p-1 rounded-full bg-amber-100 text-amber-700">
              <AlertCircle className="w-4 h-4" />
            </div>
          )}
          <div>
            <span className="font-bold text-slate-800">
              {isQualityGatePassed
                ? 'Required fields complete'
                : `${missingFields.length} required field${missingFields.length === 1 ? '' : 's'} to review`}
            </span>
            <span className="text-slate-500 block text-[11px]">
              {isQualityGatePassed
                ? 'Customer, claim, and financial fields are filled in. Review the packet before sharing.'
                : 'Choose a missing field below to fill it in. Downloads remain available with blank placeholders.'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-600">
          <span className="bg-white px-2 py-1 rounded border border-slate-200">
            RCV: {formatCurrency(jobData.financials.totalApprovedRcv)}
          </span>
          <span className="bg-white px-2 py-1 rounded border border-slate-200">
            Net: {formatCurrency(jobData.financials.netClaimValue)}
          </span>
        </div>
      </div>

      {missingFields.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2" aria-label="Missing required fields">
          {missingFields.map((field) => onReviewField ? (
            <button
              key={field.inputId}
              type="button"
              onClick={() => onReviewField(field)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            >
              <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
              {field.label}
            </button>
          ) : <span key={field.inputId} className="text-xs text-amber-900">{field.label}</span>)}
        </div>
      )}

      {/* Cloud Links Notifications if saved */}
      {(driveSuccessLink || sheetsSuccessLink) && (
        <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-800">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Shared storage updated:</span>
          </div>
          <div className="flex items-center gap-3">
            {driveSuccessLink && (
              <a
                href={driveSuccessLink}
                target="_blank"
                rel="noreferrer"
                className="font-bold underline flex items-center gap-1 hover:text-emerald-950"
              >
                Open in Drive <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {sheetsSuccessLink && (
              <a
                href={sheetsSuccessLink}
                target="_blank"
                rel="noreferrer"
                className="font-bold underline flex items-center gap-1 hover:text-emerald-950"
              >
                Open Google Sheet <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* Complete packet */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-5 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5">
        <div className="flex items-start gap-3.5 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
            <FileCheck2 className="w-5 h-5 text-slate-500" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-[14px] font-semibold text-slate-900">Complete production packet</h3>
              <span className="text-[11px] font-medium text-slate-600 bg-white border border-slate-200 rounded px-1.5 py-0.5">
                9 pages
              </span>
            </div>
            <p className="mt-1 text-[12px] text-slate-500 max-w-xl">
              All eight documents bundled in exact production order.
            </p>
            <p className="mt-1.5 font-mono text-[11px] text-slate-400 break-all">{combinedFileName}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto justify-end shrink-0">
          <button
            onClick={() =>
              onPreview({
                id: 'completePacket',
                code: '',
                label: 'Complete Packet',
                title: 'Complete 9-Page Restoration Packet',
                pages: '9 pages',
                description: 'All eight documents bundled in exact production order.',
                generator: () => generateCompletePacket(jobData),
                buildFileName: () => buildCombinedPacketFileName(jobData),
              })
            }
            type="button"
            className="flex-1 sm:flex-initial inline-flex items-center justify-center px-3.5 py-2.5 rounded-lg text-[13px] font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 transition"
          >
            <Eye className="w-4 h-4 mr-1.5" />
            Preview
          </button>

          <button
            onClick={handleDownloadCompletePacket}
            disabled={downloadingId === 'packet'}
            type="button"
            className="flex-1 sm:flex-initial inline-flex items-center justify-center px-4 py-2.5 rounded-lg text-[13px] font-semibold bg-red-600 hover:bg-red-700 text-white transition shadow-sm disabled:opacity-50"
          >
            {downloadingId === 'packet' ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <FileDown className="w-4 h-4 mr-1.5" />
            )}
            Download packet
          </button>

          <button
            onClick={handleDownloadZipPackage}
            disabled={isZipping}
            type="button"
            className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2.5 rounded-lg text-[13px] font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 transition disabled:opacity-50"
            title="Download a ZIP containing all 9 files plus a summary"
          >
            {isZipping ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <Archive className="w-4 h-4 mr-1.5 text-slate-400" />
            )}
            Download all as ZIP
          </button>
        </div>
      </div>

      {/* Grid of Individual Forms */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Individual documents
          </h4>
          <span className="text-xs text-slate-500">Preview or download a single form</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {docList.map((doc) => {
            const isDownloading = downloadingId === doc.id;
            return (
              <div
                key={doc.id}
                className="bg-slate-50 hover:bg-white rounded-xl p-4 border border-slate-200 hover:border-slate-300 hover:shadow-sm transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[11px] font-bold text-red-600 bg-red-50 border border-red-200/80 px-2 py-0.5 rounded">
                      {doc.code} • {doc.pages}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono truncate max-w-[140px]">
                      {doc.buildFileName(jobData)}
                    </span>
                  </div>
                  <h5 className="font-bold text-slate-900 text-sm">{doc.title}</h5>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">{doc.description}</p>
                </div>

                <div className="flex items-center space-x-2 mt-4 pt-3 border-t border-slate-200/70">
                  <button
                    onClick={() => onPreview(doc)}
                    type="button"
                    className="flex-1 inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 transition"
                  >
                    <Eye className="w-3.5 h-3.5 mr-1 text-slate-500" />
                    Preview
                  </button>
                  <button
                    onClick={() => handleDownload(doc)}
                    disabled={isDownloading}
                    type="button"
                    className="flex-1 inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-red-600 transition shadow-sm disabled:opacity-50"
                  >
                    {isDownloading ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin text-white" />
                    ) : (
                      <FileDown className="w-3.5 h-3.5 mr-1" />
                    )}
                    Download
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Generation Completion Note per Skill requirement */}
      {lastGeneratedSummary && (
        <div className="mt-6 p-4 rounded-xl bg-slate-900 text-slate-200 border border-slate-800 text-xs animate-in fade-in">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2">
            <span className="font-bold text-white flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              Generation Completion Note ({lastGeneratedSummary.timestamp})
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {lastGeneratedSummary.filesCount} file(s) generated
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-slate-300">
            <div>
              <span className="text-slate-400 block text-[10px]">Total Contract RCV:</span>
              <span className="font-bold text-white">{lastGeneratedSummary.calculatedRCV}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px]">Net Claim Value:</span>
              <span className="font-bold text-emerald-400">{lastGeneratedSummary.calculatedNet}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px]">50% Down Payment:</span>
              <span className="font-bold text-sky-400">{lastGeneratedSummary.calculatedDown}</span>
            </div>
          </div>
          {lastGeneratedSummary.unresolvedFields.length > 0 ? (
            <p className="mt-2 text-amber-300 text-[11px]">
              ⚠️ Unresolved fields left blank: {lastGeneratedSummary.unresolvedFields.join(', ')}
            </p>
          ) : (
            <p className="mt-2 text-emerald-400 text-[11px]">
              Required fields were filled in when generated. Review the documents before sharing.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
