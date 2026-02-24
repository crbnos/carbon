import { SUPABASE_URL, useCarbon } from "@carbon/auth";
import {
  Avatar,
  Button,
  cn,
  File as FileUpload,
  HStack,
  toast,
  VStack
} from "@carbon/react";
import type { ChangeEvent } from "react";
import { useSubmit } from "react-router";
import type { Company } from "~/modules/settings";
import { path } from "~/utils/path";

interface CompanyLogoFormProps {
  company: Company;
  mode: "dark" | "light";
  icon?: boolean;
}

export const maxSizeMB = 10;

const CompanyLogoForm = ({
  company,
  mode,
  icon = false
}: CompanyLogoFormProps) => {
  const { carbon } = useCarbon();
  const submit = useSubmit();

  const getLogoPath = () => {
    const prefix = `${company.id}/logo`;
    const modeSuffix = mode === "dark" ? "-dark" : "-light";
    const iconSuffix = icon ? "-icon" : "";
    const fullPath = `${prefix}${modeSuffix}${iconSuffix}.png`;

    return fullPath;
  };

  const getCurrentLogoPath = () => {
    const logos = {
      dark: company.logoDark,
      light: company.logoLight,
      "dark-icon": company.logoDarkIcon,
      "light-icon": company.logoLightIcon
    };

    const key = `${mode}${icon ? "-icon" : ""}` as keyof typeof logos;
    return logos[key] || null;
  };

  const currentLogoPath = getCurrentLogoPath();

  const uploadImage = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && carbon) {
      let logo = e.target.files[0];

      // Validate file type
      const supportedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif"
      ];
      if (!supportedTypes.includes(logo.type)) {
        toast.error(
          `File type not supported. Please use JPG, PNG, WebP, or GIF.`
        );
        return;
      }

      // Validate file size (10 MB limit)

      const maxSizeBytes = maxSizeMB * 1024 * 1024;
      if (logo.size > maxSizeBytes) {
        toast.error(
          `File size exceeds ${maxSizeMB}MB limit. Current size: ${(
            logo.size / 1024 / 1024
          ).toFixed(2)}MB`
        );
        return;
      }

      const formData = new FormData();
      formData.append("file", logo);
      formData.append("height", "128");
      formData.append("contained", "true");

      try {
        const response = await fetch(
          `${SUPABASE_URL}/functions/v1/image-resizer`,
          {
            method: "POST",
            body: formData
          }
        );

        if (!response.ok) {
          const errorText = await response
            .text()
            .catch(() => response.statusText);
          throw new Error(
            `Image resize failed: ${response.status} ${
              errorText || "Unknown error"
            }`
          );
        }

        const blob = await response.blob();
        const resizedFile = new File([blob], "logo.png", {
          type: "image/png"
        });

        logo = resizedFile;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        console.error("Image resize error:", error);
        toast.error(`Failed to resize image: ${errorMessage}`);
        return;
      }

      const logoPath = getLogoPath();

      const imageUpload = await carbon.storage
        .from("public")
        .upload(logoPath, logo, {
          cacheControl: "0",
          upsert: true
        });

      if (imageUpload.error) {
        const errorMessage = imageUpload.error.message || "Unknown error";
        console.error("Upload error:", imageUpload.error);
        toast.error(`Failed to upload logo: ${errorMessage}`);
        return;
      }

      if (imageUpload.data?.path) {
        toast.success("Logo uploaded successfully");
        submitLogoUrl(imageUpload.data.path);
      }
    }
  };

  const deleteImage = async () => {
    if (carbon && currentLogoPath) {
      const imageDelete = await carbon.storage
        .from("public")
        .remove([currentLogoPath]);

      if (imageDelete.error) {
        const errorMessage = imageDelete.error.message || "Unknown error";
        console.error("Delete error:", imageDelete.error);
        toast.error(`Failed to remove image: ${errorMessage}`);
        return;
      }

      toast.success("Logo removed successfully");
      submitLogoUrl(null);
    }
  };

  const submitLogoUrl = (logoUrl: string | null) => {
    const formData = new FormData();

    formData.append("mode", mode);
    formData.append("icon", String(icon));
    if (logoUrl) formData.append("path", logoUrl);
    submit(formData, {
      method: "post",
      action: path.to.logos
    });
  };

  const getLogoTitle = () => {
    const modeText = mode === "dark" ? "Dark Mode" : "Light Mode";
    const typeText = icon ? "Icon" : "Logo";
    return `${company.name} ${modeText} ${typeText}`;
  };

  return icon ? (
    <VStack className="items-center py-4" spacing={4}>
      <div
        className={cn(
          "flex items-center justify-center h-[156px] w-[156px] rounded-lg",
          mode === "dark" ? "bg-black text-white" : "bg-zinc-200/90 text-black"
        )}
      >
        {currentLogoPath ? (
          <img
            alt={getLogoTitle()}
            src={currentLogoPath}
            className="w-auto mx-auto rounded-lg"
          />
        ) : (
          <Avatar name={company?.name ?? undefined} size="2xl" />
        )}
      </div>

      <HStack spacing={2}>
        <FileUpload accept="image/*" onChange={uploadImage}>
          {currentLogoPath ? "Change" : "Upload"}
        </FileUpload>

        {currentLogoPath && (
          <Button variant="secondary" onClick={deleteImage}>
            Remove
          </Button>
        )}
      </HStack>
    </VStack>
  ) : (
    <VStack className="items-center py-4" spacing={4}>
      <div
        className={cn(
          "flex items-center justify-center w-full h-[156px] rounded-lg border border-input",
          mode === "dark"
            ? "bg-black/90 text-white"
            : "bg-zinc-200/90 text-black"
        )}
      >
        {currentLogoPath ? (
          <img
            alt={getLogoTitle()}
            width="auto"
            height="128"
            src={currentLogoPath}
            className="rounded-lg"
          />
        ) : (
          <p className="font-mono uppercase text-sm">No logo uploaded</p>
        )}
      </div>
      <HStack spacing={2}>
        <FileUpload accept="image/*" onChange={uploadImage}>
          {currentLogoPath ? "Change" : "Upload"}
        </FileUpload>

        {currentLogoPath && (
          <Button variant="secondary" onClick={deleteImage}>
            Remove
          </Button>
        )}
      </HStack>
    </VStack>
  );
};

export default CompanyLogoForm;
