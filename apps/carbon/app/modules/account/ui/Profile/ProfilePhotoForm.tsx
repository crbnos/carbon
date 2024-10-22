import { SUPABASE_API_URL, useCarbon } from "@carbon/auth";
import { Button, File as FileUpload, VStack, toast } from "@carbon/react";
import { useSubmit } from "@remix-run/react";
import type { ChangeEvent } from "react";
import { Avatar } from "~/components";
import type { Account } from "~/modules/account";
import { path } from "~/utils/path";

type ProfilePhotoFormProps = {
  user: Account;
};

const ProfilePhotoForm = ({ user }: ProfilePhotoFormProps) => {
  const { carbon } = useCarbon();
  const submit = useSubmit();

  const uploadImage = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && carbon) {
      let avatarFile = e.target.files[0];
      const fileExtension = avatarFile.name.substring(
        avatarFile.name.lastIndexOf(".") + 1
      );

      const formData = new FormData();
      formData.append("file", avatarFile);

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
        const resizedFile = new File([blob], `${user.id}.${fileExtension}`, {
          type: "image/png",
        });

        avatarFile = resizedFile;
      } catch (error) {
        console.error(error);
        toast.error("Failed to resize image");
        return;
      }

      const imageUpload = await carbon.storage
        .from("avatars")
        .upload(`${user.id}.${fileExtension}`, avatarFile, {
          cacheControl: "0",
          upsert: true,
        });

      if (imageUpload.error) {
        console.error(imageUpload.error);
        toast.error("Failed to upload image");
      }

      if (imageUpload.data?.path) {
        submitAvatarUrl(imageUpload.data.path);
      }
    }
  };

  const deleteImage = async () => {
    if (carbon && user?.avatarUrl) {
      const imageDelete = await carbon.storage
        .from("avatars")
        .remove([user.avatarUrl]);

      if (imageDelete.error) {
        toast.error("Failed to remove image");
      }

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
      replace: true,
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
        {user.avatarUrl ? "Change" : "Upload"}
      </FileUpload>

      {user.avatarUrl && (
        <Button variant="secondary" onClick={deleteImage}>
          Remove
        </Button>
      )}
    </VStack>
  );
};

export default ProfilePhotoForm;
