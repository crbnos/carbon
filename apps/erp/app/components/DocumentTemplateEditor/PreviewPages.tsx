// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { registerReactPdfWorker } from "@carbon/files/pdf/worker";
import { cn } from "@carbon/react";
import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { useResizeObserver } from "~/hooks/useResizeObserver";
import type { ClickedRun } from "./previewText";
// The text layer is what a click lands on; without its stylesheet its runs
// sit in normal flow instead of over the words they belong to.
import "react-pdf/dist/Page/TextLayer.css";

// Registered here, not in the client entry: this module is lazy, so the PDF
// engine stays out of every page that shows no PDF.
registerReactPdfWorker(pdfjs);

/** A run of text in pdf.js's text layer (not a marked-content wrapper). */
const RUN = ".textLayer span:not(.markedContent)";

/**
 * The runs of a page's text layer, a line at a time: a run starts a new line
 * when it sits lower or higher than the one before it by half its height.
 */
function readLines(layer: Element, clicked: Element) {
  const lines: string[][] = [];
  let at = { line: 0, run: 0 };
  let lastTop: number | null = null;
  for (const run of layer.querySelectorAll(RUN)) {
    // A blank run (the space between two words) has no height of its own.
    const blank = !run.textContent?.trim();
    const box = run.getBoundingClientRect();
    if (
      lastTop === null ||
      (!blank && Math.abs(box.top - lastTop) > box.height / 2)
    ) {
      lines.push([]);
    }
    if (!blank) lastTop = box.top;
    const line = lines[lines.length - 1];
    if (run === clicked) at = { line: lines.length - 1, run: line.length };
    line.push(run.textContent ?? "");
  }
  return { lines, at };
}

/**
 * The preview PDF drawn with pdf.js, so a click can tell which text it hit:
 * `onTextClick` gets the clicked page's text, line by line, and where in it
 * the click landed. A new file renders out of sight and replaces the shown one
 * once every page is drawn, so the page never blanks or loses its scroll.
 */
export default function PreviewPages({
  file,
  onTextClick
}: {
  file: string;
  onTextClick: (lines: string[][], clicked: ClickedRun) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useResizeObserver(containerRef)?.contentRect.width;
  // Oldest first: the shown file, then the one being drawn.
  const [files, setFiles] = useState<string[]>([file]);

  useEffect(() => {
    setFiles((current) =>
      current.includes(file) ? current : [current[0], file]
    );
  }, [file]);

  return (
    <div
      ref={containerRef}
      onClick={(e) => {
        const run = (e.target as HTMLElement).closest(RUN);
        const layer = run?.closest(".textLayer");
        if (!run || !layer) return;
        const { lines, at } = readLines(layer, run);
        onTextClick(lines, at);
      }}
      className={cn(
        "relative h-full overflow-auto",
        "[&_.textLayer_span]:cursor-pointer [&_.textLayer_span:hover]:bg-yellow-300/40"
      )}
    >
      {width
        ? files.map((f, index) => (
            <PdfPages
              key={f}
              file={f}
              width={width}
              hidden={index > 0}
              onReady={() => setFiles((current) => current.slice(index))}
            />
          ))
        : null}
    </div>
  );
}

function PdfPages({
  file,
  width,
  hidden,
  onReady
}: {
  file: string;
  width: number;
  hidden: boolean;
  onReady: () => void;
}) {
  const [numPages, setNumPages] = useState(0);
  const drawn = useRef(0);

  return (
    <div
      aria-hidden={hidden}
      className={cn(hidden && "invisible absolute inset-x-0 top-0")}
    >
      <Document
        file={file}
        loading={null}
        onLoadSuccess={(pdf) => {
          drawn.current = 0;
          setNumPages(pdf.numPages);
        }}
      >
        {Array.from({ length: numPages }, (_, index) => (
          <Page
            key={index}
            pageNumber={index + 1}
            width={width}
            renderAnnotationLayer={false}
            loading={null}
            className="mb-4 bg-white shadow-sm last:mb-0"
            onRenderSuccess={() => {
              drawn.current += 1;
              if (hidden && drawn.current === numPages) onReady();
            }}
          />
        ))}
      </Document>
    </div>
  );
}
