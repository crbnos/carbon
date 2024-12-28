import { getCarbonServiceRole } from "@carbon/auth";
import { getAutodeskToken, getManifest } from "@carbon/auth/autodesk.server";
import { task } from "@trigger.dev/sdk/v3";
import { upsertModelUpload } from "~/modules/shared";

const serviceRole = getCarbonServiceRole();

export const autodeskPollTask = task({
  id: "autodesk-poll",
  run: async (payload: {
    id: string;
    name: string;
    size: number;
    autodeskUrn: string;
    companyId: string;
  }) => {
    const { companyId, id, name, size, autodeskUrn } = payload;

    console.log("Starting Autodesk poll task", { payload });

    const token = await getAutodeskToken();
    if (token.error) {
      throw new Error("Failed to get Autodesk token: " + token.error.message);
    }

    const manifest = await getManifest(
      autodeskUrn,
      token.data.token,
      companyId
    );
    if (manifest.error) {
      throw new Error("Failed to get manifest: " + manifest.error.message);
    }

    const modelRecord = await upsertModelUpload(serviceRole, {
      id,
      name,
      size,
      thumbnailPath: manifest.data.thumbnailPath,
      autodeskUrn,
    });

    if (modelRecord.error) {
      throw new Error("Failed to record upload: " + modelRecord.error.message);
    }

    console.log("Autodesk poll task completed successfully", {
      id,
      autodeskUrn,
    });

    return { success: true, id, autodeskUrn };
  },
});
