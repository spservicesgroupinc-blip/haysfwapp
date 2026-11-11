import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.js?url';

// Initialize worker configuration safely
if (typeof window !== 'undefined') {
  try {
    (pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  } catch (err) {
    console.warn('Failed to assign pdfWorkerUrl, will fall back to main-thread fake worker:', err);
  }
}

/**
 * Extracts text and form data from an ArrayBuffer of a PDF file.
 * Handles both fillable AcroForm PDFs and scanned/text-layer PDFs.
 * Employs line-aware coordinate grouping so fields and columns do not concatenate.
 */
export async function extractTextFromPdfBuffer(arrayBuffer: ArrayBuffer): Promise<string> {
  const extractedLines: string[] = [];

  // 1. Try extracting AcroForm fields and document metadata with pdf-lib
  try {
    const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
    
    // Check metadata
    const title = pdfDoc.getTitle();
    const author = pdfDoc.getAuthor();
    const subject = pdfDoc.getSubject();
    if (title) extractedLines.push(`Document Title: ${title}`);
    if (author) extractedLines.push(`Author: ${author}`);
    if (subject) extractedLines.push(`Subject: ${subject}`);

    // Check AcroForm fields
    try {
      const form = pdfDoc.getForm();
      const fields = form.getFields();
      if (fields && fields.length > 0) {
        extractedLines.push('--- AcroForm Field Values ---');
        for (const field of fields) {
          const name = field.getName();
          let val = '';
          try {
            if ('getText' in field && typeof (field as any).getText === 'function') {
              val = (field as any).getText() || '';
            } else if ('isChecked' in field && typeof (field as any).isChecked === 'function') {
              val = (field as any).isChecked() ? 'Yes' : 'No';
            } else if ('getSelected' in field && typeof (field as any).getSelected === 'function') {
              const selected = (field as any).getSelected();
              val = Array.isArray(selected) ? selected.join(', ') : String(selected || '');
            }
          } catch {}
          if (name && val) {
            extractedLines.push(`${name}: ${val}`);
          }
        }
      }
    } catch {
      // not an acroform, proceed to text layer
    }
  } catch (e) {
    console.warn('pdf-lib metadata/form inspection note:', e);
  }

  // 2. Extract text layer with line-aware coordinate grouping using pdfjs-dist
  try {
    const loadPdfDoc = async (useWorker: boolean) => {
      if (!useWorker && typeof window !== 'undefined') {
        (pdfjsLib as any).GlobalWorkerOptions.workerSrc = '';
      }
      const loadingTask = (pdfjsLib as any).getDocument({
        data: new Uint8Array(arrayBuffer),
        useSystemFonts: true,
        isEvalSupported: false,
      });
      return await loadingTask.promise;
    };

    let pdfDoc: any = null;
    try {
      pdfDoc = await loadPdfDoc(true);
    } catch (workerErr) {
      console.warn('Worker-based PDF load failed, falling back to fake worker:', workerErr);
      pdfDoc = await loadPdfDoc(false);
    }

    if (pdfDoc) {
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        
        let lastY: number | null = null;
        const pageLines: string[] = [];
        let currentLine = '';

        for (const item of textContent.items) {
          if (!item || !('str' in item)) continue;
          const str = (item.str || '').trim();
          if (!str) continue;

          const y = item.transform ? Math.round(item.transform[5]) : null;

          // If Y coordinate has shifted by more than 4 points, start a new line
          if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) {
            if (currentLine.trim()) {
              pageLines.push(currentLine.trim());
            }
            currentLine = str;
          } else {
            currentLine += (currentLine ? '    ' : '') + str;
          }
          if (y !== null) lastY = y;
        }

        if (currentLine.trim()) {
          pageLines.push(currentLine.trim());
        }

        if (pageLines.length > 0) {
          extractedLines.push(`--- Page ${i} ---\n` + pageLines.join('\n'));
        }
      }
    }
  } catch (e) {
    console.warn('pdfjs-dist extraction note:', e);
  }

  // 3. Fallback: If no lines extracted, search for raw text stream objects in buffer
  if (extractedLines.length === 0) {
    try {
      const uint8 = new Uint8Array(arrayBuffer);
      const textDecoder = new TextDecoder('latin1');
      const rawPdfString = textDecoder.decode(uint8);

      // Search for text inside parentheses before Tj/TJ operators
      const tjMatches = rawPdfString.matchAll(/\(([^\(\)\\]*(?:\\.[^\(\)\\]*)*)\)\s*(?:Tj|'|")/g);
      const rawTokens: string[] = [];
      for (const m of tjMatches) {
        if (m[1] && m[1].length > 1) {
          rawTokens.push(m[1].replace(/\\([()\\])/g, '$1'));
        }
      }
      if (rawTokens.length > 0) {
        extractedLines.push('--- Raw Stream Text ---\n' + rawTokens.join(' '));
      }
    } catch (streamErr) {
      console.warn('Raw stream extraction fallback note:', streamErr);
    }
  }

  return extractedLines.join('\n');
}
