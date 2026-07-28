import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  NODE_ENV,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  VERCEL_URL
} from "@carbon/env";
import { nanoid } from "nanoid";
import { inngest } from "../../client";

export const modelThumbnailFunction = inngest.createFunction(
  {
    id: "model-thumbnail",
    retries: 3,
    // One render per model at a time — overlapping runs (regenerate + the
    // optimise-chained event, or rapid clicks) would race the "delete previous
    // thumbnail" step and can strand a just-published object. (This event's
    // payload key is `modelId`, not `modelUploadId`.)
    singleton: { key: "event.data.modelId", mode: "skip" }
  },
  { event: "carbon/model-thumbnail" },
  async ({ event, step, logger }) => {
    const { modelId, companyId } = event.data;

    const isLocal = NODE_ENV !== "production";
    // Dev opt-in: render via a local Chromium container (`crbn up --thumbnails`).
    const renderLocal = process.env.THUMBNAIL_RENDER_LOCAL === "true";

    // `VERCEL_URL` is the ERP's own URL in every env — prod app URL, or the
    // portless `https://erp.<prefix>.dev` host locally. The local Chromium
    // container reaches that host through the portless proxy (host-gateway),
    // the same way the inngest container reaches the ERP; the raw ERP port only
    // binds 127.0.0.1 and isn't reachable from a container.
    const getModelUrl = (id: string) => {
      const domain = VERCEL_URL?.startsWith("https://")
        ? VERCEL_URL
        : `https://${VERCEL_URL}`;
      return `${domain}/file/model/${id}`;
    };

    if (isLocal && !renderLocal) {
      logger.info(
        "Skipping model-thumbnail on local (run `crbn up --thumbnails` to render via local Chromium)",
        { payload: event.data }
      );
      return;
    }

    await step.run("generate-and-upload-thumbnail", async () => {
      logger.info("Starting model-thumbnail task", { payload: event.data });
      const client = getCarbonServiceRole();

      // The previous thumbnail's path — deleted after the new one lands so a
      // regeneration doesn't leak an orphan (the filename is now unique per run).
      const previous = await client
        .from("modelUpload")
        .select("thumbnailPath")
        .eq("id", modelId)
        .maybeSingle();
      const previousPath = previous.data?.thumbnailPath ?? null;

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

      // Unique filename per generation: the preview is served from a STABLE
      // proxy URL (`/file/preview/...`), so reusing `{modelId}.png` would leave a
      // regenerated thumbnail showing the browser-cached old image. A fresh path
      // changes the URL (cache-bust) and the stored `thumbnailPath` value (so the
      // UI actually re-renders).
      const fileName = `${modelId}-${nanoid(8)}.png`;
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
        throw new Error(`Failed to upload thumbnail: ${error.message}`);
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
        throw new Error(
          `Failed to update thumbnail path: ${result.error.message}`
        );
      }

      // Drop the superseded thumbnail (best-effort — never fail the run over it).
      if (previousPath && previousPath !== data?.path) {
        await client.storage
          .from("private")
          .remove([previousPath])
          .catch(() => undefined);
      }
    });
  }
);
