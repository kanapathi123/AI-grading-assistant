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
      // Smart join: avoid spaces inside words
      const items = content.items.map((item) => ('str' in item ? item.str : ''));
      let pageText = '';
      for (let j = 0; j < items.length; j++) {
        const curr = items[j];
        const prev = items[j - 1] || '';
        // If both prev and curr are alphanumeric, don't add a space
        if (j > 0 && /[a-zA-Z0-9]$/.test(prev) && /^[a-zA-Z0-9]/.test(curr)) {
          pageText += curr;
        } else {
          if (j > 0) pageText += ' ';
          pageText += curr;
        }
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

    return text;
  } catch {
    return '';
  }
};

const pdfUtils = {
  extractTextFromPdf,
};

export default pdfUtils;
