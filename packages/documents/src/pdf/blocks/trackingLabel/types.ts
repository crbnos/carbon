import type { ProductLabelItem } from "@carbon/utils";
import type {
  DocumentBlock,
  DocumentTheme,
  ResolvedSection
} from "../../../template";
import type { Company } from "../../../types";

/** Resolved logo sources for a label (color URL + monochrome data URL). */
export interface LabelLogo {
  color?: string | null;
  mono?: string | null;
}

/** Everything a tracking-label block renderer might need (one label's worth). */
export interface LabelData {
  item: ProductLabelItem;
  company?: Company | null;
  logo?: LabelLogo | null;
  theme: DocumentTheme;
  vars: Record<string, string>;
  /** Font sizes derived from the chosen label stock (set per render). */
  titleFontSize: number;
  descriptionFontSize: number;
  qrCodeSize: number;
  /** Width (pt) of the label-name column, so field rows align. */
  labelColWidth: number;
  /** Label cell height (pt), so full-width codes can size to the stock. */
  labelHeightPt: number;
  sections: Record<string, ResolvedSection>;
}

export type BlockRenderer = (args: {
  block: DocumentBlock;
  data: LabelData;
}) => JSX.Element | null;
