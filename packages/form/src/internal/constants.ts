export const FORM_ID_FIELD = "__rvfInternalFormId" as const;
export const FORM_DEFAULTS_FIELD = "__rvfInternalFormDefaults" as const;
export const formDefaultValuesKey = (formId: string) =>
  `${FORM_DEFAULTS_FIELD}_${formId}`;
