// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The run-type descriptor lives in `@carbon/database/run-type`, where the ERP
// reads it too, so the proposal and the ERP's post claim the same rows.
export {
  RUN_LABEL,
  RUN_SEQUENCE,
  type RunType,
  runLabelSentence,
  runTypeFilter
} from "@carbon/database/run-type";
