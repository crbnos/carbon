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

    io.logger.info("Starting autodesk-upload job", { payload });

    try {
      io.logger.info("Getting Autodesk token");
      const autodeskToken = await getAutodeskToken();
      if (autodeskToken.error) {
        throw new Error(
          "Failed to get Autodesk token: " + autodeskToken.error.message
        );
      }
      const token = autodeskToken.data?.token;
      io.logger.info("Autodesk token obtained", {
        token: token?.slice(0, 10) + "...",
      });

      const encodedFilename = modelPath.split("/").pop() as string;
      io.logger.info("Encoded filename", { encodedFilename });

      io.logger.info("Getting signed URL and downloading blob");
      const [signedUrl, blob] = await Promise.all([
        getAutodeskSignedUrl(encodedFilename, token),
        supabaseClient.storage.from("private").download(modelPath),
      ]);
      if (signedUrl.error) {
        io.logger.error("Filed to get signed URL");
        io.logger.error(signedUrl.error.message);
        throw new Error("Failed to get signed URL: " + signedUrl.error.message);
      }
      if (blob.error) {
        io.logger.error("Failed to download blob");
        io.logger.error(blob.error.message);
        throw new Error("Failed to download blob: " + blob.error.message);
      }

      io.logger.info("Signed URL and blob obtained", {
        signedUrl: signedUrl.data?.url,
        blobSize: blob.data?.size,
      });

      const file = new File([blob.data], encodedFilename);
      const { uploadKey, url } = signedUrl.data;

      io.logger.info("Uploading to Autodesk", { url, uploadKey });
      const initialUpload = await uploadToAutodesk(url, file, uploadKey);
      if (initialUpload.error) {
        throw new Error(
          "Failed to upload file: " + initialUpload.error.message
        );
      }
      io.logger.info("Autodesk upload succeeded");

      io.logger.info("Finalizing Autodesk upload");
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
      io.logger.info("Upload finalized", { urn, autodeskUrn });

      io.logger.info("Translating file");
      const translation = await translateFile(autodeskUrn, token);
      if (translation.error) {
        throw new Error(
          "Failed to translate file: " + translation.error.message
        );
      }
      io.logger.info("File translation initiated");

      io.logger.info("Sending autodesk.poll event");
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

      io.logger.info("Event sent", { event });
    } catch (err) {
      io.logger.error("Error in autodesk-upload job", {
        error: JSON.stringify(err, null, 2),
      });

      const client = getSupabaseServiceRole();
      io.logger.info("Resetting modelUploadId");

      if (itemId) {
        io.logger.info("Resetting item modelUploadId", { itemId });
        await client
          .from("item")
          .update({ modelUploadId: null })
          .eq("id", itemId);
      }
      if (salesRfqLineId) {
        io.logger.info("Resetting salesRfqLine modelUploadId", {
          salesRfqLineId,
        });
        await client
          .from("salesRfqLine")
          .update({ modelUploadId: null })
          .eq("id", salesRfqLineId);
      }
      if (quoteLineId) {
        io.logger.info("Resetting quoteLine modelUploadId", { quoteLineId });
        await client
          .from("quoteLine")
          .update({ modelUploadId: null })
          .eq("id", quoteLineId);
      }

      io.logger.error("Error uploading to Autodesk", {
        error: JSON.stringify(err, null, 2),
      });
    }
  },
});

export default job;
