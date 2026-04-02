import { Skeleton } from "@carbon/react";
import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

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

export default function PdfViewer({ file }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>();

  return (
    <Document
      file={file}
      onLoadSuccess={({ numPages }) => setNumPages(numPages)}
      loading={<SkeletonDocument />}
    >
      <div className="overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent max-h-[calc(100dvh-91px)]">
        {Array.from(new Array(numPages), (_, index) => (
          <Page
            key={`page_${index + 1}`}
            pageNumber={index + 1}
            renderTextLayer={false}
            width={680}
            height={780}
          />
        ))}
      </div>
    </Document>
  );
}
