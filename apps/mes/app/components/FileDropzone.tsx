// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { getCompanyPrivateBucket } from "@carbon/files";
import { isHeic, MediaUploader } from "@carbon/files/media";
import { Button, cn, toast } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useRef, useState, useSyncExternalStore } from "react";
import { useDropzone } from "react-dropzone";
import { LuCamera, LuCloudUpload } from "react-icons/lu";
import { useUser } from "~/hooks";

// A device with a touchscreen (tablet, phone) can open its camera from a file
// input. Desktop browsers ignore `capture` and would show a second file
// picker, so the camera button is offered only where touch is available.
const TOUCH_QUERY = "(any-pointer: coarse)";

const subscribeTouch = (onChange: () => void) => {
  const query = window.matchMedia(TOUCH_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

const readTouch = () => window.matchMedia(TOUCH_QUERY).matches;

interface FileDropzoneProps {
  onDrop: (acceptedFiles: File[]) => void;
}

const FileDropzone: React.FC<FileDropzoneProps> = ({ onDrop }) => {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const [isConverting, setIsConverting] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const hasTouch = useSyncExternalStore(subscribeTouch, readTouch, () => false);

  // HEIC is never stored — convert to JPEG before handing files to the caller.
  const onDropWithConversion = async (acceptedFiles: File[]) => {
    let files = acceptedFiles;
    if (carbon && files.some((file) => isHeic(file.name, file.type))) {
      const uploader = new MediaUploader(carbon, {
        bucket: getCompanyPrivateBucket(company.id),
        directory: `${company.id}/tmp`
      });
      setIsConverting(true);
      try {
        files = await uploader.prepareForUpload(files);
      } catch {
        toast.error(t`Failed to convert image`);
        return;
      } finally {
        setIsConverting(false);
      }
    }
    onDrop(files);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDropWithConversion,
    maxFiles: 1,
    multiple: false,
    disabled: isConverting
  });

  return (
    <div className="w-full">
      <div
        {...getRootProps()}
        className={cn(
          "mt-4 border-2 border-dashed rounded-md p-6 text-center hover:border-primary hover:bg-primary/10 w-full",
          isDragActive ? "border-primary bg-primary/10" : "border-muted",
          isConverting && "cursor-not-allowed opacity-60"
        )}
      >
        <input {...getInputProps()} />
        <LuCloudUpload className="mx-auto h-12 w-12 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          <Trans>Drag and drop a file here, or click to select a file</Trans>
        </p>
      </div>
      {hasTouch && (
        <>
          <Button
            variant="secondary"
            size="lg"
            leftIcon={<LuCamera />}
            isDisabled={isConverting}
            className="mt-2 w-full"
            onClick={() => cameraInputRef.current?.click()}
          >
            <Trans>Take Photo</Trans>
          </Button>
          {/* Opens the rear camera; the photo takes the same path as a picked file. */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(event) => {
              const photo = event.target.files?.[0];
              // Cleared so taking another photo fires a change again.
              event.target.value = "";
              if (photo) onDropWithConversion([photo]);
            }}
          />
        </>
      )}
    </div>
  );
};

export default FileDropzone;
