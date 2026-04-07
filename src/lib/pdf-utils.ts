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

      // Use pdfjs's built-in text joining — it handles word spacing correctly.
      // We only need to detect paragraph breaks from vertical gaps and indentation.
      const items = content.items.filter(
        (item): item is typeof item & { str: string; transform: number[]; hasEOL?: boolean } => 'str' in item
      );

      let minX = Infinity;
      for (const item of items) {
        if (item.str.trim()) minX = Math.min(minX, item.transform[4]);
      }

      const lines: { text: string; y: number; x: number; fontSize: number }[] = [];
      let currentLine = '';
      let lineY = 0;
      let lineX = 0;
      let lineFontSize = 12;

      for (let j = 0; j < items.length; j++) {
        const item = items[j];
        const y = item.transform[5];
        const x = item.transform[4];
        const fontSize = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 12;

        if (j === 0) {
          lineY = y;
          lineX = x;
          lineFontSize = fontSize;
        }

        const yDrop = lineY - y;
        const isNewLine = yDrop > fontSize * 0.5;

        if (isNewLine && currentLine) {
          lines.push({ text: currentLine, y: lineY, x: lineX, fontSize: lineFontSize });
          currentLine = '';
          lineY = y;
          lineX = x;
          lineFontSize = fontSize;
        }

        currentLine += item.str;

        // pdfjs hasEOL means end of line — don't add space, the next item starts a new line
        if (!item.hasEOL && j < items.length - 1) {
          // Check if next item is on the same line — if so, pdfjs already includes
          // proper spacing in the str values. No manual space insertion needed.
        }
      }
      if (currentLine) {
        lines.push({ text: currentLine, y: lineY, x: lineX, fontSize: lineFontSize });
      }

      // Join lines into paragraphs based on vertical gaps and indentation
      let pageText = '';
      for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        const prevLine = lines[li - 1];

        if (prevLine) {
          const gap = prevLine.y - line.y;
          const avgFontSize = (prevLine.fontSize + line.fontSize) / 2;
          const isLargeGap = gap > avgFontSize * 1.8;
          const isIndented = line.text.trim() && (line.x - minX) > avgFontSize * 1.5;

          if (isLargeGap || isIndented) {
            pageText += '\n\n';
          } else {
            pageText += ' ';
          }
        }

        pageText += line.text.trim();
      }

      fullTextContent += pageText + '\n\n';
    }

    // --- Post-processing to fix hyphenation and page breaks ---
    let text = fullTextContent.trim();

    // Fix spurious spaces within words from PDF character-level rendering
    // Merge single letter + space + lowercase continuation, but NOT standalone words like "a", "I"
    // Pattern: single consonant or uncommon-as-word letter, space, then lowercase letters
    // Exclude "a" and "I" which are valid standalone words
    text = text.replace(/\b([b-hj-zB-HJ-Z]) ([a-z]{2,})\b/g, '$1$2');
    // Also fix "o f" -> "of", "i n" -> "in", "i t" -> "it" etc (two single letters that form a word)
    text = text.replace(/\b([a-z]) ([a-z])\b/g, (match, a, b) => {
      const combined = a + b;
      const commonTwoLetter = ['of', 'in', 'it', 'is', 'on', 'or', 'an', 'at', 'to', 'we', 'be', 'do', 'go', 'he', 'if', 'me', 'my', 'no', 'so', 'up', 'us'];
      return commonTwoLetter.includes(combined) ? combined : match;
    });

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
