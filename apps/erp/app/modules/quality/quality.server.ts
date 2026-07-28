/**
 * ERP bindings for the shared inspection execution engine
 * (@carbon/database/quality). The engine moved there so the MES inspection
 * routes can run the same transactional core; these wrappers keep the ERP
 * call sites unchanged by currying in the ERP Kysely singleton.
 */
import * as engine from "@carbon/database/quality";
import type { z } from "zod";

import { getDatabaseClient } from "~/services/database.server";
import type {
  inspectionDispositionValidator,
  inspectionMeasurementValidator,
  inspectionSampleValidator
} from "./quality.models";

export type { Result } from "@carbon/database/quality";
export { errResult, valuateMeasurement } from "@carbon/database/quality";

export async function upsertInspectionSample(
  sample: z.infer<typeof inspectionSampleValidator> & {
    companyId: string;
    inspectedBy: string;
  }
) {
  return engine.upsertInspectionSample(getDatabaseClient(), sample);
}

export async function dispositionInspection(
  args: z.infer<typeof inspectionDispositionValidator> & {
    companyId: string;
    dispositionedBy: string;
  } & Pick<engine.InspectionDispositionInput, "requireOpen" | "requireSource">
) {
  return engine.dispositionInspection(getDatabaseClient(), args);
}

export async function upsertInspectionMeasurement(
  args: z.infer<typeof inspectionMeasurementValidator> & {
    companyId: string;
    userId: string;
  }
) {
  return engine.upsertInspectionMeasurement(getDatabaseClient(), args);
}

export async function reconcileInspectionSamplingPlans(
  inspectionId: string,
  companyId: string
) {
  return engine.reconcileInspectionSamplingPlans(
    getDatabaseClient(),
    inspectionId,
    companyId
  );
}

export async function changeInspectionDocument(args: {
  inspectionId: string;
  inspectionDocumentId: string | null;
  companyId: string;
  userId: string;
}) {
  return engine.changeInspectionDocument(getDatabaseClient(), args);
}
