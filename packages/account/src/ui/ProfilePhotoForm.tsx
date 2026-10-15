// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { getCompanyPrivateBucket } from "@carbon/files";
import { prepareImageUpload } from "@carbon/files/media";
import { getLogger } from "@carbon/logger";
import {
  Badge,
  Button,
  File as FileUpload,
  toast,
  VStack
} from "@carbon/react";
import { isGeneratedAvatar, newGeneratedAvatar } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ChangeEvent } from "react";
import { useState } from "react";
import { useFetcher } from "react-router";
import type { Account } from "../types";
import AccountAvatar from "./AccountAvatar";
import GeneratedAvatarPicker from "./GeneratedAvatarPicker";

const logger = getLogger("erp", "profilephotoform");

const maxSizeMB = 10;

export type ProfilePhotoFormProps = {
  user: Account;
  /** The account profile action that saves `avatarUrl`. */
  action: string;
  /** The company whose private bucket stages the upload while it is resized. */
  companyId: string;
};

const ProfilePhotoForm = ({
  user,
  action,
  companyId
}: ProfilePhotoFormProps) => {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const fetcher = useFetcher();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  // `avatarUrl` is either an uploaded photo's storage path or a generated avatar.
  const uploadedPhotoPath =
    user.avatarUrl && !isGeneratedAvatar(user.avatarUrl)
      ? user.avatarUrl
      : null;

  const uploadImage = async (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected && carbon) {
      let avatarFile = selected;
      toast.info(t`Uploading ${avatarFile.name}`);

      try {
        const processed = await prepareImageUpload(carbon, {
          bucket: getCompanyPrivateBucket(companyId),
          directory: `${companyId}/tmp`,
          file: avatarFile
        });
        const outputExtension = processed.name.split(".").pop();
        avatarFile = new File([processed], `${user.id}.${outputExtension}`, {
          type: processed.type
        });
      } catch (error) {
        logger.error("Error", { error: error });
        const errorMessage =
          error instanceof Error ? error.message : "Failed to resize image";
        toast.error(errorMessage);
        return;
      }

      const imageUpload = await carbon.storage
        .from("avatars")
        .upload(avatarFile.name, avatarFile, {
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

  // The profile action deletes the replaced photo from storage after it saves
  // the new value, so neither of these touches storage.

  // Removing a photo falls back to a new generated avatar, never to none.
  const removePhoto = () => submitAvatarUrl(newGeneratedAvatar());

  const saveGeneratedAvatar = (value: string) => {
    setIsPickerOpen(false);
    submitAvatarUrl(value);
  };

  const submitAvatarUrl = (avatarPath: string) => {
    const formData = new FormData();
    formData.append("intent", "photo");
    formData.append("path", avatarPath);
    fetcher.submit(formData, {
      method: "post",
      action
    });
  };

  return (
    <VStack className="px-8 items-center">
      <AccountAvatar
        size="2xl"
        path={user?.avatarUrl}
        name={user?.fullName ?? undefined}
      />
      {/* One column as wide as the widest button, so the buttons match. The
          upload controls come last, next to the size limit that applies to them. */}
      <div className="grid gap-2">
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => setIsPickerOpen(true)}
        >
          <Trans>Choose avatar</Trans>
        </Button>
        <FileUpload accept="image/*" onChange={uploadImage} className="w-full">
          {uploadedPhotoPath ? t`Change` : t`Upload`}
        </FileUpload>
        {uploadedPhotoPath && (
          <Button variant="secondary" className="w-full" onClick={removePhoto}>
            <Trans>Remove</Trans>
          </Button>
        )}
      </div>
      <Badge variant="outline">{t`${maxSizeMB}MB limit`}</Badge>
      {isPickerOpen && (
        <GeneratedAvatarPicker
          current={user.avatarUrl}
          onClose={() => setIsPickerOpen(false)}
          onSave={saveGeneratedAvatar}
        />
      )}
    </VStack>
  );
};

export default ProfilePhotoForm;
