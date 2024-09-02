import { useActionData, useMatches, useNavigation } from "@remix-run/react";
import { useCallback, useContext } from "react";
import invariant from "tiny-invariant";
import type { FieldErrors, ValidationErrorResponseData } from "..";
import { getPath } from "../utils";
import { formDefaultValuesKey } from "./constants";
import type { InternalFormContextValue } from "./formContext";
import { InternalFormContext } from "./formContext";
import type { Hydratable } from "./hydratable";
import { hydratable } from "./hydratable";
import { useFormStore } from "./state/storeHooks";
import type { InternalFormId } from "./state/types";

export const useInternalFormContext = (
  formId?: string | symbol,
  hookName?: string
) => {
  const formContext = useContext(InternalFormContext);

  if (formId) return { formId };
  if (formContext) return formContext;

  throw new Error(
    `Unable to determine form for ${hookName}. Please use it inside a ValidatedForm or pass a 'formId'.`
  );
};

export function useErrorResponseForForm({
  fetcher,
  subaction,
  formId,
}: InternalFormContextValue): ValidationErrorResponseData | null {
  const actionData = useActionData<any>();
  if (fetcher) {
    if ((fetcher.data as any)?.fieldErrors) return fetcher.data as any;
    return null;
  }

  if (!actionData?.fieldErrors) return null;

  // If there's an explicit id, we should ignore data that has the wrong id
  if (typeof formId === "string" && actionData.formId)
    return actionData.formId === formId ? actionData : null;

  if (
    (!subaction && !actionData.subaction) ||
    actionData.subaction === subaction
  )
    return actionData;

  return null;
}

export const useFieldErrorsForForm = (
  context: InternalFormContextValue
): Hydratable<FieldErrors | undefined> => {
  const response = useErrorResponseForForm(context);
  const hydrated = useFormStore(context.formId, (state) => state.isHydrated);
  return hydratable.from(response?.fieldErrors, hydrated);
};

export const useDefaultValuesFromLoader = ({
  formId,
}: InternalFormContextValue) => {
  const matches = useMatches();
  if (typeof formId === "string") {
    const dataKey = formDefaultValuesKey(formId);
    // If multiple loaders declare the same default values,
    // we should use the data from the deepest route.
    const match = matches
      .reverse()
      .find(
        (match) =>
          match.data && typeof match.data === "object" && dataKey in match.data
      );
    return (match as any)?.data[dataKey];
  }

  return null;
};

export const useDefaultValuesForForm = (
  context: InternalFormContextValue
): Hydratable<{ [fieldName: string]: any }> => {
  const { formId, defaultValuesProp } = context;
  const hydrated = useFormStore(formId, (state) => state.isHydrated);
  const errorResponse = useErrorResponseForForm(context);
  const defaultValuesFromLoader = useDefaultValuesFromLoader(context);

  // Typical flow is:
  // - Default values only available from props or server
  //   - Props have a higher priority than server
  // - State gets hydrated with default values
  // - After submit, we may need to use values from the error

  if (hydrated) return hydratable.hydratedData();
  if (errorResponse?.repopulateFields) {
    invariant(
      typeof errorResponse.repopulateFields === "object",
      "repopulateFields returned something other than an object"
    );
    return hydratable.serverData(errorResponse.repopulateFields);
  }
  if (defaultValuesProp) return hydratable.serverData(defaultValuesProp);

  return hydratable.serverData(defaultValuesFromLoader);
};

export const useHasActiveFormSubmit = ({
  fetcher,
}: InternalFormContextValue): boolean => {
  let navigation = useNavigation();
  const hasActiveSubmission = fetcher
    ? fetcher.state === "submitting"
    : navigation.state === "submitting" || navigation.state === "loading";
  return hasActiveSubmission;
};

export const useFieldTouched = (
  field: string,
  { formId }: InternalFormContextValue
) => {
  const touched = useFormStore(formId, (state) => state.touchedFields[field]);
  const setFieldTouched = useFormStore(formId, (state) => state.setTouched);
  const setTouched = useCallback(
    (touched: boolean) => setFieldTouched(field, touched),
    [field, setFieldTouched]
  );
  return [touched, setTouched] as const;
};

export const useFieldError = (
  name: string,
  context: InternalFormContextValue
) => {
  const fieldErrors = useFieldErrorsForForm(context);
  const state = useFormStore(
    context.formId,
    (state) => state.fieldErrors[name]
  );
  return fieldErrors.map((fieldErrors) => fieldErrors?.[name]).hydrateTo(state);
};

export const useClearError = (context: InternalFormContextValue) => {
  const { formId } = context;
  return useFormStore(formId, (state) => state.clearFieldError);
};

export const useCurrentDefaultValueForField = (
  formId: InternalFormId,
  field: string
) =>
  useFormStore(formId, (state) => getPath(state.currentDefaultValues, field));

export const useFieldDefaultValue = (
  name: string,
  context: InternalFormContextValue
) => {
  const defaultValues = useDefaultValuesForForm(context);
  const state = useCurrentDefaultValueForField(context.formId, name);

  return defaultValues.map((val) => getPath(val, name)).hydrateTo(state);
};

export const useInternalIsSubmitting = (formId: InternalFormId) =>
  useFormStore(formId, (state) => state.isSubmitting);

export const useInternalIsValid = (formId: InternalFormId) =>
  useFormStore(formId, (state) => state.isValid());

export const useInternalHasBeenSubmitted = (formId: InternalFormId) =>
  useFormStore(formId, (state) => state.hasBeenSubmitted);

export const useSmartValidate = (formId: InternalFormId) =>
  useFormStore(formId, (state) => state.smartValidate);

export const useValidate = (formId: InternalFormId) =>
  useFormStore(formId, (state) => state.validate);

const noOpReceiver = () => () => {};
export const useRegisterReceiveFocus = (formId: InternalFormId) =>
  useFormStore(
    formId,
    (state) => state.formProps?.registerReceiveFocus ?? noOpReceiver
  );

const defaultDefaultValues = {};
export const useSyncedDefaultValues = (formId: InternalFormId) =>
  useFormStore(
    formId,
    (state) => state.formProps?.defaultValues ?? defaultDefaultValues
  );

export const useSetTouched = ({ formId }: InternalFormContextValue) =>
  useFormStore(formId, (state) => state.setTouched);

export const useTouchedFields = (formId: InternalFormId) =>
  useFormStore(formId, (state) => state.touchedFields);

export const useFieldErrors = (formId: InternalFormId) =>
  useFormStore(formId, (state) => state.fieldErrors);

export const useSetFieldErrors = (formId: InternalFormId) =>
  useFormStore(formId, (state) => state.setFieldErrors);

export const useResetFormElement = (formId: InternalFormId) =>
  useFormStore(formId, (state) => state.resetFormElement);

export const useSubmitForm = (formId: InternalFormId) =>
  useFormStore(formId, (state) => state.submit);

export const useFormActionProp = (formId: InternalFormId) =>
  useFormStore(formId, (state) => state.formProps?.action);

export const useFormSubactionProp = (formId: InternalFormId) =>
  useFormStore(formId, (state) => state.formProps?.subaction);

export const useFormValues = (formId: InternalFormId) =>
  useFormStore(formId, (state) => state.getValues);
