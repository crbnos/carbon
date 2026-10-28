// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { getCompanyPrivateBucket } from "@carbon/files";
import { prepareImageUpload } from "@carbon/files/media";
import { getLogger } from "@carbon/logger";
import { useAction } from "@carbon/query";
import {
  Button,
  cn,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast
} from "@carbon/react";
import { SIGNATURES_BUCKET } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { DragEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { LuImageUp, LuPenLine, LuX } from "react-icons/lu";
import type { Account } from "../types";
import type { SignaturePadHandle } from "./SignaturePad";
import SignaturePad from "./SignaturePad";

const logger = getLogger("erp", "signatureform");

/** Uploads are scaled to this height; the PDF prints them at most 40pt high. */
const SIGNATURE_HEIGHT = 200;

export type SignatureFormProps = {
  user: Account;
  /** A short-lived link to the current signature, from the profile loader. */
  signatureUrl: string | null;
  /** The account profile action that saves `signaturePath`. */
  action: string;
  /** The company whose private bucket stages an upload while it is resized. */
  companyId: string;
};

export default function SignatureForm({
  user,
  signatureUrl,
  action,
  companyId
}: SignatureFormProps) {
  const { t } = useLingui();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const removal = useAction({
    onSuccess: () => toast.success(t`Removed signature`)
  });

  const remove = () => {
    const formData = new FormData();
    formData.append("intent", "signature");
    formData.append("path", "");
    removal.submit(formData, { method: "post", action });
  };

  return (
    <>
      {signatureUrl ? (
        <div className="flex items-center gap-4 rounded-lg border border-border p-2 pr-3">
          <div className="relative flex h-24 flex-1 items-center justify-center overflow-hidden rounded-md bg-white px-6">
            <img
              src={signatureUrl}
              alt={t`Your signature`}
              className="relative max-h-16 max-w-full object-contain mix-blend-multiply"
            />
            <div
              aria-hidden
              className="absolute inset-x-5 bottom-4 flex items-end gap-1.5"
            >
              <LuX className="size-3 shrink-0 text-neutral-400" />
              <span className="flex-1 border-b border-dashed border-neutral-300" />
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-1.5">
            <Button variant="secondary" onClick={() => setIsDialogOpen(true)}>
              <Trans>Change</Trans>
            </Button>
            <Button
              variant="ghost"
              isLoading={removal.state !== "idle"}
              isDisabled={removal.state !== "idle"}
              onClick={remove}
            >
              <Trans>Remove</Trans>
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsDialogOpen(true)}
          className="group flex h-24 w-full items-center justify-center gap-3 rounded-lg border border-dashed border-border text-left transition-[background-color,border-color,transform] duration-150 ease-out hover:border-foreground/25 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
        >
          <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors duration-150 group-hover:text-foreground">
            <LuPenLine className="size-4" />
          </span>
          <span className="flex flex-col">
            <span className="text-sm font-medium">
              <Trans>Add your signature</Trans>
            </span>
            <span className="text-xs text-muted-foreground">
              <Trans>Draw it, or upload an image of it.</Trans>
            </span>
          </span>
        </button>
      )}
      {isDialogOpen && (
        <SignatureDialog
          user={user}
          action={action}
          companyId={companyId}
          onClose={() => setIsDialogOpen(false)}
        />
      )}
    </>
  );
}

type Source = "draw" | "upload";

function SignatureDialog({
  user,
  action,
  companyId,
  onClose
}: Omit<SignatureFormProps, "signatureUrl"> & { onClose: () => void }) {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const pad = useRef<SignaturePadHandle>(null);
  const [source, setSource] = useState<Source>("draw");
  const [hasInk, setHasInk] = useState(false);
  const [uploaded, setUploaded] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fetcher = useAction({
    onSuccess: () => {
      toast.success(t`Saved signature`);
      onClose();
    }
  });
  const isSaving = isUploading || fetcher.state !== "idle";
  const canSave = source === "draw" ? hasInk : !!uploaded;

  // A new file every time: an approval keeps pointing at the file that was on
  // file when it was approved, so a file is never overwritten.
  const save = async () => {
    if (!carbon) return;
    const file = source === "draw" ? await pad.current?.toPng() : uploaded;
    if (!file) return;
    // From the type, not the name: a `.JPG` name would fail the server's
    // lowercase path check after the upload succeeded.
    const extension = file.type === "image/jpeg" ? "jpg" : "png";
    setIsUploading(true);
    try {
      const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
      const upload = await carbon.storage
        .from(SIGNATURES_BUCKET)
        .upload(path, file, { contentType: file.type });
      if (upload.error) {
        logger.error("Failed to upload signature", { error: upload.error });
        toast.error(t`Failed to upload signature`);
        return;
      }
      const formData = new FormData();
      formData.append("intent", "signature");
      formData.append("path", path);
      fetcher.submit(formData, { method: "post", action });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !isSaving) onClose();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Your signature</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>Printed on the purchase orders you approve.</Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <Tabs
            value={source}
            onValueChange={(value) => setSource(value as Source)}
          >
            <TabsList className="mb-3">
              <TabsTrigger value="draw">
                <Trans>Draw</Trans>
              </TabsTrigger>
              <TabsTrigger value="upload">
                <Trans>Upload</Trans>
              </TabsTrigger>
            </TabsList>
            {/* Both panes stay mounted so a drawing survives a look at Upload. */}
            <TabsContent
              value="draw"
              forceMount
              className="data-[state=inactive]:hidden"
            >
              <SignaturePad ref={pad} onChange={setHasInk} />
            </TabsContent>
            <TabsContent
              value="upload"
              forceMount
              className="data-[state=inactive]:hidden"
            >
              <SignatureUpload
                companyId={companyId}
                file={uploaded}
                onChange={setUploaded}
              />
            </TabsContent>
          </Tabs>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose} isDisabled={isSaving}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            isDisabled={!canSave || isSaving}
            isLoading={isSaving}
            onClick={save}
          >
            <Trans>Save signature</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function SignatureUpload({
  companyId,
  file,
  onChange
}: {
  companyId: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const input = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const accept = async (selected: File | undefined) => {
    if (!selected || !carbon) return;
    if (!/^image\/(png|jpeg)$/.test(selected.type)) {
      toast.error(t`Choose a PNG or JPG image`);
      return;
    }
    setIsProcessing(true);
    try {
      onChange(
        await prepareImageUpload(carbon, {
          bucket: getCompanyPrivateBucket(companyId),
          directory: `${companyId}/tmp`,
          file: selected,
          height: SIGNATURE_HEIGHT
        })
      );
    } catch (error) {
      logger.error("Failed to process signature image", { error });
      toast.error(
        error instanceof Error ? error.message : t`Failed to process image`
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const drop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsDragging(false);
    accept(e.dataTransfer.files[0]);
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        hidden
        onChange={(e) => {
          accept(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={drop}
        className={cn(
          "relative flex h-48 w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border transition-[background-color,border-color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          preview
            ? "border-neutral-200 bg-white"
            : "border-dashed border-border hover:bg-muted/50",
          isDragging && "border-solid border-primary bg-primary/5"
        )}
      >
        {isProcessing ? (
          <Spinner className="size-5" />
        ) : preview ? (
          <>
            <img
              src={preview}
              alt={t`Uploaded signature`}
              className="max-h-28 max-w-[85%] object-contain mix-blend-multiply"
            />
            <span className="absolute bottom-2 text-xs text-neutral-500">
              <Trans>Click or drop to replace</Trans>
            </span>
          </>
        ) : (
          <>
            <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <LuImageUp className="size-4" />
            </span>
            <span className="text-sm font-medium">
              <Trans>Drop an image of your signature</Trans>
            </span>
            <span className="text-xs text-muted-foreground">
              <Trans>PNG or JPG, dark ink on a plain background</Trans>
            </span>
          </>
        )}
      </button>
    </>
  );
}
