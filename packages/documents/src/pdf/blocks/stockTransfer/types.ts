import type { Database } from "@carbon/database";
import type {
  DocumentBlock,
  DocumentTheme,
  HeaderOptions,
  ResolvedSection
} from "../../../template";
import type { Company } from "../../../types";

/** Everything a Stock Transfer block renderer might need. */
export interface StockTransferData {
  company: Company;
  locale: string;
  stockTransfer: Database["public"]["Tables"]["stockTransfer"]["Row"];
  stockTransferLines: Database["public"]["Views"]["stockTransferLines"]["Row"][];
  location: Database["public"]["Tables"]["location"]["Row"];
  thumbnails?: Record<string, string | null>;
  theme: DocumentTheme;
  sections: Record<string, ResolvedSection>;
  vars: Record<string, string>;
  headerOptions: HeaderOptions;
}

export type BlockRenderer = (args: {
  block: DocumentBlock;
  data: StockTransferData;
}) => JSX.Element | null;
