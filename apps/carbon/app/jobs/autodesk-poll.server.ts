import { eventTrigger } from "@trigger.dev/sdk";
import { z } from "zod";
import { getAutodeskToken, getManifest } from "~/lib/autodesk/autodesk.server";

import { getSupabaseServiceRole } from "~/lib/supabase";
import { triggerClient } from "~/lib/trigger.server";
import { upsertModelUpload } from "~/modules/shared";

const supabaseClient = getSupabaseServiceRole();

export const config = { runtime: "nodejs" };

const job = triggerClient.defineJob({
  id: "autodesk-poll",
  name: "Poll Autodesk for Translation Progress",
  version: "0.0.1",
  trigger: eventTrigger({
    name: "autodesk.poll",
    schema: z.object({
      id: z.string(),
      name: z.string(),
      size: z.number(),
      autodeskUrn: z.string(),
      companyId: z.string(),
    }),
  }),
  run: async (payload, io, ctx) => {
    const { companyId, id, name, size, autodeskUrn } = payload;

    await io.runTask(
      "autodesk-manifest-poll",
      async () => {
        const token = await getAutodeskToken();
        if (token.error) {
          throw new Error(
            "Failed to get Autodesk token: " + token.error.message
          );
        }

        const manifest = await getManifest(
          autodeskUrn,
          token.data.token,
          companyId
        );
        if (manifest.error) {
          throw new Error("Failed to get manifest: " + manifest.error.message);
        }

        const modelRecord = await upsertModelUpload(supabaseClient, {
          id,
          name,
          size,
          thumbnailPath: manifest.data.thumbnailPath,
          autodeskUrn,
        });

        if (modelRecord.error) {
          throw new Error(
            "Failed to record upload: " + modelRecord.error.message
          );
        }
      },
      {
        name: "Autodesk Manifest Poll",
        retry: {
          limit: 5,
          maxTimeoutInMs: 1000 * 15,
        },
      }
    );
  },
});

export default job;
