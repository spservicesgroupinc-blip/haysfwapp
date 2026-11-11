import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.js";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.js?url";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export default function PdfViewer({
  blob,
  page: requestedPage = 1,
  label = "PDF document",
}: {
  blob: Blob;
  page?: number;
  label?: string;
}) {
  const [document, setDocument] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(requestedPage);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(580);
  useEffect(() => {
    setPage(requestedPage);
  }, [requestedPage]);
  useEffect(() => {
    let active = true;
    let doc: pdfjs.PDFDocumentProxy | null = null;
    setDocument(null);
    setError("");
    setBusy(true);
    void blob
      .arrayBuffer()
      .then(
        (buffer) =>
          pdfjs.getDocument({
            data: new Uint8Array(buffer),
            isEvalSupported: false,
          }).promise,
      )
      .then(async (result) => {
        doc = result;
        if (active) setDocument(result);
        else await result.destroy();
      })
      .catch((e) => {
        if (active) {
          setError(e.message ?? "PDF preview could not load.");
          setBusy(false);
        }
      });
    return () => {
      active = false;
      if (doc) void doc.destroy();
    };
  }, [blob]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(180, entries[0].contentRect.width - 24)),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!document || !canvas.current) return;
    let active = true;
    let task: pdfjs.RenderTask | undefined;
    setBusy(true);
    setError("");
    void document
      .getPage(Math.max(1, Math.min(page, document.numPages)))
      .then((pdfPage) => {
        if (!active || !canvas.current) return;
        const initial = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min(width, 720) / initial.width;
        const viewport = pdfPage.getViewport({
          scale: scale * Math.min(window.devicePixelRatio || 1, 2),
        });
        canvas.current.width = viewport.width;
        canvas.current.height = viewport.height;
        canvas.current.style.width = `${initial.width * scale}px`;
        canvas.current.style.height = `${initial.height * scale}px`;
        task = pdfPage.render({
          canvasContext: canvas.current.getContext("2d")!,
          viewport,
        });
        return task.promise;
      })
      .then(() => {
        if (active) setBusy(false);
      })
      .catch((e) => {
        if (active && e.name !== "RenderingCancelledException") {
          setError(e.message);
          setBusy(false);
        }
      });
    return () => {
      active = false;
      task?.cancel();
    };
  }, [document, page, width]);
  return (
    <div className="pdf-viewer" ref={container}>
      <div className="pdf-toolbar">
        <span>
          <FileText size={15} />
          {label}
        </span>
        <div>
          <button
            className="icon-button"
            aria-label="Previous PDF page"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft size={17} />
          </button>
          <small>
            {page} / {document?.numPages ?? "…"}
          </small>
          <button
            className="icon-button"
            aria-label="Next PDF page"
            disabled={!document || page >= document.numPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
      {error ? (
        <div className="notice danger" role="alert">
          {error}
        </div>
      ) : null}
      <div className="pdf-canvas" aria-busy={busy}>
        {busy ? <span className="pdf-loading">Rendering page…</span> : null}
        <canvas ref={canvas} aria-label={`${label}, page ${page}`} />
      </div>
    </div>
  );
}
