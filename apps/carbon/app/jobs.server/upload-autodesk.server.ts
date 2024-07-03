import { eventTrigger } from "@trigger.dev/sdk";
import { z } from "zod";
import {
  finalizeAutodeskUpload,
  getAutodeskSignedUrl,
  getAutodeskToken,
  getManifest,
  translateFile,
  uploadToAutodesk,
} from "~/lib/autodesk/autodesk.server";

import { getSupabaseServiceRole } from "~/lib/supabase";
import { triggerClient } from "~/lib/trigger.server";
import { upsertModelUpload } from "~/modules/shared";

const supabaseClient = getSupabaseServiceRole();

const job = triggerClient.defineJob({
  id: "upload-autodesk",
  name: "Upload CAD Model to Autodesk",
  version: "0.0.1",
  trigger: eventTrigger({
    name: "upload.autodesk",
    schema: z.object({
      name: z.string(),
      modelPath: z.string(),
      fileId: z.string(),
    }),
  }),
  run: async (payload, io, ctx) => {
    const { modelPath, fileId, name } = payload;

    const autodeskToken = await getAutodeskToken();
    if (autodeskToken.error) {
      throw new Error(
        "Failed to get Autodesk token: " + autodeskToken.error.message
      );
    }
    const token = autodeskToken.data?.token;
    const encodedFilename = modelPath.split("/").pop() as string;

    const [signedUrl, blob] = await Promise.all([
      getAutodeskSignedUrl(encodedFilename, token),
      supabaseClient.storage.from("private").download(modelPath),
    ]);
    if (signedUrl.error) {
      throw new Error("Failed to get signed URL: " + signedUrl.error.message);
    }
    if (blob.error) {
      throw new Error("Failed to download blob: " + blob.error.message);
    }

    const file = new File([blob.data], encodedFilename);
    const { uploadKey, url } = signedUrl.data;

    const initialUpload = await uploadToAutodesk(url, file, uploadKey);
    if (initialUpload.error) {
      throw new Error("Failed to upload file: " + initialUpload.error.message);
    }

    const upload = await finalizeAutodeskUpload(
      encodedFilename,
      token,
      uploadKey
    );
    if (upload.error) {
      throw new Error("Failed to finalize upload: " + upload.error.message);
    }

    const { urn } = upload.data;
    const autodeskUrn = Buffer.from(urn).toString("base64");

    const translation = await translateFile(autodeskUrn, token);
    if (translation.error) {
      throw new Error("Failed to translate file: " + translation.error.message);
    }

    const manifest = await getManifest(autodeskUrn, token);
    if (manifest.error) {
      throw new Error("Failed to get manifest: " + manifest.error.message);
    }

    const modelRecord = await upsertModelUpload(supabaseClient, {
      id: fileId,
      name,
      size: file.size,
      autodeskUrn,
    });

    if (modelRecord.error) {
      throw new Error("Failed to record upload: " + modelRecord.error.message);
    }
  },
});

export default job;
