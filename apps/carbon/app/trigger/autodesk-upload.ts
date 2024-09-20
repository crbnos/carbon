import { task } from "@trigger.dev/sdk/v3";
import {
  finalizeAutodeskUpload,
  getAutodeskSignedUrl,
  getAutodeskToken,
  translateFile,
  uploadToAutodesk,
} from "~/lib/autodesk/autodesk.server";
import { getSupabaseServiceRole } from "~/lib/supabase";
import { autodeskPollTask } from "./autodesk-poll";

export const autodeskUploadTask = task({
  id: "autodesk-upload",
  run: async (payload: {
    name: string;
    modelPath: string;
    fileId: string;
    companyId: string;
    itemId: string | null;
    salesRfqLineId: string | null;
    quoteLineId: string | null;
  }) => {
    const {
      companyId,
      modelPath,
      fileId,
      name,
      itemId,
      salesRfqLineId,
      quoteLineId,
    } = payload;

    console.log("Starting autodesk-upload task", { payload });

    try {
      console.log("Getting Autodesk token");
      const autodeskToken = await getAutodeskToken();
      if (autodeskToken.error) {
        throw new Error(
          "Failed to get Autodesk token: " + autodeskToken.error.message
        );
      }
      const token = autodeskToken.data?.token;
      console.log("Autodesk token obtained", {
        token: token?.slice(0, 10) + "...",
      });

      const encodedFilename = modelPath.split("/").pop() as string;
      console.log("Encoded filename", { encodedFilename });

      console.log("Getting signed URL and downloading blob");
      const supabaseClient = getSupabaseServiceRole();
      const [signedUrl, blob] = await Promise.all([
        getAutodeskSignedUrl(encodedFilename, token),
        supabaseClient.storage.from("private").download(modelPath),
      ]);
      if (signedUrl.error) {
        console.error("Failed to get signed URL");
        console.error(signedUrl.error.message);
        throw new Error("Failed to get signed URL: " + signedUrl.error.message);
      }
      if (blob.error) {
        console.error("Failed to download blob");
        console.error(blob.error.message);
        throw new Error("Failed to download blob: " + blob.error.message);
      }

      console.log("Signed URL and blob obtained", {
        signedUrl: signedUrl.data?.url,
        blobSize: blob.data?.size,
      });

      const file = new File([blob.data], encodedFilename);
      const { uploadKey, url } = signedUrl.data;

      console.log("Uploading to Autodesk", { url, uploadKey });
      const initialUpload = await uploadToAutodesk(url, file, uploadKey);
      if (initialUpload.error) {
        throw new Error(
          "Failed to upload file: " + initialUpload.error.message
        );
      }
      console.log("Autodesk upload succeeded");

      console.log("Finalizing Autodesk upload");
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
      console.log("Upload finalized", { urn, autodeskUrn });

      console.log("Translating file");
      const translation = await translateFile(autodeskUrn, token);
      if (translation.error) {
        throw new Error(
          "Failed to translate file: " + translation.error.message
        );
      }
      console.log("File translation initiated");

      console.log("Sending autodesk.poll event");
      await autodeskPollTask.trigger({
        id: fileId,
        size: file.size,
        name,
        autodeskUrn,
        companyId,
      });

      console.log("Event sent");
      return { success: true };
    } catch (err) {
      console.error("Error in autodesk-upload task", {
        error: JSON.stringify(err, null, 2),
      });

      const client = getSupabaseServiceRole();
      console.log("Resetting modelUploadId");

      if (itemId) {
        console.log("Resetting item modelUploadId", { itemId });
        await client
          .from("item")
          .update({ modelUploadId: null })
          .eq("id", itemId);
      }
      if (salesRfqLineId) {
        console.log("Resetting salesRfqLine modelUploadId", {
          salesRfqLineId,
        });
        await client
          .from("salesRfqLine")
          .update({ modelUploadId: null })
          .eq("id", salesRfqLineId);
      }
      if (quoteLineId) {
        console.log("Resetting quoteLine modelUploadId", { quoteLineId });
        await client
          .from("quoteLine")
          .update({ modelUploadId: null })
          .eq("id", quoteLineId);
      }

      console.error("Error uploading to Autodesk", {
        error: JSON.stringify(err, null, 2),
      });
      throw err;
    }
  },
});
