// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { getCompanyPrivateBucket, storage } from "@carbon/files";
import {
  IMAGE_UPLOAD_MIME_TYPES,
  isHeic,
  prepareImageUpload
} from "@carbon/files/media";
import { getLogger } from "@carbon/logger";
import {
  Button,
  cn,
  HStack,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  toastError
} from "@carbon/react";
import { requireAffected } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { LuRefreshCw, LuUpload } from "react-icons/lu";
import { useUser } from "~/hooks";
import { regenerateModelThumbnail } from "~/utils/model-thumbnail";
import { getPrivateUrl } from "~/utils/path";

const logger = getLogger("erp", "itemthumnailupload");
export function ItemThumbnailUpload({
  path,
  itemId,
  modelId,
  isReadOnly = false
}: {
  path?: string | null;
  itemId: string;
  modelId?: string | null;
  isReadOnly?: boolean;
}) {
  const { t } = useLingui();
  const { company } = useUser();
  const { carbon } = useCarbon();

  const [thumbnailPath, setThumbnailPath] = useState<string | null>(() => {
    if (path) {
      return getPrivateUrl(path);
    }
    return null;
  });

  useEffect(() => {
    setThumbnailPath(path ? getPrivateUrl(path) : null);
  }, [path]);

  const onFileRemove = useCallback(async () => {
    if (!carbon) {
      toast.error(t`Carbon client not found`);
      return;
    }

    setThumbnailPath(null);

    const itemResult = await requireAffected(
      carbon
        .from("item")
        .update({
          thumbnailPath: null
        })
        .eq("id", itemId)
        .select("id")
    );

    if (itemResult.error) {
      toastError(t`Failed to remove thumbnail`, itemResult.error);
      return;
    }

    if (modelId) {
      const modelResult = await carbon
        .from("modelUpload")
        .update({
          thumbnailPath: null
        })
        .eq("id", modelId);

      if (modelResult.error) {
        toastError(t`Failed to remove model thumbnail`, modelResult.error);
        return;
      }
    }

    toast.success(t`Thumbnail removed`);
  }, [carbon, itemId, modelId, t]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [isRegenerating, setIsRegenerating] = useState(false);
  const onRegenerate = useCallback(async () => {
    if (!modelId || !carbon) return;
    setIsRegenerating(true);
    toast.info(t`Regenerating thumbnail…`);
    try {
      const path = await regenerateModelThumbnail({
        carbon,
        modelId,
        isActive: () => mountedRef.current
      });
      if (!mountedRef.current) return;
      if (path) {
        setThumbnailPath(getPrivateUrl(path));
        toast.success(t`Thumbnail updated`);
      } else {
        toast.info(t`Thumbnail is still generating`);
      }
    } catch {
      if (mountedRef.current) toast.error(t`Failed to regenerate thumbnail`);
    } finally {
      if (mountedRef.current) setIsRegenerating(false);
    }
  }, [modelId, carbon, t]);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!carbon) {
        toast.error(t`Carbon client not found`);
        return;
      }
      // Windows often reports no MIME type for .heic, so also match by name.
      if (
        !IMAGE_UPLOAD_MIME_TYPES.includes(file.type) &&
        !isHeic(file.name, file.type)
      ) {
        toast.error(
          t`File type not supported. Please use JPG, PNG, WebP, GIF, or HEIC.`
        );
        return;
      }
      toast.info(t`Uploading ${file.name}`);

      try {
        const processed = await prepareImageUpload(carbon, {
          bucket: getCompanyPrivateBucket(company.id),
          directory: `${company.id}/tmp`,
          file,
          contained: true
        });

        const reader = new FileReader();
        reader.onload = (event) => {
          if (event.target?.result) {
            const base64String = event.target.result as string;
            setThumbnailPath(base64String);
          }
        };
        reader.readAsDataURL(processed);

        const fileExtension = processed.name.split(".").pop();
        const fileName = `${nanoid()}.${fileExtension}`;
        const thumbnailFile = new File([processed], fileName, {
          type: processed.type
        });
        const { data, error } = await storage(carbon)
          .company(company.id)
          .upload(
            `${company.id}/thumbnails/${itemId}/${fileName}`,
            thumbnailFile,
            {
              upsert: true
            }
          );

        if (error) {
          toastError(t`Failed to upload thumbnail`, error);
          return;
        }

        const result = await requireAffected(
          carbon
            .from("item")
            .update({
              thumbnailPath: data?.path
            })
            .eq("id", itemId)
            .select("id")
        );

        if (result.error) {
          toastError(t`Failed to update thumbnail path`, result.error);
          return;
        }

        if (data) {
          setThumbnailPath(getPrivateUrl(data.path));
          toast.success(t`Thumbnail uploaded`);
        }
      } catch (error) {
        logger.error("Image processing error", { error: error });
        toastError(t`Failed to resize image`, error);
      }
    },
    [carbon, company.id, itemId, t]
  );

  const [isUploading, setIsUploading] = useState(false);
  const onDrop = useCallback(
    async (files: File[]) => {
      const [file] = files;
      if (!file) return;
      setIsUploading(true);
      try {
        await uploadFile(file);
      } finally {
        setIsUploading(false);
      }
    },
    [uploadFile]
  );

  // No `accept` option: it would also filter drops, and Windows reports no
  // MIME type for HEIC, so uploadFile checks the type itself. The image is a
  // pointer-only target; the Upload button is the keyboard path.
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    multiple: false,
    noKeyboard: true,
    disabled: isReadOnly || isUploading
  });

  return (
    <div className="relative w-full aspect-square">
      <div
        {...getRootProps()}
        className={cn(
          "w-full h-full rounded-lg transition-[box-shadow,opacity]",
          !isReadOnly &&
            (isUploading
              ? "cursor-wait opacity-60"
              : "cursor-pointer hover:ring-2 hover:ring-primary/40"),
          isDragActive && "ring-2 ring-primary"
        )}
      >
        <input {...getInputProps({ accept: "image/*" })} />
        {thumbnailPath ? (
          <img
            alt="thumbnail"
            src={thumbnailPath}
            className="w-full h-full object-cover bg-gradient-to-bl from-muted to-muted/40 rounded-lg border border-border"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-bl from-muted to-muted/40 rounded-lg border border-border flex items-center justify-center">
            <span className="text-muted-foreground">
              <Trans>No image</Trans>
            </span>
          </div>
        )}
      </div>
      {!isReadOnly && modelId && (
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              aria-label={t`Regenerate thumbnail from the 3D model`}
              icon={<LuRefreshCw />}
              variant="secondary"
              size="sm"
              className="absolute top-2 right-2 bg-card opacity-100"
              isLoading={isRegenerating}
              isDisabled={isRegenerating}
              onClick={onRegenerate}
            />
          </TooltipTrigger>
          <TooltipContent>
            <Trans>Regenerate thumbnail from the 3D model</Trans>
          </TooltipContent>
        </Tooltip>
      )}
      {!isReadOnly && (
        <HStack className="absolute bottom-2 right-2">
          {thumbnailPath && (
            <Button
              variant="secondary"
              className="bg-card opacity-100"
              size="sm"
              isDisabled={isUploading}
              onClick={onFileRemove}
            >
              <Trans>Remove</Trans>
            </Button>
          )}
          <Button
            variant={thumbnailPath ? "secondary" : "primary"}
            size="sm"
            leftIcon={<LuUpload />}
            className={thumbnailPath ? "bg-card opacity-100" : undefined}
            isLoading={isUploading}
            onClick={open}
          >
            {thumbnailPath ? <Trans>Change</Trans> : <Trans>Upload</Trans>}
          </Button>
        </HStack>
      )}
    </div>
  );
}
