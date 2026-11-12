// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import type {
  DocumentBlock,
  DocumentTheme,
  DocumentValues,
  HeaderOptions,
  ResolvedSection
} from "../../../template";
import type { Company } from "../../../types";

export type JobOperationStep =
  Database["public"]["Tables"]["jobOperationStep"]["Row"];

export type JobOperationWithSteps =
  Database["public"]["Tables"]["jobOperation"]["Row"] & {
    jobOperationStep?: JobOperationStep[];
    // The operation batch it runs in, when it has one.
    jobOperationBatch?: { readableId: string; notes?: string | null } | null;
  };

/** One BOM line rendered in the opt-in Materials section. */
export interface JobTravelerMaterial {
  id: string;
  itemReadableId?: string | null;
  description: string;
  quantity: number;
  unitOfMeasureCode?: string | null;
  methodType?: string | null;
}

/** Everything a Job Traveler block renderer might need. */
export interface JobTravelerData {
  /** The printed document title. */
  documentTitle: string;
  /** The printed document number; absent when the user hid it. */
  documentNumber?: string;
  /** The printed sales order under the number; absent without a sales order. */
  documentSubId?: string;
  company: Company;
  locale?: string;
  job: Database["public"]["Views"]["jobs"]["Row"];
  jobOperations: JobOperationWithSteps[];
  customer: Database["public"]["Tables"]["customer"]["Row"] | null;
  item: Database["public"]["Tables"]["item"]["Row"];
  batchNumber?: string;
  bomId?: string;
  notes?: JSONContent;
  thumbnail?: string | null;
  methodRevision?: string | null;
  /** Company-setting opt-in (companySettings.includeMaterialsOnTraveler). */
  includeMaterials?: boolean;
  /**
   * Company-setting opt-out (companySettings.includeOperationsOnTraveler,
   * defaults on). Undefined is treated as included.
   */
  includeOperations?: boolean;
  materials?: JobTravelerMaterial[];
  theme: DocumentTheme;
  sections: Record<string, ResolvedSection>;
  vars: Record<string, string>;
  values: DocumentValues;
  headerOptions: HeaderOptions;
}

export type BlockRenderer = (args: {
  block: DocumentBlock;
  data: JobTravelerData;
}) => JSX.Element | null;
