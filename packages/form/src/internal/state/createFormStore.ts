import type { WritableDraft } from "immer/dist/internal";
import invariant from "tiny-invariant";
import type { GetState } from "zustand";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { getPath, setPath } from "../../utils";
import type {
  FieldErrors,
  TouchedFields,
  ValidationResult,
  Validator,
} from "../../validation/types";
import { requestSubmit } from "../logic/requestSubmit";
import * as arrayUtil from "./arrayUtil";
import type { InternalFormId } from "./types";

export type SyncedFormProps = {
  formId?: string;
  action?: string;
  subaction?: string;
  defaultValues: { [fieldName: string]: any };
  registerReceiveFocus: (fieldName: string, handler: () => void) => () => void;
  validator: Validator<unknown>;
};

export type SmartValidateOpts = {
  alwaysIncludeErrorsFromFields?: string[];
};

export type FormStoreState = {
  forms: { [formId: InternalFormId]: FormState };
  form: (formId: InternalFormId) => FormState;
  registerForm: (formId: InternalFormId) => void;
  cleanupForm: (formId: InternalFormId) => void;
};

export type FormState = {
  isHydrated: boolean;
  isSubmitting: boolean;
  hasBeenSubmitted: boolean;
  fieldErrors: FieldErrors;
  touchedFields: TouchedFields;
  formProps?: SyncedFormProps;
  formElement: HTMLFormElement | null;
  currentDefaultValues: Record<string, any>;

  isValid: () => boolean;
  startSubmit: () => void;
  endSubmit: () => void;
  setTouched: (field: string, touched: boolean) => void;
  setFieldError: (field: string, error: string) => void;
  setFieldErrors: (errors: FieldErrors) => void;
  clearFieldError: (field: string) => void;
  reset: () => void;
  syncFormProps: (props: SyncedFormProps) => void;
  setFormElement: (formElement: HTMLFormElement | null) => void;
  validate: () => Promise<ValidationResult<unknown>>;
  smartValidate: (
    opts?: SmartValidateOpts
  ) => Promise<ValidationResult<unknown>>;
  resetFormElement: () => void;
  submit: () => void;
  getValues: () => FormData;

  controlledFields: {
    values: { [fieldName: string]: any };
    refCounts: { [fieldName: string]: number };
    valueUpdatePromises: { [fieldName: string]: Promise<void> };
    valueUpdateResolvers: { [fieldName: string]: () => void };

    register: (fieldName: string) => void;
    unregister: (fieldName: string) => void;
    setValue: (fieldName: string, value: unknown) => void;
    kickoffValueUpdate: (fieldName: string) => void;
    getValue: (fieldName: string) => unknown;
    awaitValueUpdate: (fieldName: string) => Promise<void>;

    array: {
      push: (fieldName: string, value: unknown) => void;
      swap: (fieldName: string, indexA: number, indexB: number) => void;
      move: (fieldName: string, fromIndex: number, toIndex: number) => void;
      insert: (fieldName: string, index: number, value: unknown) => void;
      unshift: (fieldName: string, value: unknown) => void;
      remove: (fieldName: string, index: number) => void;
      pop: (fieldName: string) => void;
      replace: (fieldName: string, index: number, value: unknown) => void;
    };
  };
};

const noOp = () => {};
const defaultFormState: FormState = {
  isHydrated: false,
  isSubmitting: false,
  hasBeenSubmitted: false,
  touchedFields: {},
  fieldErrors: {},
  formElement: null,
  isValid: () => true,
  startSubmit: noOp,
  endSubmit: noOp,
  setTouched: noOp,
  setFieldError: noOp,
  setFieldErrors: noOp,
  clearFieldError: noOp,
  currentDefaultValues: {},

  reset: () => noOp,
  syncFormProps: noOp,
  setFormElement: noOp,

  validate: async () => {
    throw new Error("Validate called before form was initialized.");
  },

  smartValidate: async () => {
    throw new Error("Validate called before form was initialized.");
  },

  submit: async () => {
    throw new Error("Submit called before form was initialized.");
  },

  resetFormElement: noOp,
  getValues: () => new FormData(),

  controlledFields: {
    values: {},
    refCounts: {},
    valueUpdatePromises: {},
    valueUpdateResolvers: {},

    register: noOp,
    unregister: noOp,
    setValue: noOp,
    getValue: noOp,
    kickoffValueUpdate: noOp,
    awaitValueUpdate: async () => {
      throw new Error("AwaitValueUpdate called before form was initialized.");
    },

    array: {
      push: noOp,
      swap: noOp,
      move: noOp,
      insert: noOp,
      unshift: noOp,
      remove: noOp,
      pop: noOp,
      replace: noOp,
    },
  },
};

const createFormState = (
  set: (setter: (draft: WritableDraft<FormState>) => void) => void,
  get: GetState<FormState>
): FormState => ({
  // It's not "hydrated" until the form props are synced
  isHydrated: false,
  isSubmitting: false,
  hasBeenSubmitted: false,
  touchedFields: {},
  fieldErrors: {},
  formElement: null,
  currentDefaultValues: {},

  isValid: () => Object.keys(get().fieldErrors).length === 0,
  startSubmit: () =>
    set((state) => {
      state.isSubmitting = true;
      state.hasBeenSubmitted = true;
    }),
  endSubmit: () =>
    set((state) => {
      state.isSubmitting = false;
    }),
  setTouched: (fieldName, touched) =>
    set((state) => {
      state.touchedFields[fieldName] = touched;
    }),
  setFieldError: (fieldName: string, error: string) =>
    set((state) => {
      state.fieldErrors[fieldName] = error;
    }),
  setFieldErrors: (errors: FieldErrors) =>
    set((state) => {
      state.fieldErrors = errors;
    }),
  clearFieldError: (fieldName: string) =>
    set((state) => {
      delete state.fieldErrors[fieldName];
    }),
  reset: () =>
    set((state) => {
      state.fieldErrors = {};
      state.touchedFields = {};
      state.hasBeenSubmitted = false;
      const nextDefaults = state.formProps?.defaultValues ?? {};
      state.controlledFields.values = nextDefaults;
      state.currentDefaultValues = nextDefaults;
    }),
  syncFormProps: (props: SyncedFormProps) =>
    set((state) => {
      if (!state.isHydrated) {
        state.controlledFields.values = props.defaultValues;
        state.currentDefaultValues = props.defaultValues;
      }

      state.formProps = props;
      state.isHydrated = true;
    }),
  setFormElement: (formElement: HTMLFormElement | null) => {
    // This gets called frequently, so we want to avoid calling set() every time
    // Or else we wind up with an infinite loop
    if (get().formElement === formElement) return;
    set((state) => {
      // weird type issue here
      // seems to be because formElement is a writable draft
      state.formElement = formElement as any;
    });
  },
  validate: async () => {
    const formElement = get().formElement;
    invariant(
      formElement,
      "Cannot find reference to form. This is probably a bug in remix-validated-form."
    );

    const validator = get().formProps?.validator;
    invariant(
      validator,
      "Cannot find validator. This is probably a bug in remix-validated-form."
    );

    const result = await validator.validate(new FormData(formElement));
    if (result.error) get().setFieldErrors(result.error.fieldErrors);
    return result;
  },

  smartValidate: async ({ alwaysIncludeErrorsFromFields = [] } = {}) => {
    const formElement = get().formElement;
    invariant(
      formElement,
      "Cannot find reference to form. This is probably a bug in remix-validated-form."
    );

    const validator = get().formProps?.validator;
    invariant(
      validator,
      "Cannot find validator. This is probably a bug in remix-validated-form."
    );

    await Promise.all(
      alwaysIncludeErrorsFromFields.map((field) =>
        get().controlledFields.awaitValueUpdate?.(field)
      )
    );

    const validationResult = await validator.validate(
      new FormData(formElement)
    );
    if (!validationResult.error) {
      // Only update the field errors if it hasn't changed
      const hadErrors = Object.keys(get().fieldErrors).length > 0;
      if (hadErrors) get().setFieldErrors({});
      return validationResult;
    }

    const {
      error: { fieldErrors },
    } = validationResult;
    const errorFields = new Set<string>();
    const incomingErrors = new Set<string>();
    const prevErrors = new Set<string>();

    Object.keys(fieldErrors).forEach((field) => {
      errorFields.add(field);
      incomingErrors.add(field);
    });

    Object.keys(get().fieldErrors).forEach((field) => {
      errorFields.add(field);
      prevErrors.add(field);
    });

    const fieldsToUpdate = new Set<string>();
    const fieldsToDelete = new Set<string>();

    errorFields.forEach((field) => {
      // If an error has been cleared, remove it.
      if (!incomingErrors.has(field)) {
        fieldsToDelete.add(field);
        return;
      }

      // If an error has changed, we should update it.
      if (prevErrors.has(field) && incomingErrors.has(field)) {
        // Only update if the error has changed to avoid unnecessary rerenders
        if (fieldErrors[field] !== get().fieldErrors[field])
          fieldsToUpdate.add(field);
        return;
      }

      // If the error is always included, then we should update it.
      if (alwaysIncludeErrorsFromFields.includes(field)) {
        fieldsToUpdate.add(field);
        return;
      }

      // If the error is new, then only update if the field has been touched
      // or if the form has been submitted
      if (!prevErrors.has(field)) {
        const fieldTouched = get().touchedFields[field];
        const formHasBeenSubmitted = get().hasBeenSubmitted;
        if (fieldTouched || formHasBeenSubmitted) fieldsToUpdate.add(field);
        return;
      }
    });

    if (fieldsToDelete.size === 0 && fieldsToUpdate.size === 0) {
      return { ...validationResult, error: { fieldErrors: get().fieldErrors } };
    }

    set((state) => {
      fieldsToDelete.forEach((field) => {
        delete state.fieldErrors[field];
      });

      fieldsToUpdate.forEach((field) => {
        state.fieldErrors[field] = fieldErrors[field];
      });
    });

    return { ...validationResult, error: { fieldErrors: get().fieldErrors } };
  },

  submit: () => {
    const formElement = get().formElement;
    invariant(
      formElement,
      "Cannot find reference to form. This is probably a bug in remix-validated-form."
    );

    requestSubmit(formElement);
  },

  getValues: () => new FormData(get().formElement ?? undefined),

  resetFormElement: () => get().formElement?.reset(),

  controlledFields: {
    values: {},
    refCounts: {},
    valueUpdatePromises: {},
    valueUpdateResolvers: {},

    register: (fieldName) => {
      set((state) => {
        const current = state.controlledFields.refCounts[fieldName] ?? 0;
        state.controlledFields.refCounts[fieldName] = current + 1;
      });
    },
    unregister: (fieldName) => {
      // For this helper in particular, we may run into a case where state is undefined.
      // When the whole form unmounts, the form state may be cleaned up before the fields are.
      if (get() === null || get() === undefined) return;
      set((state) => {
        const current = state.controlledFields.refCounts[fieldName] ?? 0;
        if (current > 1) {
          state.controlledFields.refCounts[fieldName] = current - 1;
          return;
        }

        const isNested = Object.keys(state.controlledFields.refCounts).some(
          (key) => fieldName.startsWith(key) && key !== fieldName
        );

        // When nested within a field array, we should leave resetting up to the field array
        if (!isNested) {
          setPath(
            state.controlledFields.values,
            fieldName,
            getPath(state.formProps?.defaultValues, fieldName)
          );
          setPath(
            state.currentDefaultValues,
            fieldName,
            getPath(state.formProps?.defaultValues, fieldName)
          );
        }

        delete state.controlledFields.refCounts[fieldName];
      });
    },
    getValue: (fieldName) => getPath(get().controlledFields.values, fieldName),
    setValue: (fieldName, value) => {
      set((state) => {
        setPath(state.controlledFields.values, fieldName, value);
      });
      get().controlledFields.kickoffValueUpdate(fieldName);
    },
    kickoffValueUpdate: (fieldName) => {
      const clear = () =>
        set((state) => {
          delete state.controlledFields.valueUpdateResolvers[fieldName];
          delete state.controlledFields.valueUpdatePromises[fieldName];
        });
      set((state) => {
        const promise = new Promise<void>((resolve) => {
          state.controlledFields.valueUpdateResolvers[fieldName] = resolve;
        }).then(clear);
        state.controlledFields.valueUpdatePromises[fieldName] = promise;
      });
    },

    awaitValueUpdate: async (fieldName) => {
      await get().controlledFields.valueUpdatePromises[fieldName];
    },

    array: {
      push: (fieldName, item) => {
        set((state) => {
          arrayUtil
            .getArray(state.controlledFields.values, fieldName)
            .push(item);
          arrayUtil.getArray(state.currentDefaultValues, fieldName).push(item);
          // New item added to the end, no need to update touched or error
        });
        get().controlledFields.kickoffValueUpdate(fieldName);
      },

      swap: (fieldName, indexA, indexB) => {
        set((state) => {
          arrayUtil.swap(
            arrayUtil.getArray(state.controlledFields.values, fieldName),
            indexA,
            indexB
          );
          arrayUtil.swap(
            arrayUtil.getArray(state.currentDefaultValues, fieldName),
            indexA,
            indexB
          );
          arrayUtil.mutateAsArray(fieldName, state.touchedFields, (array) =>
            arrayUtil.swap(array, indexA, indexB)
          );
          arrayUtil.mutateAsArray(fieldName, state.fieldErrors, (array) =>
            arrayUtil.swap(array, indexA, indexB)
          );
        });
        get().controlledFields.kickoffValueUpdate(fieldName);
      },

      move: (fieldName, from, to) => {
        set((state) => {
          arrayUtil.move(
            arrayUtil.getArray(state.controlledFields.values, fieldName),
            from,
            to
          );
          arrayUtil.move(
            arrayUtil.getArray(state.currentDefaultValues, fieldName),
            from,
            to
          );
          arrayUtil.mutateAsArray(fieldName, state.touchedFields, (array) =>
            arrayUtil.move(array, from, to)
          );
          arrayUtil.mutateAsArray(fieldName, state.fieldErrors, (array) =>
            arrayUtil.move(array, from, to)
          );
        });
        get().controlledFields.kickoffValueUpdate(fieldName);
      },
      insert: (fieldName, index, item) => {
        set((state) => {
          arrayUtil.insert(
            arrayUtil.getArray(state.controlledFields.values, fieldName),
            index,
            item
          );
          arrayUtil.insert(
            arrayUtil.getArray(state.currentDefaultValues, fieldName),
            index,
            item
          );
          // Even though this is a new item, we need to push around other items.
          arrayUtil.mutateAsArray(fieldName, state.touchedFields, (array) =>
            arrayUtil.insertEmpty(array, index)
          );
          arrayUtil.mutateAsArray(fieldName, state.fieldErrors, (array) =>
            arrayUtil.insertEmpty(array, index)
          );
        });
        get().controlledFields.kickoffValueUpdate(fieldName);
      },
      remove: (fieldName, index) => {
        set((state) => {
          arrayUtil.remove(
            arrayUtil.getArray(state.controlledFields.values, fieldName),
            index
          );
          arrayUtil.remove(
            arrayUtil.getArray(state.currentDefaultValues, fieldName),
            index
          );
          arrayUtil.mutateAsArray(fieldName, state.touchedFields, (array) =>
            arrayUtil.remove(array, index)
          );
          arrayUtil.mutateAsArray(fieldName, state.fieldErrors, (array) =>
            arrayUtil.remove(array, index)
          );
        });
        get().controlledFields.kickoffValueUpdate(fieldName);
      },
      pop: (fieldName) => {
        set((state) => {
          arrayUtil.getArray(state.controlledFields.values, fieldName).pop();
          arrayUtil.getArray(state.currentDefaultValues, fieldName).pop();
          arrayUtil.mutateAsArray(fieldName, state.touchedFields, (array) =>
            array.pop()
          );
          arrayUtil.mutateAsArray(fieldName, state.fieldErrors, (array) =>
            array.pop()
          );
        });
        get().controlledFields.kickoffValueUpdate(fieldName);
      },
      unshift: (fieldName, value) => {
        set((state) => {
          arrayUtil
            .getArray(state.controlledFields.values, fieldName)
            .unshift(value);
          arrayUtil
            .getArray(state.currentDefaultValues, fieldName)
            .unshift(value);
          arrayUtil.mutateAsArray(fieldName, state.touchedFields, (array) =>
            arrayUtil.insertEmpty(array, 0)
          );
          arrayUtil.mutateAsArray(fieldName, state.fieldErrors, (array) =>
            arrayUtil.insertEmpty(array, 0)
          );
        });
      },
      replace: (fieldName, index, item) => {
        set((state) => {
          arrayUtil.replace(
            arrayUtil.getArray(state.controlledFields.values, fieldName),
            index,
            item
          );
          arrayUtil.replace(
            arrayUtil.getArray(state.currentDefaultValues, fieldName),
            index,
            item
          );
          arrayUtil.mutateAsArray(fieldName, state.touchedFields, (array) =>
            arrayUtil.replace(array, index, item)
          );
          arrayUtil.mutateAsArray(fieldName, state.fieldErrors, (array) =>
            arrayUtil.replace(array, index, item)
          );
        });
        get().controlledFields.kickoffValueUpdate(fieldName);
      },
    },
  },
});

export const useRootFormStore = create<FormStoreState>()(
  immer((set, get) => ({
    forms: {},
    form: (formId) => {
      return get().forms[formId] ?? defaultFormState;
    },
    cleanupForm: (formId: InternalFormId) => {
      set((state) => {
        delete state.forms[formId];
      });
    },
    registerForm: (formId: InternalFormId) => {
      if (get().forms[formId]) return;
      set((state) => {
        state.forms[formId] = createFormState(
          (setter) => set((state) => setter(state.forms[formId])),
          () => get().forms[formId]
        ) as WritableDraft<FormState>;
      });
    },
  }))
);
