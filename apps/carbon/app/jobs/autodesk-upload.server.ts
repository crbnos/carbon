import { eventTrigger } from "@trigger.dev/sdk";
import { z } from "zod";
import {
  finalizeAutodeskUpload,
  getAutodeskSignedUrl,
  getAutodeskToken,
  translateFile,
  uploadToAutodesk,
} from "~/lib/autodesk/autodesk.server";

import { getSupabaseServiceRole } from "~/lib/supabase";
import { triggerClient } from "~/lib/trigger.server";

const supabaseClient = getSupabaseServiceRole();

const job = triggerClient.defineJob({
  id: "autodesk-upload",
  name: "Upload CAD Model to Autodesk",
  version: "0.0.1",
  trigger: eventTrigger({
    name: "autodesk.upload",
    schema: z.object({
      name: z.string(),
      modelPath: z.string(),
      fileId: z.string(),
      companyId: z.string(),
      itemId: z.union([z.string(), z.null()]),
      salesRfqLineId: z.union([z.string(), z.null()]),
      quoteLineId: z.union([z.string(), z.null()]),
    }),
  }),
  run: async (payload, io, ctx) => {
    const {
      companyId,
      modelPath,
      fileId,
      name,
      itemId,
      salesRfqLineId,
      quoteLineId,
    } = payload;

    try {
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
        throw new Error(
          "Failed to upload file: " + initialUpload.error.message
        );
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
        throw new Error(
          "Failed to translate file: " + translation.error.message
        );
      }

      const event = await triggerClient.sendEvent({
        name: "autodesk.poll",
        payload: {
          id: fileId,
          size: file.size,
          name,
          autodeskUrn,
          companyId,
        },
      });

      io.logger.info("Event sent", event);
    } catch (err) {
      const client = getSupabaseServiceRole();
      if (itemId) {
        await client
          .from("item")
          .update({ modelUploadId: null })
          .eq("id", itemId);
      }
      if (salesRfqLineId) {
        await client
          .from("salesRfqLine")
          .update({ modelUploadId: null })
          .eq("id", salesRfqLineId);
      }
      if (quoteLineId) {
        await client
          .from("quoteLine")
          .update({ modelUploadId: null })
          .eq("id", quoteLineId);
      }
      io.logger.error("Error uploading to Autodesk");
    }
  },
});

export default job;
