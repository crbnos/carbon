import {
  Button,
  ResizableHandle,
  ResizablePanel,
  Skeleton
} from "@carbon/react";
import { convertKbToString } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { lazy, Suspense } from "react";
import { LuDownload, LuX } from "react-icons/lu";
import { useNavigate } from "react-router";
import DocumentIcon from "~/components/DocumentIcon";
import { path } from "~/utils/path";
import type { Document as DocumentType } from "../../types";
import { useDocument } from "./useDocument";

const PdfViewer = lazy(() => import("./PdfViewer"));

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
  const { download } = useDocument();
  const objectPath = document.path ?? "";

  switch (document.type) {
    case "Image":
      return (
        <img
          src={path.to.file.preview(bucket, objectPath)}
          className="object-contain"
          width={"680"}
          alt="Preview"
        />
      );
    case "PDF":
      return (
        <Suspense fallback={<SkeletonDocument />}>
          <PdfViewer file={path.to.file.preview(bucket, objectPath)} />
        </Suspense>
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
            <Trans>Download</Trans>
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
            <Trans>Download</Trans>
          </Button>
        </div>
        <DocumentPreview bucket={bucket} document={document} />
      </ResizablePanel>
    </>
  );
};

export default DocumentView;
