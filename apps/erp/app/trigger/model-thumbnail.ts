import {
  getCarbonServiceRole,
  SUPABASE_URL,
  VERCEL_URL,
} from "@carbon/auth";

import { task } from "@trigger.dev/sdk/v3";

const isLocal = VERCEL_URL === undefined || VERCEL_URL.includes("localhost");

const getModelUrl = (modelId: string) => {
  const domain = isLocal ? "http://localhost:3000" : VERCEL_URL;
  return `${domain}/file/model/${modelId}`;
};

export const modelThumbnailTask = task({
  id: "model-thumbnail",
  run: async (payload: { modelId: string; companyId: string }) => {
    const { modelId, companyId } = payload;

    if (isLocal) {
      console.log("Skipping model-thumbnail task on local", { payload });
      return;
    }

    console.log("Starting model-thumbnail task", { payload });
    const client = getCarbonServiceRole();

    const url = getModelUrl(modelId);
    const imageUrl = `${SUPABASE_URL}/functions/v1/thumbnail`;

    const response = await fetch(imageUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    });

    if (response.status !== 200) {
      console.log("Failed to generate thumbnail", { response });
      throw new Error("Failed to generate thumbnail");
    }

    const blob = new Blob([await response.arrayBuffer()], {
      type: "image/png",
    });

    const fileName = `${modelId}.png`;
    const thumbnailFile = new File([blob], fileName, {
      type: "image/png",
    });

    console.log("Uploading thumbnail", { fileName });

    const { data, error } = await client.storage
      .from("private")
      .upload(`${companyId}/thumbnails/${modelId}/${fileName}`, thumbnailFile, {
        upsert: true,
      });

    if (error) {
      console.error("Failed to upload thumbnail", { error });
    }

    const result = await client
      .from("modelUpload")
      .update({
        thumbnailPath: data?.path,
      })
      .eq("id", modelId);

    if (result.error) {
      console.error("Failed to update thumbnail path", { error: result.error });
    }
  },
});
