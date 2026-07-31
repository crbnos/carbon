import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import type {
  DocumentBlock,
  DocumentTheme,
  HeaderOptions,
  ResolvedSection
} from "../../../template";
import type { Company } from "../../../types";

type JobOperationStep = Database["public"]["Tables"]["jobOperationStep"]["Row"];

export type JobOperationWithSteps =
  Database["public"]["Tables"]["jobOperation"]["Row"] & {
    jobOperationStep?: JobOperationStep[];
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
  materials?: JobTravelerMaterial[];
  theme: DocumentTheme;
  sections: Record<string, ResolvedSection>;
  vars: Record<string, string>;
  headerOptions: HeaderOptions;
}

export type BlockRenderer = (args: {
  block: DocumentBlock;
  data: JobTravelerData;
}) => JSX.Element | null;
