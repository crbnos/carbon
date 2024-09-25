import { useCarbon } from "@carbon/auth";
import { Button, File, VStack, toast } from "@carbon/react";
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
      const avatarFile = e.target.files[0];
      const fileExtension = avatarFile.name.substring(
        avatarFile.name.lastIndexOf(".") + 1
      );

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
      <File accept="image/*" onChange={uploadImage}>
        {user.avatarUrl ? "Change" : "Upload"}
      </File>

      {user.avatarUrl && (
        <Button variant="secondary" onClick={deleteImage}>
          Remove
        </Button>
      )}
    </VStack>
  );
};

export default ProfilePhotoForm;
