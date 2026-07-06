import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import type {
  DocumentBlock,
  DocumentTheme,
  HeaderOptions,
  ResolvedSection
} from "../../../template";
import type { Company } from "../../../types";

/** Everything a Packing Slip block renderer might need. */
export interface PackingSlipData {
  company: Company;
  locale: string;
  customer:
    | Database["public"]["Tables"]["customer"]["Row"]
    | Database["public"]["Tables"]["supplier"]["Row"];
  customerReference?: string;
  sourceDocument?: string;
  sourceDocumentId?: string;
  shipment: Database["public"]["Tables"]["shipment"]["Row"];
  shipmentLines: Database["public"]["Views"]["shipmentLines"]["Row"][];
  shippingAddress: Database["public"]["Tables"]["address"]["Row"] | null;
  paymentTerm: { id: string; name: string };
  shippingMethod: { id: string; name: string };
  terms: JSONContent;
  trackedEntities: Database["public"]["Tables"]["trackedEntity"]["Row"][];
  thumbnails?: Record<string, string | null>;
  theme: DocumentTheme;
  sections: Record<string, ResolvedSection>;
  vars: Record<string, string>;
  headerOptions: HeaderOptions;
}

export type BlockRenderer = (args: {
  block: DocumentBlock;
  data: PackingSlipData;
}) => JSX.Element | null;
