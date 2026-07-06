import type { Database } from "@carbon/database";
import type {
  DocumentBlock,
  DocumentTheme,
  HeaderOptions,
  ResolvedSection
} from "../../../template";
import type { Company } from "../../../types";

export type ListItem = { id: string; name: string };

export type IssueItem =
  Database["public"]["Tables"]["nonConformanceItem"]["Row"] & {
    name: string | null;
  };

export type ActionTask =
  Database["public"]["Tables"]["nonConformanceActionTask"]["Row"] & {
    supplier: { name: string } | null;
  };

type JobOperationStepRecord =
  Database["public"]["Tables"]["jobOperationStepRecord"]["Row"];

export type JobOperationStepWithRecords = {
  id: string;
  name: string | null;
  operationId: string;
  nonConformanceActionId: string | null;
  jobOperationStepRecord: JobOperationStepRecord[];
};

// Association rows are loose join shapes; renderers read ad-hoc props.
type AnyRow = Record<string, any>;

export type Associations = {
  items: AnyRow[];
  customers: AnyRow[];
  suppliers: AnyRow[];
  jobOperations: AnyRow[];
  purchaseOrderLines: AnyRow[];
  salesOrderLines: AnyRow[];
  shipmentLines: AnyRow[];
  receiptLines: AnyRow[];
  trackedEntities: AnyRow[];
};

/** Everything an Issue block renderer might need. */
export interface IssueData {
  company: Company;
  locale?: string;
  nonConformance: Database["public"]["Tables"]["nonConformance"]["Row"];
  nonConformanceTypes: Database["public"]["Tables"]["nonConformanceType"]["Row"][];
  actionTasks: ActionTask[];
  requiredActions: ListItem[];
  reviewers: Database["public"]["Tables"]["nonConformanceReviewer"]["Row"][];
  items: IssueItem[];
  associations?: Associations | null;
  assignees: Record<string, string>;
  jobOperationStepRecords: JobOperationStepWithRecords[];
  operationToJobId: Record<string, string>;
  theme: DocumentTheme;
  sections: Record<string, ResolvedSection>;
  vars: Record<string, string>;
  headerOptions: HeaderOptions;
}

export type BlockRenderer = (args: {
  block: DocumentBlock;
  data: IssueData;
}) => JSX.Element | null;
