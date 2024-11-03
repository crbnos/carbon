import { SUPABASE_API_URL, useCarbon } from "@carbon/auth";
import {
  Avatar,
  Button,
  File as FileUpload,
  HStack,
  VStack,
  cn,
  toast,
} from "@carbon/react";
import { useSubmit } from "@remix-run/react";
import { type ChangeEvent } from "react";
import type { Company } from "~/modules/settings";
import { path } from "~/utils/path";

interface CompanyLogoFormProps {
  company: Company;
  mode: "dark" | "light";
  icon?: boolean;
}

const CompanyLogoForm = ({
  company,
  mode,
  icon = false,
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
      "light-icon": company.logoLightIcon,
    };

    const key = `${mode}${icon ? "-icon" : ""}` as keyof typeof logos;
    return logos[key] || null;
  };

  const currentLogoPath = getCurrentLogoPath();

  const uploadImage = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && carbon) {
      let logo = e.target.files[0];

      const formData = new FormData();
      formData.append("file", logo);
      formData.append("height", "128");

      try {
        const response = await fetch(
          `${SUPABASE_API_URL}/functions/v1/image-resizer`,
          {
            method: "POST",
            body: formData,
          }
        );

        if (!response.ok) {
          throw new Error("Failed to resize image");
        }

        const blob = await response.blob();
        const resizedFile = new File([blob], "logo.png", {
          type: "image/png",
        });

        logo = resizedFile;
      } catch (error) {
        console.error(error);
        toast.error("Failed to resize image");
        return;
      }

      const logoPath = getLogoPath();

      const imageUpload = await carbon.storage
        .from("public")
        .upload(logoPath, logo, {
          cacheControl: "0",
          upsert: true,
        });

      if (imageUpload.error) {
        toast.error("Failed to upload logo");
      }

      if (imageUpload.data?.path) {
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
        toast.error("Failed to remove image");
      }

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
      action: path.to.logos,
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
          mode === "dark" ? "bg-black text-white" : "bg-white text-black"
        )}
      >
        {currentLogoPath ? (
          <img
            alt={getLogoTitle()}
            src={currentLogoPath}
            className="h-32 w-auto mx-auto"
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
          "flex items-center justify-center w-full h-[156px]  rounded-lg",
          mode === "dark" ? "bg-black text-white" : "bg-white text-black"
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
