import * as R from "remeda";
import type { CreateValidatorArg, GenericObject, Validator } from "..";
import { FORM_ID_FIELD } from "../internal/constants";
import { objectFromPathEntries } from "../internal/flatten";

const preprocessFormData = (data: GenericObject | FormData): GenericObject => {
  // A slightly janky way of determining if the data is a FormData object
  // since node doesn't really have FormData
  if ("entries" in data && typeof data.entries === "function")
    return objectFromPathEntries([...data.entries()]);
  return objectFromPathEntries(Object.entries(data));
};

const omitInternalFields = (data: GenericObject): GenericObject =>
  R.omit(data, [FORM_ID_FIELD]);

/**
 * Used to create a validator for a form.
 * It provides built-in handling for unflattening nested objects and
 * extracting the values from FormData.
 */
export function createValidator<T>(
  validator: CreateValidatorArg<T>
): Validator<T> {
  return {
    validate: async (value) => {
      const data = preprocessFormData(value);
      const result = await validator.validate(omitInternalFields(data));

      if (result.error) {
        return {
          data: undefined,
          error: {
            fieldErrors: result.error,
            subaction: data.subaction,
            formId: data[FORM_ID_FIELD],
          },
          submittedData: data,
          formId: data[FORM_ID_FIELD],
        };
      }

      return {
        data: result.data,
        error: undefined,
        submittedData: data,
        formId: data[FORM_ID_FIELD],
      };
    },
    validateField: (data: GenericObject | FormData, field: string) =>
      validator.validateField(preprocessFormData(data), field),
  };
}
