import {
  Button,
  ResizableHandle,
  ResizablePanel,
  Skeleton,
} from "@carbon/react";
import { convertKbToString } from "@carbon/utils";
import { useNavigate } from "@remix-run/react";
import { useState } from "react";
import { LuDownload, LuX } from "react-icons/lu";
import { Document, Page, pdfjs } from "react-pdf";
import DocumentIcon from "~/components/DocumentIcon";
import { path } from "~/utils/path";
import { type Document as DocumentType } from "../../types";
import { useDocument } from "./useDocument";

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

type DocumentPreviewProps = {
  bucket: string;
  document: DocumentType;
};

const DocumentPreview = ({ bucket, document }: DocumentPreviewProps) => {
  const [numPages, setNumPages] = useState<number>();

  function onDocumentLoadSuccess({ numPages }: { numPages: number }): void {
    setNumPages(numPages);
  }

  const { download } = useDocument();

  switch (document.type) {
    case "Image":
      return (
        <img
          src={path.to.file.previewFile(`${bucket}/${document.path}`)}
          className="object-contain"
          width={"680"}
          alt="Preview"
        />
      );
    case "PDF":
      return (
        <Document
          file={path.to.file.previewFile(`${bucket}/${document.path}`)}
          onLoadSuccess={onDocumentLoadSuccess}
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
    default:
      return (
        <div className="flex flex-1 border-t border-border flex-col items-center justify-start w-full h-full pt-24">
          <DocumentIcon className="w-36 h-36 mb-2" type={document.type!} />
          <p className="text-xl mb-1">{document.name}</p>
          <p className="text-muted-foreground mb-4">
            {convertKbToString(document.size ?? 0)}
          </p>
          <Button
            size="lg"
            leftIcon={<LuDownload />}
            onClick={() => download(document)}
          >
            Download
          </Button>
        </div>
      );
  }
};

const DocumentView = ({ bucket, document }: DocumentPreviewProps) => {
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.documents);
  const { download } = useDocument();
  return (
    <>
      <ResizableHandle withHandle />
      <ResizablePanel
        defaultSize={50}
        maxSize={70}
        minSize={25}
        className="bg-background"
      >
        <div className="flex items-center justify-between p-0.5">
          <Button isIcon variant={"ghost"} onClick={onClose}>
            <LuX className="w-4 h-4" />
          </Button>
          <span className="text-sm">{document.name}</span>
          <Button variant={"ghost"} onClick={() => download(document)}>
            <LuDownload className="w-4 h-4 mr-2" />
            Download
          </Button>
        </div>
        <DocumentPreview bucket={bucket} document={document} />
      </ResizablePanel>
    </>
  );
};

export default DocumentView;
