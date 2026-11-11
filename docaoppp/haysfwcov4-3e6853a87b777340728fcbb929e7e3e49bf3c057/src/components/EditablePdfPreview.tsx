import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.js";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.js?url";
import {
  CUSTOMER_DOCUMENT_FIELDS,
  type DocumentFieldKey,
} from "../services/customerDocumentFields";
import type { DocumentFieldSpan } from "../services/customerDocumentPdf";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export default function EditablePdfPreview({
  bytes,
  spans,
  disabled,
  renderField,
}: {
  bytes: Uint8Array;
  spans: DocumentFieldSpan[];
  disabled: boolean;
  renderField: (key: DocumentFieldKey) => ReactNode;
}) {
  const [document, setDocument] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(580);
  const [error, setError] = useState("");
  const [rendering, setRendering] = useState(true);
  const [active, setActive] = useState<DocumentFieldKey | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scale = Math.min(width, 900) / 612;
  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(180, entries[0].contentRect.width - 24)),
    );
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    const task = pdfjs.getDocument({
      data: bytes.slice(),
      isEvalSupported: false,
    });
    setDocument(null);
    setRendering(true);
    setError("");
    void task.promise
      .then((pdf) => {
        if (cancelled) return;
        setDocument(pdf);
        setPage((current) => Math.min(current, pdf.numPages));
      })
      .catch((problem) => {
        if (!cancelled) {
          setError(problem.message);
          setRendering(false);
        }
      });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [bytes]);
  useEffect(() => {
    if (!document || !canvas.current) return;
    let cancelled = false;
    let task: pdfjs.RenderTask | undefined;
    setRendering(true);
    void document
      .getPage(page)
      .then((pdfPage) => {
        if (cancelled || !canvas.current) return;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = pdfPage.getViewport({ scale: scale * ratio });
        canvas.current.width = viewport.width;
        canvas.current.height = viewport.height;
        canvas.current.style.width = `${612 * scale}px`;
        canvas.current.style.height = `${792 * scale}px`;
        task = pdfPage.render({
          canvasContext: canvas.current.getContext("2d")!,
          viewport,
        });
        return task.promise;
      })
      .then(() => {
        if (!cancelled) setRendering(false);
      })
      .catch((problem) => {
        if (!cancelled && problem.name !== "RenderingCancelledException") {
          setError(problem.message);
          setRendering(false);
        }
      });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [document, page, scale]);
  const selected = spans.find(
    (span) => span.page === page && span.key === active,
  );
  return (
    <div ref={container} className="document-preview">
      <div className="document-page-controls">
        <button
          className="icon-button"
          aria-label="Previous PDF page"
          disabled={page <= 1}
          onClick={() => {
            setActive(null);
            setPage(page - 1);
          }}
        >
          <ChevronLeft size={18} />
        </button>
        <span>
          Page {page} of {document?.numPages ?? "…"}
        </span>
        <button
          className="icon-button"
          aria-label="Next PDF page"
          disabled={!document || page >= document.numPages}
          onClick={() => {
            setActive(null);
            setPage(page + 1);
          }}
        >
          <ChevronRight size={18} />
        </button>
      </div>
      {error ? (
        <p role="alert" className="notice danger">
          {error}
        </p>
      ) : null}
      {rendering ? <p role="status">Rendering PDF…</p> : null}
      <div
        className="document-canvas"
        style={{ width: 612 * scale, height: 792 * scale }}
        aria-busy={rendering}
      >
        <canvas ref={canvas} aria-label={`Change order PDF, page ${page}`} />
        {!disabled && !rendering && !error
          ? spans
              .filter((span) => span.page === page)
              .map((span) => {
                const label = CUSTOMER_DOCUMENT_FIELDS.find(
                  (field) => field.key === span.key,
                )?.label;
                return (
                  <button
                    key={`${span.key}-${span.x}-${span.y}`}
                    className="document-field-target"
                    type="button"
                    aria-label={`Edit ${label} on PDF`}
                    onClick={() => setActive(span.key)}
                    style={{
                      left: span.x * scale,
                      top: span.y * scale,
                      width: span.width * scale,
                      height: Math.max(18, span.height * scale),
                    }}
                  />
                );
              })
          : null}
        {!disabled && selected ? (
          <div
            className="document-inline-editor"
            role="group"
            aria-label="Inline PDF field editor"
            style={{
              left: Math.max(
                0,
                Math.min(
                  selected.x * scale,
                  612 * scale - Math.min(280, 612 * scale),
                ),
              ),
              top: Math.max(0, Math.min(selected.y * scale, 792 * scale - 260)),
            }}
          >
            <button
              className="icon-button"
              aria-label="Close field editor"
              onClick={() => setActive(null)}
            >
              <X size={16} />
            </button>
            {renderField(selected.key)}
            <button className="button small" onClick={() => setActive(null)}>
              Done editing field
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
