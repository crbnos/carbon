// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationStep } from "@carbon/mes-core";
import { useLingui } from "@lingui/react/macro";
import { randomUUID } from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { View } from "react-native";
import { toast } from "sonner-native";
import { Body, Button, Muted, WarningNote } from "~/components/ui";
import { useAuth } from "~/lib/auth/AuthProvider";
import { useSupabase } from "~/lib/auth/useSupabase";
import { commandMessage, useRecordStep } from "./commands";
import { recordForUnit } from "./logic";
import { base64ToBytes, companyBucketName, stepPhotoPath } from "./photoUpload";

/**
 * A photo against a File step — the gasket seated, the weld before grinding.
 *
 * Two routes in, because both are real: the camera, which is what an operator
 * standing at the machine wants, and the library, for a photo taken a minute
 * ago before they opened the app. Each asks for its own permission at the
 * moment it is used rather than on mount, so an operator who never attaches a
 * photo is never asked.
 *
 * The upload goes straight to the company's own storage bucket, under the key
 * the web writes, so the ERP and the customer portal read the same object. It
 * does NOT go through /api/v1: there is nothing for a command to do around a
 * storage PUT, and routing a photo through the server would double the bytes
 * over a shop-floor connection. The step RECORD is a command, though — that is
 * what has to be attributed to the pinned operator.
 *
 * The record is written only AFTER the upload succeeds. The other order would
 * mark a step photographed with nothing behind it, which is worse than a
 * failed attach the operator can see and repeat.
 */
export function StepPhoto({
  step,
  unitIndex,
  operationId
}: {
  step: OperationStep;
  unitIndex: number;
  operationId: string;
}) {
  const { t } = useLingui();
  const { companyId } = useAuth();
  const supabase = useSupabase();
  const record = useRecordStep(operationId);
  const [busy, setBusy] = useState(false);
  const existing = recordForUnit(step, unitIndex);
  const attached = Boolean(existing?.value);

  const attach = async (source: "camera" | "library") => {
    if (!companyId || !supabase) {
      toast.error(t`Sign in again to attach a photo`);
      return;
    }

    const permission =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      // Said plainly, and the step stays where it is: an operator who declined
      // once should be able to use the other route, or the browser.
      toast.error(
        source === "camera"
          ? t`Allow the camera to take a photo for this step`
          : t`Allow photo access to attach an existing photo`
      );
      return;
    }

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      // The picker hands back base64 directly, which avoids a second native
      // round-trip through the filesystem just to read the bytes back.
      base64: true,
      // A 12-megapixel tablet photo is ~5 MB and a shop floor's Wi-Fi is not.
      // 0.6 keeps a weld bead legible at a fraction of the bytes.
      quality: 0.6
    };

    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset?.base64) {
      toast.error(t`That photo could not be read`);
      return;
    }

    setBusy(true);
    try {
      const path = stepPhotoPath({
        companyId,
        jobOperationId: operationId,
        stepId: step.id,
        unique: randomUUID(),
        fileName: asset.fileName ?? "photo.jpg"
      });

      const { error } = await supabase.storage
        .from(companyBucketName(companyId))
        .upload(path, base64ToBytes(asset.base64), {
          contentType: asset.mimeType ?? "image/jpeg",
          upsert: true
        });
      if (error) throw error;

      // Only now is the step recorded, and `value` is the storage key — the
      // same thing the web records, so either app can render it.
      await record.mutateAsync({
        index: unitIndex,
        jobOperationStepId: step.id,
        value: path
      });
      toast.success(t`Photo attached`);
    } catch (error) {
      toast.error(commandMessage(error, t`Could not attach that photo`));
    } finally {
      setBusy(false);
    }
  };

  const pending = busy || record.isPending;

  return (
    <View className="gap-2">
      {attached ? (
        <Body className="text-sm">{t`A photo is attached.`}</Body>
      ) : step.required ? (
        <WarningNote>{t`This step needs a photo.`}</WarningNote>
      ) : null}

      <View className="flex-row gap-2">
        <Button
          variant="secondary"
          className="flex-1"
          onPress={() => attach("camera")}
          loading={pending}
          accessibilityLabel={t`Take a photo`}
        >
          {attached ? t`Replace` : t`Take a photo`}
        </Button>
        <Button
          variant="ghost"
          className="flex-1"
          onPress={() => attach("library")}
          disabled={pending}
          accessibilityLabel={t`Choose a photo`}
        >
          {t`Choose`}
        </Button>
      </View>
      <Muted className="text-sm">{t`Photos go to this job's files.`}</Muted>
    </View>
  );
}
