import { useEffect, useMemo } from "react";
import type {
  GetInputProps,
  ValidationBehaviorOptions,
} from "./internal/getInputProps";
import { createGetInputProps } from "./internal/getInputProps";
import {
  useClearError,
  useFieldDefaultValue,
  useFieldError,
  useFieldTouched,
  useInternalFormContext,
  useInternalHasBeenSubmitted,
  useInternalIsSubmitting,
  useInternalIsValid,
  useRegisterReceiveFocus,
  useSmartValidate,
} from "./internal/hooks";
import {
  useControllableValue,
  useUpdateControllableValue,
} from "./internal/state/controlledFields";

/**
 * Returns whether or not the parent form is currently being submitted.
 * This is different from Remix's `useNavigation()` in that it
 * is aware of what form it's in and when _that_ form is being submitted.
 *
 * @param formId
 */
export const useIsSubmitting = (formId?: string) => {
  const formContext = useInternalFormContext(formId, "useIsSubmitting");
  return useInternalIsSubmitting(formContext.formId);
};

/**
 * Returns whether or not the current form is valid.
 *
 * @param formId the id of the form. Only necessary if being used outside a ValidatedForm.
 */
export const useIsValid = (formId?: string) => {
  const formContext = useInternalFormContext(formId, "useIsValid");
  return useInternalIsValid(formContext.formId);
};

export type FieldProps = {
  /**
   * The validation error message if there is one.
   */
  error?: string;
  /**
   * Clears the error message.
   */
  clearError: () => void;
  /**
   * Validates the field.
   */
  validate: () => void;
  /**
   * The default value of the field, if there is one.
   */
  defaultValue?: any;
  /**
   * Whether or not the field has been touched.
   */
  touched: boolean;
  /**
   * Helper to set the touched state of the field.
   */
  setTouched: (touched: boolean) => void;
  /**
   * Helper to get all the props necessary for a regular input.
   */
  getInputProps: GetInputProps;
};

/**
 * Provides the data and helpers necessary to set up a field.
 */
export const useField = (
  name: string,
  options?: {
    /**
     * Allows you to configure a custom function that will be called
     * when the input needs to receive focus due to a validation error.
     * This is useful for custom components that use a hidden input.
     */
    handleReceiveFocus?: () => void;
    /**
     * Allows you to specify when a field gets validated (when using getInputProps)
     */
    validationBehavior?: Partial<ValidationBehaviorOptions>;
    /**
     * The formId of the form you want to use.
     * This is not necesary if the input is used inside a form.
     */
    formId?: string;
  }
): FieldProps => {
  const { formId: providedFormId, handleReceiveFocus } = options ?? {};
  const formContext = useInternalFormContext(providedFormId, "useField");

  const defaultValue = useFieldDefaultValue(name, formContext);
  const [touched, setTouched] = useFieldTouched(name, formContext);
  const error = useFieldError(name, formContext);
  const clearError = useClearError(formContext);

  const hasBeenSubmitted = useInternalHasBeenSubmitted(formContext.formId);
  const smartValidate = useSmartValidate(formContext.formId);
  const registerReceiveFocus = useRegisterReceiveFocus(formContext.formId);

  useEffect(() => {
    if (handleReceiveFocus)
      return registerReceiveFocus(name, handleReceiveFocus);
  }, [handleReceiveFocus, name, registerReceiveFocus]);

  const field = useMemo<FieldProps>(() => {
    const helpers = {
      error,
      clearError: () => clearError(name),
      validate: () => smartValidate({ alwaysIncludeErrorsFromFields: [name] }),
      defaultValue,
      touched,
      setTouched,
    };
    const getInputProps = createGetInputProps({
      ...helpers,
      name,
      hasBeenSubmitted,
      validationBehavior: options?.validationBehavior,
    });
    return {
      ...helpers,
      getInputProps,
    };
  }, [
    error,
    clearError,
    defaultValue,
    touched,
    setTouched,
    name,
    hasBeenSubmitted,
    options?.validationBehavior,
    smartValidate,
  ]);

  return field;
};

export const useControlField = <T>(name: string, formId?: string) => {
  const context = useInternalFormContext(formId, "useControlField");
  const [value, setValue] = useControllableValue(context, name);
  return [value as T, setValue as (value: T) => void] as const;
};

export const useUpdateControlledField = (formId?: string) => {
  const context = useInternalFormContext(formId, "useControlField");
  return useUpdateControllableValue(context.formId);
};
