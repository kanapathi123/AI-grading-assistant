'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Loader2, AlertCircle } from 'lucide-react';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

export interface PdfHighlight {
  text: string;
  criterionName: string;
}

interface PdfViewerProps {
  url: string | null;
  highlights?: PdfHighlight[];
}

const HIGHLIGHT_COLORS: Record<string, { bg: string; border: string }> = {};
const COLOR_PALETTE = [
  { bg: 'rgba(99,102,241,0.22)', border: '#6366F1' },
  { bg: 'rgba(16,185,129,0.22)', border: '#10B981' },
  { bg: 'rgba(245,158,11,0.22)', border: '#F59E0B' },
  { bg: 'rgba(239,68,68,0.22)', border: '#EF4444' },
  { bg: 'rgba(139,92,246,0.22)', border: '#8B5CF6' },
  { bg: 'rgba(6,182,212,0.22)', border: '#06B6D4' },
];

function getColorForCriterion(name: string): { bg: string; border: string } {
  if (!HIGHLIGHT_COLORS[name]) {
    const idx = Object.keys(HIGHLIGHT_COLORS).length % COLOR_PALETTE.length;
    HIGHLIGHT_COLORS[name] = COLOR_PALETTE[idx];
  }
  return HIGHLIGHT_COLORS[name];
}

function normalize(s: string): string {
  return s.replace(/[\s\u00A0]+/g, ' ').trim().toLowerCase();
}

/** Build sliding windows of N consecutive words from normalized text */
function buildWindows(text: string, windowSize: number): string[] {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length < windowSize) return [text];
  const windows: string[] = [];
  for (let i = 0; i <= words.length - windowSize; i++) {
    windows.push(words.slice(i, i + windowSize).join(' '));
  }
  return windows;
}

export default function PdfViewer({ url, highlights = [] }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);

  const onDocumentLoadSuccess = ({ numPages: total }: { numPages: number }) => {
    setNumPages(total);
    setPageNumber(1);
    setLoading(false);
    setError(false);
  };

  const onDocumentLoadError = () => {
    setLoading(false);
    setError(true);
  };

  const goToPrevPage = () => setPageNumber((prev) => Math.max(1, prev - 1));
  const goToNextPage = () => setPageNumber((prev) => Math.min(numPages, prev + 1));
  const zoomIn = () => setScale((prev) => Math.min(2.5, prev + 0.15));
  const zoomOut = () => setScale((prev) => Math.max(0.5, prev - 0.15));

  // Build normalized quote phrases for substring matching
  const phrases = useMemo(() => {
    if (!highlights.length) return null;
    return highlights.map(h => ({
      // Extract 3-word sliding windows from each quote for matching
      windows: buildWindows(normalize(h.text), 3),
      criterionName: h.criterionName,
    }));
  }, [highlights]);

  const customTextRenderer = useCallback(
    (textItem: { str: string }) => {
      if (!phrases) return textItem.str;

      const str = textItem.str;
      const normStr = normalize(str);
      if (!normStr || normStr.length < 12) return str;

      // Check if this text chunk matches a 3-word window from any quote
      for (const phrase of phrases) {
        for (const window of phrase.windows) {
          // Both the chunk and window must have meaningful length overlap
          if (window.length < 10) continue;
          if (normStr.includes(window)) {
            const color = getColorForCriterion(phrase.criterionName);
            return `<mark class="pdf-hl" style="background:${color.bg};--hl-color:${color.border};" data-criteria="${phrase.criterionName}">${str}</mark>`;
          }
          // Only match if the chunk is a substantial substring of the window (>60% of chunk)
          if (window.includes(normStr) && normStr.length > window.length * 0.4) {
            const color = getColorForCriterion(phrase.criterionName);
            return `<mark class="pdf-hl" style="background:${color.bg};--hl-color:${color.border};" data-criteria="${phrase.criterionName}">${str}</mark>`;
          }
        }
      }

      return str;
    },
    [phrases],
  );

  if (!url) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-gray-200 bg-gray-50 p-8 dark:border-slate-700 dark:bg-slate-800/50">
        <p className="text-sm text-gray-400 dark:text-slate-500">No PDF loaded</p>
      </div>
    );
  }

  // Build legend from unique criteria
  const legendItems = useMemo(() => {
    const seen = new Set<string>();
    return highlights
      .filter(h => { if (seen.has(h.criterionName)) return false; seen.add(h.criterionName); return true; })
      .map(h => ({ name: h.criterionName, color: getColorForCriterion(h.criterionName) }));
  }, [highlights]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center gap-1">
          <button
            onClick={goToPrevPage}
            disabled={pageNumber <= 1}
            className="cursor-pointer rounded-md p-1.5 text-gray-600 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[100px] text-center text-sm text-[#1E1B4B] dark:text-[#E2E8F0]">
            Page {pageNumber} of {numPages}
          </span>
          <button
            onClick={goToNextPage}
            disabled={pageNumber >= numPages}
            className="cursor-pointer rounded-md p-1.5 text-gray-600 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={zoomOut}
            disabled={scale <= 0.5}
            className="cursor-pointer rounded-md p-1.5 text-gray-600 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="min-w-[50px] text-center text-sm text-[#1E1B4B] dark:text-[#E2E8F0]">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={zoomIn}
            disabled={scale >= 2.5}
            className="cursor-pointer rounded-md p-1.5 text-gray-600 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Highlight legend */}
      {legendItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50/50 px-3 py-1.5 dark:border-slate-700 dark:bg-slate-800/50">
          <span className="text-xs font-medium text-gray-400 dark:text-slate-500">Evidence:</span>
          {legendItems.map(item => (
            <span
              key={item.name}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ backgroundColor: item.color.bg, color: item.color.border, borderBottom: `2px solid ${item.color.border}` }}
            >
              {item.name}
            </span>
          ))}
        </div>
      )}

      {/* PDF Content */}
      <div className="flex-1 overflow-auto bg-gray-100 p-4 dark:bg-slate-800/30">
        {loading && !error && (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#6366F1]" />
            <span className="ml-2 text-sm text-gray-500 dark:text-slate-400">Loading PDF...</span>
          </div>
        )}

        {error && (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <AlertCircle className="h-8 w-8 text-[#EF4444]" />
            <p className="text-sm text-[#EF4444]">Failed to load PDF</p>
          </div>
        )}

        <Document
          file={url}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={null}
        >
          {!error && (
            <div className="flex justify-center">
              <Page
                key={`${pageNumber}-hl${highlights.length}`}
                pageNumber={pageNumber}
                scale={scale}
                className="shadow-lg"
                loading={null}
                customTextRenderer={phrases ? customTextRenderer : undefined}
              />
            </div>
          )}
        </Document>
      </div>
    </div>
  );
}
