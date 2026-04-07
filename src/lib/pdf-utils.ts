import * as pdfjsLib from 'pdfjs-dist';

if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
}

/**
 * Extract text content from a PDF file with page markers.
 * Handles base64 data URI, File, Blob, blob URL, and regular URL inputs.
 * @returns Text content with [PAGE X] markers
 */
export const extractTextFromPdf = async (
  pdfData: string | File | Blob
): Promise<string> => {
  try {
    let documentSource: string | ArrayBuffer | { data: string } | { url: string } =
      pdfData as string;

    if (typeof pdfData === 'string' && pdfData.startsWith('data:application/pdf;base64,')) {
      const base64Part = pdfData.substring('data:application/pdf;base64,'.length);
      if (!base64Part) throw new Error('Invalid base64 data URI for PDF.');
      documentSource = { data: atob(base64Part) };
    } else if (typeof pdfData === 'string' && pdfData.startsWith('blob:')) {
      documentSource = pdfData;
    } else if (pdfData instanceof File || pdfData instanceof Blob) {
      documentSource = await pdfData.arrayBuffer();
    } else if (typeof pdfData === 'string') {
      documentSource = { url: pdfData };
    }

    const loadingTask = pdfjsLib.getDocument(documentSource);
    const pdf = await loadingTask.promise;

    let fullTextContent = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      fullTextContent += `[PAGE ${i}]\n`;

      const items = content.items.filter(
        (item): item is typeof item & { str: string; transform: number[] } => 'str' in item
      );

      let pageText = '';
      let prevY: number | null = null;
      let prevEndX = 0;
      let lineStartX: number | null = null;
      let minX = Infinity;

      // First pass: find the minimum x (left margin) to detect indentation
      for (const item of items) {
        const x = item.transform[4];
        if (item.str.trim()) minX = Math.min(minX, x);
      }

      for (let j = 0; j < items.length; j++) {
        const item = items[j];
        const str = item.str;
        const x = item.transform[4];
        const y = item.transform[5];
        const fontSize = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 12;

        if (prevY !== null) {
          const yDrop = prevY - y; // positive = moved down
          const isNewLine = yDrop > fontSize * 0.5;
          const isLargeGap = yDrop > fontSize * 1.8; // big vertical gap = paragraph break
          const isIndented = str.trim() && (x - minX) > fontSize * 1.5; // indented = new paragraph

          if (isLargeGap) {
            pageText += '\n\n';
            lineStartX = x;
          } else if (isNewLine) {
            if (isIndented) {
              pageText += '\n\n';
            } else {
              pageText += ' ';
            }
            lineStartX = x;
          } else {
            // Same line — add space if there's a gap between items
            const gap = x - prevEndX;
            if (gap > fontSize * 0.3 && j > 0) pageText += ' ';
          }
        } else {
          lineStartX = x;
        }

        pageText += str;
        prevY = y;
        // Estimate end x position: x + string width (approximate)
        prevEndX = x + str.length * fontSize * 0.5;
      }

      fullTextContent += pageText + '\n\n';
    }

    // --- Post-processing to fix hyphenation and page breaks ---
    let text = fullTextContent.trim();

    // Remove hyphenation at line breaks and page breaks (e.g., 'expec- tations', 'function- [PAGE 2] ality')
    // 1. Remove hyphen + space/newline + [PAGE ...] + space/newline
    text = text.replace(/-\s*\[PAGE \d+\]\s*/g, '');
    // 2. Remove hyphen + space/newline (within a page)
    text = text.replace(/-\s+/g, '');
    // 3. Remove extra spaces before/after page markers
    text = text.replace(/\s*\[PAGE (\d+)\]\s*/g, '\n[PAGE $1]\n');

    return text.replace(/^\s+/, '');
  } catch {
    return '';
  }
};

const pdfUtils = {
  extractTextFromPdf,
};

export default pdfUtils;
