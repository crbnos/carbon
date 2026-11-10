// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { registerReactPdfWorker } from "@carbon/files/pdf/worker";
import { Skeleton } from "@carbon/react";
import { useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { useResizeObserver } from "~/hooks/useResizeObserver";
// Without its stylesheet the annotation layer sits in normal flow under the
// canvas and adds a blank page-sized gap below every page.
import "react-pdf/dist/Page/AnnotationLayer.css";

// Registered here, not in the client entry: this module is lazy, so the PDF
// engine stays out of every page that shows no PDF.
registerReactPdfWorker(pdfjs);

function SkeletonDocument() {
  return (
    <div className="flex flex-col space-y-3 p-3">
      <Skeleton className="h-[380px] bg-muted w-full rounded-md" />
      <div className="space-y-2">
        <Skeleton className="h-4 bg-muted w-full rounded-md" />
        <Skeleton className="h-4 bg-muted w-full rounded-md" />
      </div>
    </div>
  );
}

type PdfViewerProps = {
  file: string;
};

// Pages fill the container up to a readable width. A react-pdf page box is a
// full-width white block, so a page narrower than its box left a white strip.
const MAX_PAGE_WIDTH = 1000;

export default function PdfViewer({ file }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>();
  const containerRef = useRef<HTMLDivElement>(null);
  const containerWidth = useResizeObserver(containerRef)?.contentRect.width;
  const pageWidth = Math.min(containerWidth || MAX_PAGE_WIDTH, MAX_PAGE_WIDTH);

  return (
    <div
      ref={containerRef}
      className="overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent max-h-[calc(100dvh-91px)]"
    >
      <Document
        file={file}
        onLoadSuccess={({ numPages }) => setNumPages(numPages)}
        loading={<SkeletonDocument />}
      >
        {Array.from(new Array(numPages), (_, index) => (
          <Page
            key={`page_${index + 1}`}
            pageNumber={index + 1}
            renderTextLayer={false}
            width={pageWidth}
            className="mx-auto w-fit"
          />
        ))}
      </Document>
    </div>
  );
}
