// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { registerReactPdfWorker } from "@carbon/files/pdf/worker";
import { cn } from "@carbon/react";
import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { useResizeObserver } from "~/hooks/useResizeObserver";
import { type ClickedRun, groupLines, type PageClick } from "./previewClick";
// The text layer is what a click lands on; without its stylesheet its runs
// sit in normal flow instead of over the words they belong to.
import "react-pdf/dist/Page/TextLayer.css";

// Registered here, not in the client entry: this module is lazy, so the PDF
// engine stays out of every page that shows no PDF.
registerReactPdfWorker(pdfjs);

/** A run of text in pdf.js's text layer (not a marked-content wrapper). */
const RUN = ".textLayer span:not(.markedContent)";

function readPage(layer: Element, clicked: Element, file: string): PageClick {
  const elements = [...layer.querySelectorAll(RUN)];
  const { lines, places } = groupLines(
    elements.map((run) => {
      const box = run.getBoundingClientRect();
      return {
        text: run.textContent ?? "",
        left: box.left,
        right: box.right,
        top: box.top,
        height: box.height
      };
    })
  );
  const page = layer.getBoundingClientRect();
  return {
    file,
    lines,
    at: places[elements.indexOf(clicked)] as ClickedRun,
    top: (clicked.getBoundingClientRect().top - page.top) / page.height,
    pageNumber: Number(
      layer.closest("[data-page-number]")?.getAttribute("data-page-number") ?? 1
    )
  };
}

/**
 * The preview PDF drawn with pdf.js, so a click can tell which text it hit:
 * `onTextClick` gets the clicked page's text, line by line, and where in it
 * the click landed. A new file renders out of sight and replaces the shown one
 * once every page is drawn, so the page never blanks or loses its scroll.
 */
export default function PreviewPages({
  file,
  onTextClick,
  onDrawFailed,
  onShown,
  keepMark
}: {
  file: string;
  onDrawFailed: () => void;
  /** A new file has replaced the one on screen. */
  onShown: (file: string) => void;
  /** Whether the click landed on a text the panel can edit. */
  onTextClick: (click: PageClick) => boolean;
  /** The clicked run stays outlined only while the panel shows what it prints. */
  keepMark: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useResizeObserver(containerRef)?.contentRect.width;
  // Oldest first: the shown file, then the one being drawn.
  const [files, setFiles] = useState<string[]>([file]);
  const marked = useRef<Element | null>(null);

  const mark = (run: Element | null) => {
    marked.current?.removeAttribute("data-selected");
    run?.setAttribute("data-selected", "");
    marked.current = run;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `mark` only touches a ref.
  useEffect(() => {
    if (!keepMark) mark(null);
  }, [keepMark]);

  useEffect(() => {
    setFiles((current) =>
      current.includes(file) ? current : [current[0], file]
    );
  }, [file]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a shortcut to what the block list and the text picker reach by keyboard
    // biome-ignore lint/a11y/useKeyWithClickEvents: a shortcut to what the block list and the text picker reach by keyboard
    <div
      ref={containerRef}
      onClick={(e) => {
        const run = (e.target as HTMLElement).closest(RUN);
        const layer = run?.closest(".textLayer");
        if (!run || !layer) return;
        if (onTextClick(readPage(layer, run, files[0]))) mark(run);
      }}
      className={cn(
        // The scrollbar's space is always kept. Pages are drawn at this box's
        // width, so a scrollbar that comes and goes redraws them; a page about
        // as tall as the box then brings it back and removes it forever.
        "relative h-full overflow-x-auto overflow-y-scroll",
        "[&_.textLayer_span]:cursor-pointer [&_.textLayer_span:hover]:bg-blue-500/15",
        "[&_.textLayer_span[data-selected]]:bg-blue-500/15 [&_.textLayer_span[data-selected]]:outline-2 [&_.textLayer_span[data-selected]]:outline-blue-500"
      )}
    >
      {width
        ? files.map((f, index) => (
            <PdfPages
              key={f}
              file={f}
              width={width}
              hidden={index > 0}
              onReady={() => {
                setFiles((current) => current.slice(index));
                onShown(f);
              }}
              onFailed={onDrawFailed}
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
  onReady,
  onFailed
}: {
  file: string;
  width: number;
  hidden: boolean;
  onReady: () => void;
  onFailed: () => void;
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
        error={null}
        onLoadError={onFailed}
        onSourceError={onFailed}
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
            error={null}
            onRenderError={onFailed}
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
