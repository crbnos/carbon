// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { storage } from "@carbon/files";
import { getLogger } from "@carbon/logger";
import { serverFns } from "@carbon/server-functions";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { notifyScheduleInputsChanged } from "~/modules/production";
import { getDatabaseClient } from "~/services/database.server";
import {
  trainingCertificateKeyPrefix,
  validateTrainingCertificate
} from "./resources.models";
import {
  getTrainingGrantedAbilityId,
  insertTrainingCompletion
} from "./resources.service";

const logger = getLogger("erp", "maintenance-labor");

// Reconcile the dispatches' labor postings with their time entries (the
// post-maintenance-event server function — idempotent, so call it after ANY
// change to a dispatch's entries or its completion). Returns an error message
// for the caller's flash, or null. System: the caller has already authorized
// the change, and a delete-only user must still reverse its cost.
export async function postMaintenanceLabor(args: {
  maintenanceDispatchIds: string[];
  companyId: string;
  userId: string;
}): Promise<string | null> {
  if (args.maintenanceDispatchIds.length === 0) return null;

  const { maintenanceDispatchIds, companyId, userId } = args;
  const posting = await serverFns
    .system({ db: getDatabaseClient(), companyId, userId })
    .invoke("post-maintenance-event", { maintenanceDispatchIds });

  if (posting.error) {
    logger.error("Failed to post maintenance labor", {
      companyId,
      maintenanceDispatchIds,
      error: posting.error
    });
    return posting.error.message || "Failed to post maintenance labor";
  }
  return null;
}

const trainingLogger = getLogger("erp", "training-completion");

// An external assignment (no training) is always open and one-time.
type AssignmentForCompletion = {
  trainingId: string | null;
  training: {
    status: string;
    frequency: Database["public"]["Enums"]["trainingFrequency"];
  } | null;
};

// The only completion path (quiz, manager Mark Complete). An external
// assignment may carry a certificate; the server builds its key, so a caller
// cannot point a completion at another person's file.
export async function recordTrainingCompletion(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    trainingAssignmentId: string;
    employeeId: string;
    completedBy: string;
    assignment: AssignmentForCompletion;
    certificate?: FormDataEntryValue | null;
  }
): Promise<{ error: null } | { error: string; status: 400 | 500 }> {
  const { companyId, trainingAssignmentId, employeeId, completedBy } = args;
  const isExternal = args.assignment.trainingId === null;
  const training = args.assignment.training;

  if (!isExternal && training?.status !== "Active") {
    return { error: "This training is not currently active", status: 400 };
  }

  let certificatePath: string | null = null;
  const hasCertificate =
    args.certificate instanceof File && args.certificate.size > 0;
  if (isExternal && hasCertificate) {
    const certificate = await validateTrainingCertificate(
      args.certificate ?? null
    );
    if (certificate.error !== null) {
      return { error: certificate.error, status: 400 };
    }
    const key = `${trainingCertificateKeyPrefix(
      companyId,
      trainingAssignmentId,
      employeeId
    )}${nanoid()}.${certificate.extension}`;
    const upload = await storage(client)
      .company(companyId)
      .upload(key, certificate.file);
    if (upload.error) {
      trainingLogger.error("Failed to upload training certificate", {
        companyId,
        trainingAssignmentId,
        error: upload.error
      });
      return { error: "Failed to upload the certificate", status: 500 };
    }
    certificatePath = key;
  }

  const period = await client.rpc("get_current_training_period", {
    frequency: training?.frequency ?? "Once"
  });

  const completion = await insertTrainingCompletion(client, {
    trainingAssignmentId,
    employeeId,
    period: period.data ?? null,
    companyId,
    completedBy,
    createdBy: completedBy,
    certificatePath
  });
  if (completion.error) {
    // The unique indexes allow one completion per employee and period: a
    // second submit means it is already recorded, which is what was asked.
    const alreadyRecorded = completion.error.code === "23505";
    if (!alreadyRecorded) {
      trainingLogger.error("Failed to record training completion", {
        companyId,
        trainingAssignmentId,
        error: completion.error
      });
    }
    // Nothing points at the new file now.
    if (certificatePath) {
      const removed = await storage(client)
        .company(companyId)
        .remove([certificatePath]);
      if (removed.error) {
        trainingLogger.error("Failed to remove orphaned certificate", {
          companyId,
          certificatePath,
          error: removed.error
        });
      }
    }
    return alreadyRecorded
      ? { error: null }
      : { error: "Failed to record the training as complete", status: 500 };
  }

  // Completing a training that grants an ability adds a qualification (via the
  // grant trigger) — restamp the scheduler for that ability's operator pool.
  const grantedAbilityId = await getTrainingGrantedAbilityId(
    client,
    trainingAssignmentId,
    companyId
  );
  if (grantedAbilityId) {
    await notifyScheduleInputsChanged(
      companyId,
      "ability",
      "Operator qualified via training",
      grantedAbilityId
    );
  }

  return { error: null };
}
