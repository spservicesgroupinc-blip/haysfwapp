import React, { useEffect, useId, useRef, useState } from 'react';
import {
  Sparkles,
  ArrowRight,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Info,
  Loader2,
  FileText,
  ChevronDown,
} from 'lucide-react';
import { RestorationJobData } from '../types/jobData';
import {
  applyAiExtractionToJob,
  IntakeParseResult,
  ProvenanceRecord,
  FieldProvenanceType,
  ExtractedSectionSummary,
} from '../services/intakeParser';
import { analyzeIntakeWithAi } from '../services/deepseekIntake';
import { extractTextFromPdfBuffer } from '../services/pdfExtractor';
import { getMissingJobFields } from '../services/jobReadiness';

interface IntakeParserCardProps {
  onApplyIntake: (job: RestorationJobData, provenance: ProvenanceRecord) => void;
  /** The record currently in the workspace - pastes merge into it instead of replacing it. */
  currentJob?: RestorationJobData;
  currentProvenance?: ProvenanceRecord;
  /** Keep the intake mounted while showing a compact summary in other workspace tabs. */
  isExpanded?: boolean;
  onExpand?: () => void;
}

/** Minimum size of a paste before it is parsed automatically. */
const AUTO_PARSE_MIN_CHARS = 20;

type ParseSource = 'manual' | 'paste' | 'file';
type ParseMode = 'ai' | 'rules';

export const IntakeParserCard: React.FC<IntakeParserCardProps> = ({
  onApplyIntake,
  currentJob,
  isExpanded = true,
  onExpand,
}) => {
  const [intakeText, setIntakeText] = useState('');
  const [isExtractingPdf, setIsExtractingPdf] = useState(false);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [uploadedFileInfo, setUploadedFileInfo] = useState<{
    name: string;
    sizeKb: number;
    isPdf: boolean;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [lastParseResult, setLastParseResult] = useState<{
    fieldsCount: number;
    updatedCount: number;
    jobData: RestorationJobData;
    warnings: string[];
    sections: ExtractedSectionSummary[];
    source: ParseSource;
    mode: ParseMode;
    aiNotes?: string;
    aiError?: string;
  } | null>(null);
  const lastParsedTextRef = useRef('');
  const isActiveRef = useRef(true);
  const pasteTimerRef = useRef<number | null>(null);
  const fileReaderRef = useRef<FileReader | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const currentJobRef = useRef(currentJob);
  currentJobRef.current = currentJob;
  const intakeTextId = useId();
  const intakeHelpId = useId();

  useEffect(() => {
    isActiveRef.current = true;
    return () => {
      // A reset must discard work that finishes after this intake panel is removed.
      isActiveRef.current = false;
      if (pasteTimerRef.current !== null) window.clearTimeout(pasteTimerRef.current);
      if (fileReaderRef.current?.readyState === FileReader.LOADING) fileReaderRef.current.abort();
    };
  }, []);

  const commitResult = (
    result: IntakeParseResult,
    source: ParseSource,
    mode: ParseMode,
    aiError?: string
  ) => {
    onApplyIntake(result.jobData, result.provenance);
    setLastParseResult({
      fieldsCount: result.extractionSummary.fieldsExtractedCount,
      updatedCount: result.extractionSummary.fieldsUpdatedCount,
      jobData: result.jobData,
      warnings: result.extractionSummary.warnings,
      sections: result.extractionSummary.sections,
      source,
      mode,
      aiNotes: result.extractionSummary.aiNotes,
      aiError,
    });
  };

  /** The backend analyzes the pasted or uploaded text on its own; no other data is sent. */
  const handleParse = async (textToParse: string, source: ParseSource = 'manual') => {
    const trimmed = textToParse.trim();
    if (!trimmed || isAnalyzing || !isActiveRef.current) return;
    lastParsedTextRef.current = trimmed;

    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      const payload = await analyzeIntakeWithAi(trimmed);
      if (!isActiveRef.current) return;
      const result = applyAiExtractionToJob(payload, currentJobRef.current);
      commitResult(result, source, 'ai');
    } catch (error) {
      if (!isActiveRef.current) return;
      const message = error instanceof Error ? error.message : String(error);
      lastParsedTextRef.current = '';
      setAnalysisError(`Intake analysis failed: ${message} Your job fields were not changed. Retry the analysis when the connection is ready.`);
    } finally {
      if (isActiveRef.current) setIsAnalyzing(false);
    }
  };

  // Large pastes are parsed the moment they land, so "copy, paste, done" is one step.
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData?.getData('text') ?? '';
    if (pasted.trim().length < AUTO_PARSE_MIN_CHARS) return;
    const target = e.currentTarget;
    if (pasteTimerRef.current !== null) window.clearTimeout(pasteTimerRef.current);
    pasteTimerRef.current = window.setTimeout(() => {
      pasteTimerRef.current = null;
      if (!isActiveRef.current) return;
      const value = target.value;
      if (value.trim() && value.trim() !== lastParsedTextRef.current) {
        void handleParse(value, 'paste');
      }
    }, 60);
  };

  const processFile = async (file: File) => {
    if (isExtractingPdf || isReadingFile || isAnalyzing || !isActiveRef.current) return;
    const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
    setFileError(null);
    setLastParseResult(null);
    setIntakeText('');
    setUploadedFileInfo({
      name: file.name,
      sizeKb: Math.round(file.size / 1024),
      isPdf,
    });

    if (isPdf) {
      try {
        setIsExtractingPdf(true);
        const arrayBuffer = await file.arrayBuffer();
        if (!isActiveRef.current) return;
        const extracted = await extractTextFromPdfBuffer(arrayBuffer);
        if (!isActiveRef.current) return;
        if (extracted && extracted.trim()) {
          setIntakeText(extracted);
          handleParse(extracted, 'file');
        } else {
          // If no direct text, put note and attempt metadata
          const fallbackNote = `[PDF Document: ${file.name} (${Math.round(file.size / 1024)} KB)]\nNote: This PDF did not yield standard selectable text (it may be a flattened image scan). Please verify the job fields below or paste the intake text directly.`;
          setIntakeText(fallbackNote);
          setFileError('This PDF has no selectable text. Paste the intake notes below or upload a text-based PDF.');
        }
      } catch (err) {
        if (!isActiveRef.current) return;
        console.error('Failed to extract text from PDF:', err);
        const errorNote = `[Error Reading PDF: ${file.name}]\nFailed to extract text. You can still paste the raw DASH notes directly below.`;
        setIntakeText(errorNote);
        setFileError('The PDF could not be read. Try another file or paste the intake notes below.');
      } finally {
        if (isActiveRef.current) setIsExtractingPdf(false);
      }
    } else {
      const reader = new FileReader();
      setIsReadingFile(true);
      fileReaderRef.current = reader;
      reader.onload = (event) => {
        if (!isActiveRef.current) return;
        setIsReadingFile(false);
        const content = event.target?.result as string;
        if (content) {
          setIntakeText(content);
          handleParse(content, 'file');
        } else {
          setFileError('This file is empty. Try another file or paste the intake notes below.');
        }
      };
      reader.onerror = () => {
        if (!isActiveRef.current) return;
        setIsReadingFile(false);
        setFileError('The file could not be read. Try another file or paste the intake notes below.');
      };
      reader.readAsText(file);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
    e.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (isExtractingPdf || isReadingFile || isAnalyzing) return;
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const provenanceBadge = (type: FieldProvenanceType) => {
    switch (type) {
      case 'EXTRACTED':
        return <span className="bg-blue-100 text-blue-700 font-bold px-1.5 py-0.5 rounded text-[10px]">EXTRACTED</span>;
      case 'CALCULATED':
        return <span className="bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.5 rounded text-[10px]">CALCULATED</span>;
      case 'FOUND':
        return <span className="bg-purple-100 text-purple-700 font-bold px-1.5 py-0.5 rounded text-[10px]">FOUND</span>;
      case 'DRAFTED':
        return <span className="bg-amber-100 text-amber-700 font-bold px-1.5 py-0.5 rounded text-[10px]">DRAFTED</span>;
      case 'UNRESOLVED':
        return <span className="bg-rose-100 text-rose-700 font-bold px-1.5 py-0.5 rounded text-[10px]">UNRESOLVED</span>;
    }
  };

  const isBusy = isExtractingPdf || isReadingFile || isAnalyzing;
  const readinessJob = currentJob ?? lastParseResult?.jobData;
  const missingJobFields = readinessJob ? getMissingJobFields(readinessJob) : [];
  const hasUnanalyzedText = Boolean(intakeText.trim() && intakeText.trim() !== lastParsedTextRef.current);
  const hasIntakeContent = Boolean(intakeText.trim() || uploadedFileInfo || lastParseResult || isBusy);
  const intakeStatus = isExtractingPdf
    ? 'Extracting PDF'
    : isReadingFile
    ? 'Reading file'
    : isAnalyzing
    ? 'Analyzing intake'
    : analysisError
    ? 'Analysis failed - retry intake'
    : fileError
    ? 'Needs intake text'
    : lastParseResult && !hasUnanalyzedText
    ? 'Ready to review'
    : intakeText.trim()
    ? 'Ready to analyze'
    : 'File uploaded';
  const StatusIcon = isBusy ? Loader2 : fileError || analysisError ? AlertTriangle : lastParseResult && !hasUnanalyzedText ? CheckCircle2 : FileText;

  if (!isExpanded) {
    if (!hasIntakeContent) return null;
    return (
      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="rounded-lg bg-slate-100 p-2 text-slate-600">
            <StatusIcon className={`h-5 w-5 ${isBusy ? 'animate-spin' : ''}`} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{uploadedFileInfo?.name || 'Pasted intake'}</p>
            <p className="text-xs text-slate-600" role="status" aria-live="polite">
              {intakeStatus}
              {lastParseResult && !isBusy && !hasUnanalyzedText && (
                <> · {lastParseResult.fieldsCount} fields extracted</>
              )}
            </p>
          </div>
        </div>
        <button type="button" onClick={onExpand} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
          Review intake <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6" aria-label="Job intake">
      <div className="flex items-start gap-3 border-b border-slate-100 pb-5">
        <div className="rounded-xl bg-red-50 p-2.5 text-red-600">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Bring in your job information</h3>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">
            Upload an intake file or paste DASH notes, carrier emails, and estimate details. AI intake analysis fills in the matching job fields for you.
          </p>
        </div>
      </div>

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`mt-5 rounded-xl border border-dashed p-4 transition sm:p-5 ${isDragging ? 'border-red-500 bg-red-50 ring-2 ring-red-500/20' : 'border-slate-300 bg-slate-50'}`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Upload className="h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-slate-800">Upload or drop an intake file</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">PDF, text, JSON, CSV, or log files · Analyzed automatically</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            Upload intake file
          </button>
          <input
            ref={fileInputRef}
            type="file"
            aria-label="Upload intake file"
            accept=".pdf,application/pdf,.txt,.json,.csv,.log"
            onChange={handleFileUpload}
            disabled={isBusy}
            className="hidden"
          />
        </div>
      </div>

      {uploadedFileInfo && (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-slate-200 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <FileText className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
            <span className="break-all font-medium text-slate-800">{uploadedFileInfo.name}</span>
            <span className="shrink-0 text-xs text-slate-500">{uploadedFileInfo.sizeKb} KB</span>
          </div>
          <span className={`flex shrink-0 items-center gap-1.5 text-xs font-medium ${fileError ? 'text-amber-700' : isBusy || hasUnanalyzedText ? 'text-slate-600' : 'text-emerald-700'}`} role="status" aria-live="polite">
            <StatusIcon className={`h-4 w-4 ${isBusy ? 'animate-spin' : ''}`} aria-hidden="true" />
            {intakeStatus}
          </span>
        </div>
      )}

      {fileError && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-900" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {fileError}
        </p>
      )}

      <div className="mt-5">
        <label htmlFor={intakeTextId} className="block text-sm font-semibold text-slate-800">Or paste intake notes</label>
        <p id={intakeHelpId} className="mt-1 mb-2 text-xs leading-relaxed text-slate-500">Pasted notes are analyzed automatically. You can also type or edit the notes, then select Analyze intake.</p>
        <textarea
          id={intakeTextId}
          aria-describedby={intakeHelpId}
          rows={7}
          value={intakeText}
          disabled={isBusy}
          onChange={(e) => {
            setIntakeText(e.target.value);
            setFileError(null);
          }}
          onPaste={handlePaste}
          placeholder="Paste DASH intake notes, a carrier assignment email, or an Xactimate recap here…"
          className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm leading-relaxed text-slate-800 transition placeholder:text-slate-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 disabled:bg-slate-50 disabled:text-slate-500"
        />
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-lg text-xs leading-relaxed text-slate-500">New information is merged into this job. Review the extracted values before creating your documents.</p>
          <button
            type="button"
            onClick={() => handleParse(intakeText)}
            disabled={!intakeText.trim() || isBusy || Boolean(fileError)}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
            {isAnalyzing ? 'Analyzing intake…' : 'Analyze intake'}
            {!isAnalyzing && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
        {isBusy && (
          <p className="mt-3 flex items-center gap-2 text-sm text-slate-600" role="status" aria-live="polite"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{intakeStatus}… You can keep working in another section.</p>
        )}
      </div>

      {analysisError && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{analysisError}</p>}
      {lastParseResult && !isBusy && !analysisError && (
        <div className="mt-6 border-t border-slate-200 pt-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            {hasUnanalyzedText ? 'Last intake analysis' : 'Job information updated'}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <span className="block text-xl font-semibold text-slate-900">{lastParseResult.fieldsCount}</span>
              <span className="text-xs text-slate-600">Fields extracted</span>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <span className="block text-xl font-semibold text-emerald-800">{lastParseResult.updatedCount}</span>
              <span className="text-xs text-emerald-700">Job values updated</span>
            </div>
          </div>

          {lastParseResult.aiError && (
            <p className="mt-3 flex items-start gap-2 text-sm leading-relaxed text-amber-800"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />AI analysis was unavailable. Built-in extraction was used; please review the job values.</p>
          )}

          {missingJobFields.length > 0 ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />Required information to confirm</p>
              <p className="mt-1 text-sm leading-relaxed text-amber-800">Add these details in Job Details before creating the production packet.</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {missingJobFields.map((field) => <li key={field.inputId} className="rounded-lg border border-amber-200 bg-white px-2.5 py-1 text-xs font-medium text-amber-900">{field.label}</li>)}
              </ul>
            </div>
          ) : (
            <p className="mt-4 text-sm text-emerald-700">Required intake fields are complete. Review the job details, then create your production packet.</p>
          )}

          <details className="group mt-4 rounded-xl border border-slate-200">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
              View extracted fields and analysis
              <ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="space-y-3 border-t border-slate-200 p-4">
              <p className="text-xs text-slate-500">{lastParseResult.mode === 'ai' ? 'AI intake analysis' : 'Built-in extraction'} · {lastParseResult.source === 'file' ? 'Uploaded file' : lastParseResult.source === 'paste' ? 'Pasted notes' : 'Intake notes'}</p>
              {lastParseResult.mode === 'ai' && lastParseResult.aiNotes && (
                <p className="rounded-lg bg-blue-50 p-3 text-sm leading-relaxed text-blue-900">{lastParseResult.aiNotes}</p>
              )}
              {lastParseResult.sections.map((section) => (
                <div key={section.section} className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-800">{section.label}</span>
                    <span className="text-xs text-slate-500">{section.fields.length} field{section.fields.length === 1 ? '' : 's'}</span>
                  </div>
                  <dl className="space-y-2">
                    {section.fields.map((field) => (
                      <div key={field.key} className={`rounded-lg px-3 py-2 text-xs ${field.changed ? 'bg-emerald-50' : 'bg-slate-50'}`}>
                        <dt className="flex flex-wrap items-center gap-2 font-semibold text-slate-700">{field.label}{provenanceBadge(field.source)}</dt>
                        <dd className="mt-1 break-words leading-relaxed text-slate-600">{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
              {lastParseResult.warnings.length > 0 && (
                <div className="space-y-2 rounded-lg bg-orange-50 p-3">
                  {lastParseResult.warnings.map((warning, index) => <p key={index} className="flex items-start gap-2 text-xs leading-relaxed text-orange-900"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{warning}</p>)}
                </div>
              )}
              <p className="border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500">Extracted: found in the intake. Calculated: computed from provided values. Found: a branch default. Drafted: suggested text to review.</p>
            </div>
          </details>
        </div>
      )}
    </section>
  );
};
