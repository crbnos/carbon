import type {
  DocumentBlock,
  DocumentTheme,
  HeaderOptions,
  ResolvedSection
} from "../../../template";
import type { Company } from "../../../types";

/** Field 14 signer snapshot (printed name + title at the time of issue). */
export interface CertificateSigner {
  name: string;
  title: string | null;
}

/** Fields 2, 3 and the issue state of an AS9163 certificate. */
export interface CertificateOfConformanceHeader {
  /** Certificate number incl. revision suffix (`COC000012-1`). */
  number: string;
  /** Issue date (`signedAt`) or, for a preview, today — `YYYY-MM-DD`. */
  date: string;
  /** False for a live preview: prints "PREVIEW — NOT ISSUED" + a watermark. */
  issued: boolean;
  reasonForUpdate: string | null;
  signer: CertificateSigner | null;
}

/** One shipped line (fields 7–12). */
export interface CertificateOfConformanceLine {
  itemNumber: string;
  quantity: string;
  description: string;
  revision: string;
  traceability: { id: string; quantity: string }[];
  remarks: string | null;
}

/** Field 13 — grouped conformity details. */
export interface CertificateOfConformanceConformity {
  shelfLife: string[];
  fairs: string[];
  materialCertificates: string[];
  processCertificates: string[];
  concessions: string[];
  nonconformances: string[];
  statements: { name: string; content: string }[];
  reasonForUpdate: string | null;
}

/** Everything a Certificate of Conformance block renderer might need. */
export interface CertificateOfConformanceData {
  company: Company;
  locale: string;
  theme: DocumentTheme;
  sections: Record<string, ResolvedSection>;
  vars: Record<string, string>;
  headerOptions: HeaderOptions;
  certificate: CertificateOfConformanceHeader;
  customer: { name: string; address: string[] };
  purchaseOrderNumber: string | null;
  lines: CertificateOfConformanceLine[];
  conformity: CertificateOfConformanceConformity;
  notes?: unknown;
}

export type BlockRenderer = (args: {
  block: DocumentBlock;
  data: CertificateOfConformanceData;
}) => JSX.Element | null;
