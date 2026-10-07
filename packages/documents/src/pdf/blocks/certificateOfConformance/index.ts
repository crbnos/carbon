// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export { CONFORMITY_STATEMENT } from "./ConformityStatementBlock";
export { certificateOfConformanceBlockRegistry } from "./registry";
export type {
  BlockRenderer,
  CertificateOfConformanceConformity,
  CertificateOfConformanceData,
  CertificateOfConformanceHeader,
  CertificateOfConformanceLine,
  CertificateSigner
} from "./types";
export { buildCertificateOfConformanceVars } from "./vars";
