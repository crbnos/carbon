import { SUPABASE_URL, useCarbon } from "@carbon/auth";
import { getCompanyPrivateBucket } from "@carbon/files";
import {
  IMAGE_UPLOAD_MIME_TYPES,
  isHeic,
  prepareImageUpload
} from "@carbon/files/media";
import { getLogger } from "@carbon/logger";
import {
  Avatar,
  Button,
  cn,
  File as FileUpload,
  HStack,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import type { ChangeEvent } from "react";
import { useSubmit } from "react-router";
import type { Company } from "~/modules/settings";
import { path } from "~/utils/path";

const STORAGE_URL_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/public/`;
const logger = getLogger("erp", "settings", "company-logo");

const toStoragePath = (urlOrPath: string | null): string | null => {
  if (!urlOrPath) return null;
  return urlOrPath.startsWith(STORAGE_URL_PREFIX)
    ? urlOrPath.slice(STORAGE_URL_PREFIX.length)
    : urlOrPath;
};

export type LogoTarget =
  | "logoLight"
  | "logoDark"
  | "logoLightIcon"
  | "logoDarkIcon"
  | "logoWatermark";

const ROLE_BY_TARGET: Record<LogoTarget, string> = {
  logoLight: "light",
  logoDark: "dark",
  logoLightIcon: "light-icon",
  logoDarkIcon: "dark-icon",
  logoWatermark: "watermark"
};

interface CompanyLogoFormProps {
  company: Company;
  target: LogoTarget;
}

export const maxSizeMB = 10;

const CompanyLogoForm = ({ company, target }: CompanyLogoFormProps) => {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const submit = useSubmit();

  const isIcon = target === "logoLightIcon" || target === "logoDarkIcon";
  const isDark = target === "logoDark" || target === "logoDarkIcon";
  // The watermark is drawn at ~50% page width, so keep it large; everything
  // else is a small inline logo. Either way the canvas pipeline re-encodes to
  // PNG (JPEG for JPEG input) — the only raster formats @react-pdf/renderer
  // can decode (a raw webp/gif upload renders blank in the PDF).
  const resizeHeight = target === "logoWatermark" ? 512 : 128;

  const getLogoPath = (file: File) => {
    return `${company.id}/logos/${ROLE_BY_TARGET[target]}/${nanoid()}/${
      file.name
    }`;
  };

  const currentLogoPath = company[target] ?? null;

  const uploadImage = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && carbon) {
      let logo = e.target.files[0];

      // Windows often reports no MIME type for .heic, so also match by name.
      if (
        !IMAGE_UPLOAD_MIME_TYPES.includes(logo.type) &&
        !isHeic(logo.name, logo.type)
      ) {
        toast.error(
          t`File type not supported. Please use JPG, PNG, WebP, GIF, or HEIC.`
        );
        return;
      }

      const maxSizeBytes = maxSizeMB * 1024 * 1024;
      if (logo.size > maxSizeBytes) {
        toast.error(
          t`File size exceeds ${maxSizeMB}MB limit. Current size: ${(
            logo.size / 1024 / 1024
          ).toFixed(2)}MB`
        );
        return;
      }

      try {
        const processed = await prepareImageUpload(carbon, {
          bucket: getCompanyPrivateBucket(company.id ?? ""),
          directory: `${company.id}/tmp`,
          file: logo,
          height: resizeHeight
        });
        logo = new File(
          [processed],
          `logo.${processed.name.split(".").pop()}`,
          {
            type: processed.type
          }
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        logger.error("Image resize error", { error });
        toast.error(t`Failed to resize image: ${errorMessage}`);
        return;
      }

      const previousStoragePath = toStoragePath(currentLogoPath);
      const logoPath = getLogoPath(logo);

      const imageUpload = await carbon.storage
        .from("public")
        .upload(logoPath, logo, {
          cacheControl: "0",
          upsert: true
        });

      if (imageUpload.error) {
        const errorMessage = imageUpload.error.message || "Unknown error";
        logger.error("Upload error", { error: imageUpload.error });
        toast.error(t`Failed to upload logo: ${errorMessage}`);
        return;
      }

      if (imageUpload.data?.path) {
        if (
          previousStoragePath &&
          previousStoragePath !== imageUpload.data.path
        ) {
          await carbon.storage
            .from("public")
            .remove([previousStoragePath])
            .catch((cleanupError) => {
              logger.warning("Old logo cleanup failed", {
                error: cleanupError
              });
            });
        }
        toast.success(t`Logo uploaded successfully`);
        submitLogoUrl(imageUpload.data.path);
      }
    }
  };

  const deleteImage = async () => {
    if (carbon && currentLogoPath) {
      const storagePath = toStoragePath(currentLogoPath);
      if (!storagePath) return;
      const imageDelete = await carbon.storage
        .from("public")
        .remove([storagePath]);

      if (imageDelete.error) {
        const errorMessage = imageDelete.error.message || "Unknown error";
        logger.error("Delete error", { error: imageDelete.error });
        toast.error(t`Failed to remove image: ${errorMessage}`);
        return;
      }

      toast.success(t`Logo removed successfully`);
      submitLogoUrl(null);
    }
  };

  const submitLogoUrl = (logoUrl: string | null) => {
    const formData = new FormData();
    formData.append("target", target);
    if (logoUrl) formData.append("path", logoUrl);
    submit(formData, {
      method: "post",
      action: path.to.logos
    });
  };

  const altText = `${company.name} Logo`;

  return isIcon ? (
    <VStack className="items-center py-4" spacing={4}>
      <div
        className={cn(
          "flex items-center justify-center h-[156px] w-[156px] rounded-lg overflow-hidden",
          isDark ? "bg-black text-white" : "bg-zinc-200/90 text-black"
        )}
      >
        {currentLogoPath ? (
          <img
            alt={altText}
            src={currentLogoPath}
            className="max-h-full max-w-full object-contain rounded-lg"
          />
        ) : (
          <Avatar name={company?.name ?? undefined} size="2xl" />
        )}
      </div>

      <HStack spacing={2}>
        <FileUpload accept="image/*" onChange={uploadImage}>
          {currentLogoPath ? <Trans>Change</Trans> : <Trans>Upload</Trans>}
        </FileUpload>

        {currentLogoPath && (
          <Button variant="secondary" onClick={deleteImage}>
            <Trans>Remove</Trans>
          </Button>
        )}
      </HStack>
    </VStack>
  ) : (
    <VStack className="items-center py-4" spacing={4}>
      <div
        className={cn(
          "flex items-center justify-center w-full h-[156px] rounded-lg border border-input overflow-hidden",
          isDark ? "bg-black/90 text-white" : "bg-zinc-200/90 text-black"
        )}
      >
        {currentLogoPath ? (
          <img
            alt={altText}
            src={currentLogoPath}
            className="max-h-full max-w-full object-contain rounded-lg"
          />
        ) : (
          <p className="font-mono uppercase text-sm">
            <Trans>No logo uploaded</Trans>
          </p>
        )}
      </div>
      <HStack spacing={2}>
        <FileUpload accept="image/*" onChange={uploadImage}>
          {currentLogoPath ? <Trans>Change</Trans> : <Trans>Upload</Trans>}
        </FileUpload>

        {currentLogoPath && (
          <Button variant="secondary" onClick={deleteImage}>
            <Trans>Remove</Trans>
          </Button>
        )}
      </HStack>
    </VStack>
  );
};

export default CompanyLogoForm;
