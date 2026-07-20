import { SUPABASE_URL, useCarbon } from "@carbon/auth";
import { getLogger } from "@carbon/logger";
import {
  Badge,
  Button,
  File as FileUpload,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ChangeEvent } from "react";
import { useSubmit } from "react-router";
import { Avatar } from "~/components";
import { path } from "~/utils/path";
import type { Account } from "../../types";

const logger = getLogger("erp", "profilephotoform");

const maxSizeMB = 10;

type ProfilePhotoFormProps = {
  user: Account;
};

const ProfilePhotoForm = ({ user }: ProfilePhotoFormProps) => {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const submit = useSubmit();

  const uploadImage = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && carbon) {
      let avatarFile = e.target.files[0];
      toast.info(t`Uploading ${avatarFile.name}`);
      const fileExtension = avatarFile.name.substring(
        avatarFile.name.lastIndexOf(".") + 1
      );
      const formData = new FormData();
      formData.append("file", avatarFile);

      try {
        const response = await fetch(
          `${SUPABASE_URL}/functions/v1/image-resizer`,
          {
            method: "POST",
            body: formData
          }
        );

        if (!response.ok) {
          let errorMessage = "Failed to resize image";
          const contentType = response.headers.get("Content-Type");

          // Try to parse error response if it's JSON
          if (contentType?.includes("application/json")) {
            try {
              const errorData = await response.json();
              if (errorData.error) {
                errorMessage = errorData.error;
              }
            } catch {
              // If JSON parsing fails, use generic message
            }
          }

          throw new Error(errorMessage);
        }

        // Get content type from response to determine if it's JPG or PNG
        const contentType = response.headers.get("Content-Type") || "image/png";
        const isJpg = contentType.includes("image/jpeg");
        const outputExtension = isJpg ? "jpg" : "png";

        const blob = await response.blob();
        const resizedFile = new File([blob], `${user.id}.${outputExtension}`, {
          type: contentType
        });

        avatarFile = resizedFile;
      } catch (error) {
        logger.error("Error", { error: error });
        const errorMessage =
          error instanceof Error ? error.message : "Failed to resize image";
        toast.error(errorMessage);
        return;
      }

      const imageUpload = await carbon.storage
        .from("avatars")
        .upload(`${user.id}.${fileExtension}`, avatarFile, {
          cacheControl: "0",
          upsert: true
        });

      if (imageUpload.error) {
        logger.error("Error", { error: imageUpload.error });
        const errorMessage =
          imageUpload.error.message || "Failed to upload image to storage";
        toast.error(errorMessage);
        return;
      }

      if (imageUpload.data?.path) {
        toast.success(t`Photo uploaded successfully`);
        submitAvatarUrl(imageUpload.data.path);
      } else {
        toast.error(t`Upload completed but no file path returned`);
      }
    }
  };

  const deleteImage = async () => {
    if (carbon && user?.avatarUrl) {
      const imageDelete = await carbon.storage
        .from("avatars")
        .remove([user.avatarUrl]);

      if (imageDelete.error) {
        const errorMessage =
          imageDelete.error.message || "Failed to remove image";
        toast.error(errorMessage);
        return;
      }

      toast.success(t`Photo removed successfully`);
      submitAvatarUrl(null);
    }
  };

  const submitAvatarUrl = (avatarPath: string | null) => {
    const formData = new FormData();
    formData.append("intent", "photo");
    if (avatarPath) formData.append("path", avatarPath);
    submit(formData, {
      method: "post",
      action: path.to.profile,
      replace: true
    });
  };

  return (
    <VStack className="px-8 items-center">
      <Avatar
        size="2xl"
        path={user?.avatarUrl}
        name={user?.fullName ?? undefined}
      />
      <FileUpload accept="image/*" onChange={uploadImage}>
        {user.avatarUrl ? t`Change` : t`Upload`}
      </FileUpload>

      {user.avatarUrl && (
        <Button variant="secondary" onClick={deleteImage}>
          <Trans>Remove</Trans>
        </Button>
      )}
      <Badge variant="outline">{t`${maxSizeMB}MB limit`}</Badge>
    </VStack>
  );
};

export default ProfilePhotoForm;
