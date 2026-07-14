import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { SUPABASE_ANON_KEY, SUPABASE_URL, VERCEL_URL } from "@carbon/env";
import { inngest } from "../../client";

export const modelThumbnailFunction = inngest.createFunction(
  { id: "model-thumbnail", retries: 3 },
  { event: "carbon/model-thumbnail" },
  async ({ event, step, logger }) => {
    const { modelId, companyId } = event.data;

    const isLocal =
      VERCEL_URL === undefined || VERCEL_URL.includes("localhost");

    const getModelUrl = (id: string) => {
      if (isLocal) return `http://localhost:3000/file/model/${id}`;
      const domain = VERCEL_URL?.startsWith("https://")
        ? VERCEL_URL
        : `https://${VERCEL_URL}`;
      return `${domain}/file/model/${id}`;
    };

    if (isLocal) {
      logger.info("Skipping model-thumbnail task on local", {
        payload: event.data
      });
      return;
    }

    await step.run("generate-and-upload-thumbnail", async () => {
      logger.info("Starting model-thumbnail task", { payload: event.data });
      const client = getCarbonServiceRole();

      const url = getModelUrl(modelId);
      const imageUrl = `${SUPABASE_URL}/functions/v1/thumbnail`;

      const response = await fetch(imageUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ url })
      });

      if (response.status !== 200) {
        logger.error("Failed to generate thumbnail", { response });
        throw new Error("Failed to generate thumbnail");
      }

      const blob = new Blob([await response.arrayBuffer()], {
        type: "image/png"
      });

      const fileName = `${modelId}.png`;
      const thumbnailFile = new File([blob], fileName, {
        type: "image/png"
      });

      logger.info("Uploading thumbnail", { fileName });

      const { data, error } = await client.storage
        .from("private")
        .upload(
          `${companyId}/thumbnails/${modelId}/${fileName}`,
          thumbnailFile,
          {
            upsert: true
          }
        );

      if (error) {
        logger.error("Failed to upload thumbnail", { error });
      }

      const result = await client
        .from("modelUpload")
        .update({
          thumbnailPath: data?.path
        })
        .eq("id", modelId);

      if (result.error) {
        logger.error("Failed to update thumbnail path", {
          error: result.error
        });
      }
    });
  }
);
