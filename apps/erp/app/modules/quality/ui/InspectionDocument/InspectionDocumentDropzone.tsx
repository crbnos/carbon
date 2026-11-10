// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, toast } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useDropzone } from "react-dropzone";
import { LuFileUp, LuLoader } from "react-icons/lu";
import { UploadProgress } from "~/components/UploadProgress";
import type { ModelUploadProgress } from "~/hooks/useModelUpload";

const MODEL_EXTENSIONS = ["step", "stp"];

/** The kind of document a dropped file is, by its extension. */
function documentKindOf(file: File): "pdf" | "model" | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "pdf") return "pdf";
  if (MODEL_EXTENSIONS.includes(extension)) return "model";
  return null;
}

type InspectionDocumentDropzoneProps = {
  uploading: boolean;
  progress: ModelUploadProgress | null;
  disabled?: boolean;
  onPdf: (file: File) => void;
  onModel: (file: File) => void;
};

/**
 * The right sidebar of a plan with no drawing or model (below the table on a
 * narrow screen): drop (or pick) a PDF drawing to balloon, or a STEP model
 * whose PMI the plan can follow. Once the plan has either, the viewer takes
 * the top of the page and this goes away.
 */
export default function InspectionDocumentDropzone({
  uploading,
  progress,
  disabled,
  onPdf,
  onModel
}: InspectionDocumentDropzoneProps) {
  const { t } = useLingui();

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    disabled: disabled || uploading,
    multiple: false,
    accept: {
      "application/pdf": [".pdf"],
      "model/step": [".step", ".stp"],
      "application/octet-stream": [".step", ".stp"]
    },
    onDropAccepted: ([file]) => {
      const kind = file ? documentKindOf(file) : null;
      if (kind === "pdf") onPdf(file!);
      else if (kind === "model") onModel(file!);
      else toast.error(t`Drop a PDF drawing or a STEP model`);
    },
    onDropRejected: () => toast.error(t`Drop a PDF drawing or a STEP model`)
  });

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-card max-lg:w-full max-lg:border-l-0 max-lg:border-t">
      <div
        {...getRootProps()}
        className={cn(
          "flex flex-1 cursor-pointer flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground",
          isDragActive &&
            "bg-primary/5 text-foreground ring-2 ring-inset ring-primary",
          (disabled || uploading) && "cursor-default hover:bg-transparent"
        )}
      >
        <input {...getInputProps()} />
        {progress ? (
          <UploadProgress
            {...progress}
            label={t`Uploading model`}
            description={t`Uploading`}
          />
        ) : (
          <>
            {uploading ? (
              <LuLoader className="size-10 animate-spin opacity-40" />
            ) : (
              <LuFileUp className="size-10 opacity-40" />
            )}
            <p className="text-sm font-medium text-foreground">
              {uploading ? (
                <Trans>Uploading…</Trans>
              ) : (
                <Trans>Drop a drawing or model</Trans>
              )}
            </p>
            <p className="text-pretty text-xs">
              <Trans>
                A PDF drawing to balloon, or a STEP model. Click to choose a
                file.
              </Trans>
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
