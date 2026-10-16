// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { safeStorageFileName, storage } from "@carbon/files";
import { useAction } from "@carbon/query";
import { File as FileButton, HStack, Skeleton, toast } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import type { ChangeEvent } from "react";
import { lazy, Suspense, useRef, useState } from "react";
import { LuFileText, LuUpload } from "react-icons/lu";
import { FileDropzone } from "~/components";
import { useUser } from "~/hooks";
import type { action } from "~/routes/x+/training+/update";
import { getPrivateUrl, path } from "~/utils/path";
import { trainingGuideKeyPrefix } from "../../resources.models";

const PdfViewer = lazy(
  () => import("~/modules/documents/ui/Documents/PdfViewer")
);

export function TrainingGuideViewer({ guidePath }: { guidePath: string }) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border border-border bg-background">
      <Suspense fallback={<Skeleton className="h-120 w-full" />}>
        <PdfViewer file={getPrivateUrl(guidePath)} />
      </Suspense>
    </div>
  );
}

// The PDF side of a training's content: upload, replace and view the guide.
const TrainingGuide = ({
  trainingId,
  guidePath,
  canEdit
}: {
  trainingId: string;
  guidePath: string | null;
  canEdit: boolean;
}) => {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const [isUploading, setIsUploading] = useState(false);

  // The file is stored before the training points at it. If the update is
  // refused (the training is no longer Draft), remove the new file.
  const uploadedPath = useRef<string | null>(null);
  const fetcher = useAction<typeof action>({
    onSuccess: () => {
      uploadedPath.current = null;
    },
    onError: (data) => {
      if (data?.error) toast.error(data.error.message);
      const path = uploadedPath.current;
      uploadedPath.current = null;
      if (path && carbon) {
        storage(carbon).company(company.id).remove([path]);
      }
    }
  });
  const isBusy = isUploading || fetcher.state !== "idle";

  const upload = async (file: File | undefined) => {
    if (!file || !carbon) return;

    const name = safeStorageFileName(file.name) ?? "guide.pdf";
    const fileName = name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`;

    setIsUploading(true);
    const key = `${trainingGuideKeyPrefix(company.id, trainingId)}${nanoid()}/${fileName}`;
    const result = await storage(carbon).company(company.id).upload(key, file);
    setIsUploading(false);

    if (result.error) {
      toast.error(t`Failed to upload PDF`);
      return;
    }

    uploadedPath.current = result.data.path;
    const formData = new FormData();
    formData.append("ids", trainingId);
    formData.append("field", "guidePath");
    formData.append("value", result.data.path);
    fetcher.submit(formData, {
      method: "post",
      action: path.to.bulkUpdateTraining
    });
  };

  if (!guidePath) {
    return canEdit ? (
      <FileDropzone
        onDrop={(files) => upload(files[0])}
        accept={{ "application/pdf": [".pdf"] }}
        multiple={false}
        disabled={isBusy}
        className="mt-0"
      />
    ) : (
      <p className="text-sm text-muted-foreground">
        <Trans>No PDF uploaded</Trans>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 w-full">
      <HStack className="w-full justify-between">
        <HStack spacing={2} className="text-sm min-w-0">
          <LuFileText className="shrink-0 text-muted-foreground" />
          <span className="truncate">{guidePath.split("/").pop()}</span>
        </HStack>
        <FileButton
          accept="application/pdf"
          variant="secondary"
          leftIcon={<LuUpload />}
          isDisabled={!canEdit || isBusy}
          onChange={async (e: ChangeEvent<HTMLInputElement>) => {
            await upload(e.target.files?.[0]);
          }}
        >
          <Trans>Replace</Trans>
        </FileButton>
      </HStack>
      <TrainingGuideViewer guidePath={guidePath} />
    </div>
  );
};

export default TrainingGuide;
