import { eventTrigger } from "@trigger.dev/sdk";
import { z } from "zod";
import { getAutodeskToken, getManifest } from "~/lib/autodesk/autodesk.server";

import { getSupabaseServiceRole } from "~/lib/supabase";
import { triggerClient } from "~/lib/trigger.server";
import { upsertModelUpload } from "~/modules/shared";

const supabaseClient = getSupabaseServiceRole();

const job = triggerClient.defineJob({
  id: "autodesk-poll",
  name: "Poll for completed file translation in Autodesk",
  version: "0.0.1",
  trigger: eventTrigger({
    name: "autodesk.poll",
    schema: z.object({
      id: z.string(),
      name: z.string(),
      size: z.number(),
      autodeskUrn: z.string(),
    }),
  }),

  run: async (payload, io, ctx) => {
    let success = false;

    const { id, name, size, autodeskUrn } = payload;
    setTimeout(async () => {
      if (!success) {
        // in case of a timeout -- we still want to record the upload
        await upsertModelUpload(supabaseClient, {
          id,
          name,
          size,
          autodeskUrn,
        });
      }
    }, 13000);

    const token = await getAutodeskToken();
    if (token.error) {
      throw new Error("Failed to get Autodesk token: " + token.error.message);
    }

    const manifest = await getManifest(autodeskUrn, token.data.token);
    if (manifest.error) {
      throw new Error("Failed to get manifest: " + manifest.error.message);
    }

    success = true;
    const modelRecord = await upsertModelUpload(supabaseClient, {
      id,
      name,
      size,
      autodeskUrn,
    });

    if (modelRecord.error) {
      throw new Error("Failed to record upload: " + modelRecord.error.message);
    }
  },
});

export default job;
