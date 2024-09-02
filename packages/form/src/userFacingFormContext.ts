import { useCallback, useMemo } from "react";
import {
  useInternalFormContext,
  useRegisterReceiveFocus,
} from "./internal/hooks";
import { useFormHelpers, useFormState } from "./unreleased/formStateHooks";
import type {
  FieldErrors,
  TouchedFields,
  ValidationResult,
} from "./validation/types";

export type FormContextValue = {
  /**
   * All the errors in all the fields in the form.
   */
  fieldErrors: FieldErrors;
  /**
   * Clear the errors of the specified fields.
   */
  clearError: (...names: string[]) => void;
  /**
   * Validate the specified field.
   */
  validateField: (fieldName: string) => Promise<string | null>;
  /**
   * The `action` prop of the form.
   */
  action?: string;
  /**
   * The `subaction` prop of the form.
   */
  subaction?: string;
  /**
   * Whether or not the form is submitting.
   */
  isSubmitting: boolean;
  /**
   * Whether or not a submission has been attempted.
   * This is true once the form has been submitted, even if there were validation errors.
   * Resets to false when the form is reset.
   */
  hasBeenSubmitted: boolean;
  /**
   * Whether or not the form is valid.
   */
  isValid: boolean;
  /**
   * The default values of the form.
   */
  defaultValues?: { [fieldName: string]: any };
  /**
   * Register a custom focus handler to be used when
   * the field needs to receive focus due to a validation error.
   */
  registerReceiveFocus: (fieldName: string, handler: () => void) => () => void;
  /**
   * Any fields that have been touched by the user.
   */
  touchedFields: TouchedFields;
  /**
   * Change the touched state of the specified field.
   */
  setFieldTouched: (fieldName: string, touched: boolean) => void;
  /**
   * Validate the whole form and populate any errors.
   */
  validate: () => Promise<ValidationResult<unknown>>;
  /**
   * Clears all errors on the form.
   */
  clearAllErrors: () => void;
  /**
   * Resets the form.
   *
   * _Note_: The equivalent behavior can be achieved by calling formElement.reset()
   * or clicking a button element with `type="reset"`.
   */
  reset: () => void;
  /**
   * Submits the form, running all validations first.
   *
   * _Note_: This is equivalent to clicking a button element with `type="submit"` or calling formElement.submit().
   */
  submit: () => void;
  /**
   * Returns the current form values as FormData
   */
  getValues: () => FormData;
};

/**
 * Provides access to some of the internal state of the form.
 */
export const useFormContext = (formId?: string): FormContextValue => {
  // Try to access context so we get our error specific to this hook if it's not there
  const context = useInternalFormContext(formId, "useFormContext");
  const state = useFormState(formId);
  const {
    clearError: internalClearError,
    setTouched,
    validateField,
    clearAllErrors,
    validate,
    reset,
    submit,
    getValues,
  } = useFormHelpers(formId);

  const registerReceiveFocus = useRegisterReceiveFocus(context.formId);

  const clearError = useCallback(
    (...names: string[]) => {
      names.forEach((name) => {
        internalClearError(name);
      });
    },
    [internalClearError]
  );

  return useMemo(
    () => ({
      ...state,
      setFieldTouched: setTouched,
      validateField,
      clearError,
      registerReceiveFocus,
      clearAllErrors,
      validate,
      reset,
      submit,
      getValues,
    }),
    [
      clearAllErrors,
      clearError,
      registerReceiveFocus,
      reset,
      setTouched,
      state,
      submit,
      validate,
      validateField,
      getValues,
    ]
  );
};
