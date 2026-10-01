// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export const FORM_ID_FIELD = "__rvfInternalFormId" as const;
export const FORM_DEFAULTS_FIELD = "__rvfInternalFormDefaults" as const;
export const formDefaultValuesKey = (formId: string) =>
  `${FORM_DEFAULTS_FIELD}_${formId}`;
