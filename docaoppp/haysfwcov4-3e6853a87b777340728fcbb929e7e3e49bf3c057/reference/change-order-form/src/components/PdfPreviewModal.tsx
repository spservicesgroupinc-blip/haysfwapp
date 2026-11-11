import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.js?url';
import {
  X,
  FileDown,
  Printer,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  AlertTriangle,
  RotateCw,
  Pencil,
  List,
  CloudUpload,
  Check,
} from 'lucide-react';
import type { PdfFieldSpan } from '../services/pdfService';
import type { PdfEditableField, PdfFieldKind } from '../services/pdfFieldSchema';
import type { RestorationJobData } from '../types/jobData';

// Configure worker safely
if (typeof window !== 'undefined') {
  try {
    (pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  } catch {
    (pdfjsLib as any).GlobalWorkerOptions.workerSrc = '';
  }
}

interface PdfPreviewModalProps {
  isOpen: boolean;
  title: string;
  pdfBytes: Uint8Array | null;
  isLoading: boolean;
  isRegenerating?: boolean;
  onClose: () => void;
  onDownload: () => void;
  jobData?: RestorationJobData | null;
  editableFields?: PdfEditableField[];
  spans?: PdfFieldSpan[];
  onFieldChange?: (field: string, value: string) => void;
  onSaveToDrive?: () => void;
  isDriveLoading?: boolean;
  driveSuccessLink?: string | null;
}

/**
 * Dot-path lookup ('section.field') into the job record, stringified for
 * editing. Numbers (incl. currency) pass through String() unchanged, so the
 * raw numeric value is what the user sees and edits.
 */
function lookupJobValue(
  data: RestorationJobData | null | undefined,
  key: string
): string {
  if (!data) return '';
  let current: any = data;
  for (const segment of key.split('.')) {
    if (current == null) return '';
    current = current[segment];
  }
  if (current == null) return '';
  return String(current);
}

function findField(
  fields: PdfEditableField[] | undefined,
  key: string
): PdfEditableField | undefined {
  return fields?.find((f) => f.key === key);
}

/**
 * Kind-driven editing widget. 'boolean' / 'yesNoPending' / 'select' render
 * option buttons that commit immediately on click. Single-line inputs commit
 * on Enter or blur; the multiline textarea commits on blur (Enter inserts a
 * newline, Ctrl/Cmd+Enter commits). Esc cancels and reverts to the prefilled
 * value.
 */
interface FieldWidgetProps {
  kind: PdfFieldKind;
  prefill: string;
  options?: string[];
  autoFocus?: boolean;
  className?: string;
  editorStyle?: React.CSSProperties;
  onCommit: (value: string) => void;
  onCancel?: () => void;
}

const FieldWidget: React.FC<FieldWidgetProps> = ({
  kind,
  prefill,
  options,
  autoFocus,
  className,
  editorStyle,
  onCommit,
  onCancel,
}) => {
  const [value, setValue] = useState(prefill);
  const [lastCommitted, setLastCommitted] = useState<string | null>(null);

  const commit = (v: string) => {
    if (lastCommitted === v) return; // guard Enter -> blur double-commit
    setLastCommitted(v);
    onCommit(v);
  };

  const cancel = () => {
    setValue(prefill);
    setLastCommitted(null);
    onCancel?.();
  };

  if (kind === 'boolean' || kind === 'yesNoPending' || kind === 'select') {
    const opts =
      kind === 'boolean'
        ? ['Yes', 'No']
        : kind === 'yesNoPending'
          ? ['Yes', 'No', 'Pending']
          : (options ?? []);
    return (
      <div
        className="flex flex-wrap gap-1 bg-white p-1 rounded-md shadow-xl ring-2 ring-red-600"
        style={editorStyle}
      >
        {opts.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => commit(opt)}
            className="px-2 py-0.5 rounded bg-slate-800 text-white text-xs font-semibold hover:bg-red-600 transition"
          >
            {opt}
          </button>
        ))}
      </div>
    );
  }

  if (kind === 'multiline') {
    const fontSize =
      typeof editorStyle?.fontSize === 'number' ? editorStyle.fontSize : 13;
    return (
      <textarea
        value={value}
        rows={3}
        autoFocus={autoFocus}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => commit(value.trimEnd())}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            commit(value.trimEnd());
          }
        }}
        className={className}
        style={{
          ...editorStyle,
          minHeight: Math.max(fontSize * 1.35 * 3, 40),
          resize: 'vertical',
        }}
      />
    );
  }

  return (
    <input
      type="text"
      value={value}
      autoFocus={autoFocus}
      inputMode={kind === 'currency' || kind === 'int' ? 'decimal' : undefined}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => commit(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit(value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      }}
      className={className}
      style={editorStyle}
    />
  );
};

/**
 * Inline editor positioned over a field span on the canvas. Composite fields
 * (field.parts) render a small popover with one labeled input per part; each
 * part commits independently and the popover stays open so several parts can
 * be edited in one visit.
 */
interface InlineSpanEditorProps {
  span: PdfFieldSpan;
  scale: number;
  field?: PdfEditableField;
  jobData?: RestorationJobData | null;
  onFieldChange?: (field: string, value: string) => void;
  onClose: () => void;
}

const InlineSpanEditor: React.FC<InlineSpanEditorProps> = ({
  span,
  scale,
  field,
  jobData,
  onFieldChange,
  onClose,
}) => {
  const pageWidth = 612 * scale;
  const editorWidth = Math.min(pageWidth - 4, Math.max(span.width * scale, field?.parts?.length ? 240 : 140));
  const editorLeft = Math.max(2, Math.min(span.x * scale, pageWidth - editorWidth - 2));
  const minimumFontSize = window.matchMedia('(max-width: 640px)').matches ? 16 : 0;
  if (field?.parts && field.parts.length > 0) {
    return (
      <div
        className="absolute z-20 bg-white rounded-lg shadow-2xl ring-2 ring-red-600 p-2.5 flex flex-col gap-2"
        style={{
          left: editorLeft,
          top: span.y * scale,
          width: editorWidth,
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 truncate">
            {field.label}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-0.5 text-slate-400 hover:text-slate-600 transition"
            title="Close editor"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        {field.parts.map((part, idx) => (
          <div key={part.field} className="flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold text-slate-500">
              {part.label}
            </span>
            <FieldWidget
              kind={part.kind}
              prefill={lookupJobValue(jobData, part.field)}
              autoFocus={idx === 0}
              className="w-full bg-white border border-slate-300 rounded px-1.5 py-1 text-sm text-[#1A1A1A] outline-none focus:border-red-600 focus:ring-2 focus:ring-red-600/40"
              editorStyle={{ fontFamily: 'Helvetica, Arial, sans-serif', fontSize: Math.max(13, minimumFontSize) }}
              onCommit={(v) => onFieldChange?.(part.field, v)}
            />
          </div>
        ))}
      </div>
    );
  }

  const kind: PdfFieldKind = field?.kind ?? 'text';
  const fontSize = Math.max(span.size * scale, minimumFontSize);
  return (
    <div
      className="absolute z-20"
      style={{
        left: editorLeft,
        top: span.y * scale,
        width: editorWidth,
        fontFamily: 'Helvetica, Arial, sans-serif',
        fontSize,
        fontWeight: span.bold ? 700 : 400,
      }}
    >
      <FieldWidget
        kind={kind}
        prefill={lookupJobValue(jobData, span.key)}
        options={field?.options}
        autoFocus
        className="w-full bg-white text-[#1A1A1A] px-1.5 py-0.5 rounded-sm ring-2 ring-red-600 shadow-2xl outline-none"
        editorStyle={{ fontSize, fontWeight: span.bold ? 700 : 400 }}
        onCommit={(v) => {
          onFieldChange?.(span.key, v);
          onClose();
        }}
        onCancel={onClose}
      />
    </div>
  );
};

export const PdfPreviewModal: React.FC<PdfPreviewModalProps> = ({
  isOpen,
  title,
  pdfBytes,
  isLoading,
  isRegenerating = false,
  onClose,
  onDownload,
  jobData = null,
  editableFields = [],
  spans = [],
  onFieldChange,
  onSaveToDrive,
  isDriveLoading = false,
  driveSuccessLink = null,
}) => {
  const [numPages, setNumPages] = useState<number>(0);
  const [docVersion, setDocVersion] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.25);
  const [fitToWidth, setFitToWidth] = useState(true);
  const [viewerWidth, setViewerWidth] = useState(0);
  const [renderingError, setRenderingError] = useState<string | null>(null);
  const [isPageRendering, setIsPageRendering] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'canvas' | 'native'>('canvas');

  // Edit-mode state (click-to-edit)
  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [fieldsDrawerOpen, setFieldsDrawerOpen] = useState<boolean>(false);
  const [editingSpan, setEditingSpan] = useState<PdfFieldSpan | null>(null);
  const [drawerInlineKey, setDrawerInlineKey] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const pdfDocRef = useRef<any>(null);
  const renderTaskRef = useRef<any>(null);

  // Measure the actual viewer so opening and rotating a phone both fit the page.
  useEffect(() => {
    if (!isOpen || !viewerRef.current) return;
    setFitToWidth(true);
    const observer = new ResizeObserver(([entry]) => {
      setViewerWidth(entry.contentRect.width);
    });
    observer.observe(viewerRef.current);
    return () => observer.disconnect();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !fitToWidth || !viewerWidth || !pdfDocRef.current) return;
    let cancelled = false;
    void pdfDocRef.current.getPage(currentPage).then((page: any) => {
      if (!cancelled) {
        setScale(Math.min(1.25, Math.max(1, viewerWidth - 4) / page.getViewport({ scale: 1 }).width));
      }
    });
    return () => { cancelled = true; };
  }, [isOpen, fitToWidth, viewerWidth, currentPage, docVersion]);

  // Reset state when modal opens or closes or new bytes arrive
  useEffect(() => {
    if (!isOpen) {
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {}
      }
      pdfDocRef.current = null;
      setNumPages(0);
      setCurrentPage(1);
      setRenderingError(null);
      setIsEditMode(false);
      setFieldsDrawerOpen(false);
      setEditingSpan(null);
      setDrawerInlineKey(null);
      return;
    }
  }, [isOpen]);

  // Editing UI only exists in canvas view mode
  useEffect(() => {
    if (viewMode !== 'canvas') {
      setIsEditMode(false);
      setFieldsDrawerOpen(false);
      setEditingSpan(null);
      setDrawerInlineKey(null);
    }
  }, [viewMode]);

  // Close any open inline editor when the page changes
  useEffect(() => {
    setEditingSpan(null);
  }, [currentPage]);

  // Load PDF Document via PDF.js with fallback
  useEffect(() => {
    if (!isOpen || !pdfBytes || isLoading) return;

    let isMounted = true;
    setRenderingError(null);
    setCurrentPage(1);

    const loadDoc = async () => {
      try {
        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch {}
        }

        const uint8Data = new Uint8Array(pdfBytes);

        let doc: any = null;
        try {
          const loadingTask = (pdfjsLib as any).getDocument({
            data: uint8Data,
            useSystemFonts: true,
            isEvalSupported: false,
          });
          doc = await loadingTask.promise;
        } catch (workerErr) {
          console.warn('Primary worker load failed, retrying with fake worker on main thread:', workerErr);
          if (typeof window !== 'undefined') {
            (pdfjsLib as any).GlobalWorkerOptions.workerSrc = '';
          }
          const fallbackTask = (pdfjsLib as any).getDocument({
            data: uint8Data,
            useSystemFonts: true,
            isEvalSupported: false,
          });
          doc = await fallbackTask.promise;
        }

        if (!isMounted) return;

        pdfDocRef.current = doc;
        setNumPages(doc.numPages);
        // Bump so the canvas render effect re-runs even when the page count
        // is unchanged (live regeneration after an edit).
        setDocVersion((v) => v + 1);
      } catch (err: any) {
        console.error('PDF.js failed to load document for preview:', err);
        if (isMounted) {
          setRenderingError(err.message || 'Failed to initialize PDF renderer');
          // If canvas fails, switch to native fallback
          setViewMode('native');
        }
      }
    };

    loadDoc();

    return () => {
      isMounted = false;
    };
  }, [isOpen, pdfBytes, isLoading]);

  // Render individual page onto canvas
  useEffect(() => {
    if (!isOpen || !pdfDocRef.current || viewMode !== 'canvas') return;

    let isMounted = true;

    const renderPage = async (pageNumber: number) => {
      try {
        setIsPageRendering(true);
        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch {}
        }

        const page = await pdfDocRef.current.getPage(pageNumber);
        if (!isMounted || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;

        const viewport = page.getViewport({ scale });

        // Handle high DPI screens for crisp typography
        const outputScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const transform = outputScale !== 1
          ? [outputScale, 0, 0, outputScale, 0, 0]
          : undefined;

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
          transform: transform,
        };

        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;

        await renderTask.promise;
        if (isMounted) {
          setIsPageRendering(false);
        }
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          console.error('Error rendering page to canvas:', err);
          if (isMounted) {
            setIsPageRendering(false);
          }
        }
      }
    };

    renderPage(currentPage);

    return () => {
      isMounted = false;
    };
  }, [isOpen, currentPage, scale, numPages, viewMode, docVersion]);

  // Object URL for native object/iframe fallback
  const blobUrl = React.useMemo(() => {
    if (!pdfBytes) return null;
    const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
    return URL.createObjectURL(blob);
  }, [pdfBytes]);

  useEffect(() => {
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [blobUrl]);

  // Latest span rect for the open editor — the parent resends spans after each
  // regeneration, so the editor tracks the freshly drawn value position.
  const liveSpan = useMemo(() => {
    if (!editingSpan) return null;
    const latest = spans.find(
      (s) => s.key === editingSpan.key && s.page === editingSpan.page
    );
    return latest ?? editingSpan;
  }, [editingSpan, spans]);

  // Group schema fields by `group` for the Fields drawer section headers.
  const fieldGroups = useMemo(() => {
    const map = new Map<string, PdfEditableField[]>();
    for (const f of editableFields) {
      const list = map.get(f.group) ?? [];
      list.push(f);
      map.set(f.group, list);
    }
    return Array.from(map.entries());
  }, [editableFields]);

  if (!isOpen) return null;

  const handlePrint = () => {
    if (!blobUrl) return;
    const printWindow = window.open(blobUrl, '_blank');
    if (printWindow) {
      printWindow.focus();
    } else {
      // In case popups blocked, print through hidden iframe
      let iframe = document.getElementById('pdf-print-hidden-iframe') as HTMLIFrameElement;
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'pdf-print-hidden-iframe';
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        document.body.appendChild(iframe);
      }
      iframe.src = blobUrl;
      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {}
      };
    }
  };

  const canEdit =
    editableFields.length > 0 &&
    viewMode === 'canvas' &&
    !renderingError &&
    !isLoading &&
    numPages > 0;

  const pageSpans = spans.filter((s) => s.page === currentPage);

  // PDF points -> CSS px for overlay targets / inline editor. Pages are 612pt
  // US Letter; canvas.style.width equals the rendered viewport width.
  const canvasClientWidth = canvasRef.current?.clientWidth ?? 0;
  const viewScale = canvasClientWidth > 0 ? canvasClientWidth / 612 : 1;

  const openSpanEditor = (span: PdfFieldSpan) => {
    if (isRegenerating) return;
    setFieldsDrawerOpen(false);
    setDrawerInlineKey(null);
    setEditingSpan(span);
  };

  const handleDrawerRowClick = (field: PdfEditableField) => {
    const matching = spans.find(
      (s) => s.key === field.key && s.page === currentPage
    );
    if (matching) {
      openSpanEditor(matching);
    } else {
      setDrawerInlineKey(field.key);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-200">
      <div className="relative bg-slate-900 rounded-2xl w-full max-w-5xl h-[calc(100dvh-1rem)] sm:h-[92dvh] flex flex-col shadow-2xl border border-slate-700 overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-2 px-4 py-3 bg-slate-800 border-b border-slate-700 text-white select-none">
          <div className="flex items-center space-x-2.5 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0"></span>
            <h3 className="font-bold text-sm sm:text-base truncate max-w-[40vw] sm:max-w-md lg:max-w-xl">
              {title}
            </h3>
            {numPages > 0 && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-700 text-slate-300 hidden md:inline">
                {numPages} {numPages === 1 ? 'Page' : 'Pages'}
              </span>
            )}
          </div>

          <div className="flex items-center flex-wrap gap-2 shrink-0">
            {/* Edit Mode Toggle */}
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setIsEditMode((v) => !v);
                  setFieldsDrawerOpen(false);
                  setEditingSpan(null);
                }}
                className={`inline-flex items-center px-2.5 py-1.5 text-xs font-semibold rounded-lg transition ${
                  isEditMode
                    ? 'bg-red-600 hover:bg-red-500 text-white shadow-sm'
                    : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                }`}
                title={isEditMode ? 'Finish editing' : 'Edit fields directly on the PDF'}
              >
                <Pencil className="w-3.5 h-3.5 mr-1" />
                <span className="hidden sm:inline">{isEditMode ? 'Done' : 'Edit'}</span>
              </button>
            )}

            {/* Fields Drawer Toggle */}
            {canEdit && (
              <button
                type="button"
                onClick={() => setFieldsDrawerOpen((v) => !v)}
                className={`inline-flex items-center px-2.5 py-1.5 text-xs font-semibold rounded-lg transition ${
                  fieldsDrawerOpen
                    ? 'bg-red-600 hover:bg-red-500 text-white shadow-sm'
                    : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                }`}
                title="Show all editable fields"
              >
                <List className="w-3.5 h-3.5 mr-1" />
                <span className="hidden sm:inline">Fields</span>
              </button>
            )}

            {/* View Mode Switcher (hidden while editing) */}
            {!isEditMode && (
              <div className="hidden sm:flex items-center bg-slate-900/60 p-0.5 rounded-lg border border-slate-700 text-xs mr-1">
                <button
                  type="button"
                  onClick={() => setViewMode('canvas')}
                  className={`px-2 py-1 rounded font-medium transition ${
                    viewMode === 'canvas'
                      ? 'bg-red-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Canvas
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('native')}
                  className={`px-2 py-1 rounded font-medium transition ${
                    viewMode === 'native'
                      ? 'bg-red-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Browser PDF
                </button>
              </div>
            )}

            {/* Save to Drive */}
            {onSaveToDrive && (
              <button
                type="button"
                onClick={onSaveToDrive}
                disabled={isDriveLoading}
                className="inline-flex items-center px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
                title="Save PDF to Google Drive"
              >
                {isDriveLoading ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                ) : (
                  <CloudUpload className="w-3.5 h-3.5 mr-1" />
                )}
                <span className="hidden sm:inline">Drive</span>
              </button>
            )}

            <button
              onClick={handlePrint}
              type="button"
              className="inline-flex items-center px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 transition"
              title="Print document"
            >
              <Printer className="w-3.5 h-3.5 mr-1" />
              <span className="hidden sm:inline">Print</span>
            </button>

            <button
              onClick={onDownload}
              type="button"
              className="inline-flex items-center px-3 py-1.5 text-xs font-bold rounded-lg bg-red-600 hover:bg-red-500 text-white transition shadow-sm"
              title="Download PDF"
            >
              <FileDown className="w-3.5 h-3.5 mr-1.5" />
              Download
            </button>

            <button
              onClick={onClose}
              type="button"
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700 transition"
              title="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Drive success status bar */}
        {driveSuccessLink && (
          <div className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-950/60 border-b border-slate-800 text-xs text-emerald-300 select-none">
            <Check className="w-3.5 h-3.5 shrink-0" />
            <span>Saved to Drive —</span>
            <a
              href={driveSuccessLink}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold underline hover:text-white transition"
            >
              open file
            </a>
          </div>
        )}

        {/* Canvas Toolbar Controls (Page nav, Zoom) */}
        {viewMode === 'canvas' && !isLoading && !renderingError && numPages > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-slate-850/90 border-b border-slate-800 text-xs text-slate-300 select-none">
            {/* Page Navigation */}
            <div className="flex items-center space-x-1.5">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1 || isPageRendering}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40 transition"
                title="Previous Page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="font-mono text-xs px-2">
                Page <span className="text-white font-bold">{currentPage}</span> of{' '}
                <span className="text-white font-bold">{numPages}</span>
              </span>

              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
                disabled={currentPage >= numPages || isPageRendering}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40 transition"
                title="Next Page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              {isPageRendering && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-red-500 ml-2" />
              )}
            </div>

            {/* Zoom Controls */}
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => { setFitToWidth(false); setScale((s) => Math.max(0.25, Number((s - 0.2).toFixed(2)))); }}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>

              <span className="font-mono text-xs w-12 text-center text-slate-300">
                {Math.round(scale * 100)}%
              </span>

              <button
                type="button"
                onClick={() => { setFitToWidth(false); setScale((s) => Math.min(2.5, Number((s + 0.2).toFixed(2)))); }}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => setFitToWidth(true)}
                className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300 transition"
                title="Fit page to screen"
              >
                Fit
              </button>
            </div>
          </div>
        )}

        {/* Modal Body / Viewer */}
        <div className="flex-1 relative overflow-hidden">
          <div ref={viewerRef} className="h-full bg-slate-950 relative overflow-auto p-2 sm:p-4">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center text-slate-400 space-y-3">
                <Loader2 className="w-9 h-9 animate-spin text-red-500" />
                <p className="text-sm font-medium">Generating high-resolution PDF document...</p>
                <p className="text-xs text-slate-500">Compiling vectors, branding, and legal clauses</p>
              </div>
            ) : viewMode === 'canvas' && !renderingError ? (
              <div className="flex flex-col items-center justify-start w-max min-w-full min-h-full py-2">
                <div className="relative">
                  <div className="shadow-2xl rounded-sm overflow-hidden bg-white border border-slate-700/80 transition-all">
                    <canvas ref={canvasRef} className="block mx-auto" />
                  </div>

                  {/* Click-to-edit overlay targets for the current page */}
                  {isEditMode &&
                    pageSpans.map((span) => {
                      const field = findField(editableFields, span.key);
                      const inert = editingSpan != null || isRegenerating;
                      return (
                        <div
                          key={`${span.key}-${span.page}-${span.x.toFixed(2)}-${span.y.toFixed(2)}`}
                          role="button"
                          aria-label={field?.label ?? span.key}
                          onClick={() => openSpanEditor(span)}
                          className={`absolute z-10 cursor-text group/span ${inert ? 'pointer-events-none' : ''}`}
                          style={{
                            left: span.x * viewScale,
                            top: span.y * viewScale,
                            width: span.width * viewScale,
                            height: span.height * viewScale,
                          }}
                        >
                          <div className="absolute inset-[-2px] rounded-sm border border-red-600/70 bg-red-600/10 opacity-0 group-hover/span:opacity-100 transition pointer-events-none" />
                          {field?.label && (
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 rounded bg-slate-900 text-white text-[10px] font-medium whitespace-nowrap opacity-0 group-hover/span:opacity-100 transition pointer-events-none">
                              {field.label}
                            </div>
                          )}
                        </div>
                      );
                    })}

                  {/* Inline editor over the clicked span */}
                  {liveSpan && (
                    <InlineSpanEditor
                      key={`${liveSpan.key}-${liveSpan.page}`}
                      span={liveSpan}
                      scale={viewScale}
                      field={findField(editableFields, liveSpan.key)}
                      jobData={jobData}
                      onFieldChange={onFieldChange}
                      onClose={() => setEditingSpan(null)}
                    />
                  )}

                  {/* Regeneration overlay */}
                  {isRegenerating && (
                    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center rounded-sm bg-slate-950/60 backdrop-blur-[1px]">
                      <Loader2 className="w-8 h-8 animate-spin text-red-500" />
                      <p className="mt-2 text-xs font-medium text-white">Updating PDF…</p>
                    </div>
                  )}
                </div>

                {/* Bottom Quick Page Jump for multi-page docs */}
                {numPages > 1 && (
                  <div className="mt-4 flex items-center gap-1.5 bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-full text-xs shadow-md">
                    {Array.from({ length: numPages }).map((_, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setCurrentPage(idx + 1)}
                        className={`w-7 h-7 rounded-full text-xs font-mono font-bold transition ${
                          currentPage === idx + 1
                            ? 'bg-red-600 text-white shadow-sm'
                            : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
                        }`}
                      >
                        {idx + 1}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : blobUrl ? (
              /* Native iframe / object fallback */
              <div className="w-full h-full flex flex-col items-center justify-center">
                <object
                  data={`${blobUrl}#toolbar=1&navpanes=0`}
                  type="application/pdf"
                  className="w-full h-full border-0 bg-white rounded-lg shadow-inner"
                >
                  <iframe
                    src={blobUrl}
                    className="w-full h-full border-0 bg-white rounded-lg"
                    title="PDF Preview"
                  >
                    <div className="p-8 text-center text-slate-400">
                      <p className="text-sm">Your browser does not support embedded PDF frames.</p>
                      <button
                        onClick={onDownload}
                        className="mt-3 px-4 py-2 rounded-xl bg-red-600 text-white font-bold text-xs"
                      >
                        Download PDF Document
                      </button>
                    </div>
                  </iframe>
                </object>
              </div>
            ) : (
              <div className="text-slate-400 text-sm flex flex-col items-center gap-2">
                <AlertTriangle className="w-6 h-6 text-amber-500" />
                <span>No document bytes available for preview.</span>
              </div>
            )}
          </div>

          {/* Fields Drawer */}
          {fieldsDrawerOpen && viewMode === 'canvas' && (
            <div className="absolute inset-y-0 right-0 w-72 bg-slate-900 border-l border-slate-700 z-30 flex flex-col shadow-2xl">
              <div className="flex items-center justify-between px-3 py-2 bg-slate-800 border-b border-slate-700">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-200">
                  Fields
                </span>
                <button
                  type="button"
                  onClick={() => setFieldsDrawerOpen(false)}
                  className="p-0.5 text-slate-400 hover:text-white transition"
                  title="Close fields panel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto py-1">
                {fieldGroups.map(([groupName, fields]) => (
                  <div key={groupName}>
                    <div className="px-3 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-red-500">
                      {groupName}
                    </div>
                    {fields.map((field) => (
                      <div key={field.key}>
                        {drawerInlineKey === field.key ? (
                          <div className="px-3 py-1.5 bg-slate-800/70">
                            <span className="block text-xs font-medium text-white mb-1 truncate">
                              {field.label}
                            </span>
                            <FieldWidget
                              kind={field.kind}
                              prefill={lookupJobValue(jobData, field.key)}
                              options={field.options}
                              autoFocus
                              className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-white outline-none focus:border-red-500 focus:ring-2 focus:ring-red-600/40"
                              onCommit={(v) => {
                                onFieldChange?.(field.key, v);
                                setDrawerInlineKey(null);
                              }}
                              onCancel={() => setDrawerInlineKey(null)}
                            />
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleDrawerRowClick(field)}
                            className="w-full text-left px-3 py-1.5 hover:bg-slate-800 transition"
                          >
                            <span className="block text-xs text-slate-200 truncate">
                              {field.label}
                            </span>
                            <span className="block text-[10px] text-slate-500 truncate">
                              {lookupJobValue(jobData, field.key) || '—'}
                            </span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
