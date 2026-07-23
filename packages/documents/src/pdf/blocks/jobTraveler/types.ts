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

/** A job material (BOM line) joined with its item's readable id + name for display. */
export type JobTravelerMaterial =
  Database["public"]["Tables"]["jobMaterial"]["Row"] & {
    item?: {
      readableIdWithRevision: string | null;
      name: string | null;
    } | null;
  };

/** Everything a Job Traveler block renderer might need. */
export interface JobTravelerData {
  company: Company;
  locale?: string;
  job: Database["public"]["Views"]["jobs"]["Row"];
  jobOperations: JobOperationWithSteps[];
  /** Whether to render the materials section (company opt-in setting). */
  includeMaterials?: boolean;
  /** BOM lines for this make method; only populated when `includeMaterials` is set. */
  jobMaterials?: JobTravelerMaterial[];
  customer: Database["public"]["Tables"]["customer"]["Row"] | null;
  item: Database["public"]["Tables"]["item"]["Row"];
  batchNumber?: string;
  bomId?: string;
  notes?: JSONContent;
  thumbnail?: string | null;
  methodRevision?: string | null;
  theme: DocumentTheme;
  sections: Record<string, ResolvedSection>;
  vars: Record<string, string>;
  headerOptions: HeaderOptions;
}

export type BlockRenderer = (args: {
  block: DocumentBlock;
  data: JobTravelerData;
}) => JSX.Element | null;
