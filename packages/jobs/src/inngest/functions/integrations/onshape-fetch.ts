// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { getOnshapeClient } from "@carbon/ee/onshape";
import type { OnshapeOAuthIntegrationId } from "@carbon/ee/onshape/integration-id";
import { TEMP_STAGING_BUCKET } from "@carbon/files";
import { getFileSizeLimit } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NonRetriableError } from "inngest";
import { inngest } from "../../client";
import {
  ASSEMBLER_CONCURRENCY,
  AssemblerJobError,
  runAssemblerJob,
  type StepTools,
  signUploadUrls
} from "../tasks/assembler-client";

// The raw model cap is the temp-staging cap (2.5 GB), the limit a manual
// upload has: an export past it is skipped permanently.
export const RAW_MODEL_MAX_BYTES = getFileSizeLimit("CAD_MODEL_UPLOAD").bytes;

// How long the assembler may take to copy one export into staging.
const FETCH_MAX_WAIT_MS = 30 * 60 * 1000;

export type StagedModel = {
  stagedPath: string;
  size: number;
  contentHash: string;
};

export type OnshapeFetchInput = {
  companyId: string;
  userId: string;
  integrationId?: OnshapeOAuthIntegrationId;
  translationId: string;
  documentId: string;
  foreignId: string;
  stagedPath: string;
};

/**
 * Have the assembler copy one finished Onshape translation into temp-staging
 * (`fetch` action), so the export never passes through this process. Its
 * own function so that it alone takes the shared assembler concurrency: the
 * element sync that invokes it spends its other steps on Onshape.
 */
export async function fetchWithAssembler(
  step: StepTools,
  carbon: SupabaseClient<Database>,
  input: OnshapeFetchInput
): Promise<StagedModel | { tooLarge: true }> {
  try {
    const job = await runAssemblerJob(step, {
      idPrefix: "fetch",
      action: "fetch",
      jobId: `onshape-fetch-${input.translationId}`,
      maxWaitMs: FETCH_MAX_WAIT_MS,
      logger: console,
      // Inside the submit step, so every (re)submit sends a fresh token.
      buildBody: async () => {
        const onshape = await getOnshapeClient(
          carbon,
          input.companyId,
          input.userId,
          input.integrationId
        );
        if (onshape.error || !onshape.client) {
          throw new Error(
            `getOnshapeClient failed: ${onshape.error ?? "no client"}`
          );
        }
        const download = onshape.client.externalDataDownload(
          input.documentId,
          input.foreignId
        );
        return {
          source: { url: download.url, authorization: download.authorization },
          maxBytes: RAW_MODEL_MAX_BYTES,
          output: { path: input.stagedPath, contentType: "application/step" }
        };
      },
      mintUploadUrls: () =>
        signUploadUrls({
          raw: {
            bucket: carbon.storage.from(TEMP_STAGING_BUCKET),
            path: input.stagedPath
          }
        })
    });
    const result = job.result as {
      contentHash?: string;
      outputs?: { raw?: { bytes?: number } };
    } | null;
    if (!result?.contentHash) {
      throw new NonRetriableError("assembler fetch returned no content hash");
    }
    return {
      stagedPath: input.stagedPath,
      size: result.outputs?.raw?.bytes ?? 0,
      contentHash: result.contentHash
    };
  } catch (error) {
    // Decided here: an error class does not survive the invoke back to the
    // caller, a returned value does.
    if (error instanceof AssemblerJobError && error.code === "LIMIT_EXCEEDED") {
      return { tooLarge: true };
    }
    throw error;
  }
}

export const onshapeFetchFunction = inngest.createFunction(
  {
    id: "onshape-fetch",
    retries: 3,
    concurrency: ASSEMBLER_CONCURRENCY
  },
  { event: "carbon/onshape-fetch" },
  async ({ event, step }) =>
    fetchWithAssembler(step, getCarbonServiceRole(), {
      ...event.data,
      integrationId: event.data.integrationId as
        | OnshapeOAuthIntegrationId
        | undefined
    })
);
