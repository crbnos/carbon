import { json } from "@remix-run/server-runtime";
import type { FORM_DEFAULTS_FIELD } from "./internal/constants";
import { formDefaultValuesKey } from "./internal/constants";
import type {
  ValidationErrorResponseData,
  ValidatorError,
} from "./validation/types";

/**
 * Takes the errors from a `Validator` and returns a `Response`.
 * When you return this from your action, `ValidatedForm` on the frontend will automatically
 * display the errors on the correct fields on the correct form.
 *
 * You can also provide a second argument to `validationError`
 * to specify how to repopulate the form when JS is disabled.
 *
 * @example
 * ```ts
 * const result = validator.validate(await request.formData());
 * if (result.error) return validationError(result.error, result.submittedData);
 * ```
 */
export function validationError(
  error: ValidatorError,
  repopulateFields?: unknown,
  init?: ResponseInit
) {
  return json<ValidationErrorResponseData>(
    {
      fieldErrors: error.fieldErrors,
      subaction: error.subaction,
      repopulateFields,
      formId: error.formId,
    },
    { status: 422, ...init }
  );
}

export type FormDefaults = {
  [formDefaultsKey: `${typeof FORM_DEFAULTS_FIELD}_${string}`]: any;
};

// FIXME: Remove after https://github.com/egoist/tsup/issues/813 is fixed
export type internal_FORM_DEFAULTS_FIELD = typeof FORM_DEFAULTS_FIELD;

export const setFormDefaults = <DataType = any>(
  formId: string,
  defaultValues: Partial<DataType>
): FormDefaults => ({
  [formDefaultValuesKey(formId)]: defaultValues,
});
