import { nanoid } from "nanoid";
import React, { useCallback, useMemo, useRef } from "react";
import invariant from "tiny-invariant";
import type { InternalFormContextValue } from "../formContext";
import {
  useFieldDefaultValue,
  useFieldError,
  useInternalFormContext,
  useInternalHasBeenSubmitted,
  useSmartValidate,
} from "../hooks";
import * as arrayUtil from "./arrayUtil";
import { useRegisterControlledField } from "./controlledFields";
import { useFormStore } from "./storeHooks";

export type FieldArrayValidationBehavior = "onChange" | "onSubmit";

export type FieldArrayValidationBehaviorOptions = {
  initial: FieldArrayValidationBehavior;
  whenSubmitted: FieldArrayValidationBehavior;
};

export type FieldArrayItem<T> = {
  /**
   * The default value of the item.
   * This does not update as the field is changed by the user.
   */
  defaultValue: T;
  /**
   * A unique key for the item.
   * Use this as the key prop when rendering the item.
   */
  key: string;
};

const useInternalFieldArray = (
  context: InternalFormContextValue,
  field: string,
  validationBehavior?: Partial<FieldArrayValidationBehaviorOptions>
) => {
  const value = useFieldDefaultValue(field, context);
  useRegisterControlledField(context, field);
  const hasBeenSubmitted = useInternalHasBeenSubmitted(context.formId);
  const validateField = useSmartValidate(context.formId);
  const error = useFieldError(field, context);

  const resolvedValidationBehavior: FieldArrayValidationBehaviorOptions = {
    initial: "onSubmit",
    whenSubmitted: "onChange",
    ...validationBehavior,
  };

  const behavior = hasBeenSubmitted
    ? resolvedValidationBehavior.whenSubmitted
    : resolvedValidationBehavior.initial;

  const maybeValidate = useCallback(() => {
    if (behavior === "onChange") {
      validateField({ alwaysIncludeErrorsFromFields: [field] });
    }
  }, [behavior, field, validateField]);

  invariant(
    value === undefined || value === null || Array.isArray(value),
    `FieldArray: defaultValue value for ${field} must be an array, null, or undefined`
  );

  const arr = useFormStore(
    context.formId,
    (state) => state.controlledFields.array
  );

  const arrayValue = useMemo<unknown[]>(() => value ?? [], [value]);
  const keyRef = useRef<string[]>([]);

  // If the lengths don't match up it means one of two things
  // 1. The array has been modified outside of this hook
  // 2. We're initializing the array
  if (keyRef.current.length !== arrayValue.length) {
    keyRef.current = arrayValue.map(() => nanoid());
  }

  const helpers = useMemo(
    () => ({
      push: (item: any) => {
        arr.push(field, item);
        keyRef.current.push(nanoid());
        maybeValidate();
      },
      swap: (indexA: number, indexB: number) => {
        arr.swap(field, indexA, indexB);
        arrayUtil.swap(keyRef.current, indexA, indexB);
        maybeValidate();
      },
      move: (from: number, to: number) => {
        arr.move(field, from, to);
        arrayUtil.move(keyRef.current, from, to);
        maybeValidate();
      },
      insert: (index: number, value: any) => {
        arr.insert(field, index, value);
        arrayUtil.insert(keyRef.current, index, nanoid());
        maybeValidate();
      },
      unshift: (value: any) => {
        arr.unshift(field, value);
        keyRef.current.unshift(nanoid());
        maybeValidate();
      },
      remove: (index: number) => {
        arr.remove(field, index);
        arrayUtil.remove(keyRef.current, index);
        maybeValidate();
      },
      pop: () => {
        arr.pop(field);
        keyRef.current.pop();
        maybeValidate();
      },
      replace: (index: number, value: any) => {
        arr.replace(field, index, value);
        keyRef.current[index] = nanoid();
        maybeValidate();
      },
    }),
    [arr, field, maybeValidate]
  );

  const valueWithKeys = useMemo(() => {
    const result: { defaultValue: any; key: string }[] = [];
    arrayValue.forEach((item, index) => {
      result[index] = {
        key: keyRef.current[index],
        defaultValue: item,
      };
    });
    return result;
  }, [arrayValue]);

  return [valueWithKeys, helpers, error] as const;
};

export type FieldArrayHelpers<Item = any> = {
  push: (item: Item) => void;
  swap: (indexA: number, indexB: number) => void;
  move: (from: number, to: number) => void;
  insert: (index: number, value: Item) => void;
  unshift: (value: Item) => void;
  remove: (index: number) => void;
  pop: () => void;
  replace: (index: number, value: Item) => void;
};

export type UseFieldArrayOptions = {
  formId?: string;
  validationBehavior?: Partial<FieldArrayValidationBehaviorOptions>;
};

export function useFieldArray<Item = any>(
  name: string,
  { formId, validationBehavior }: UseFieldArrayOptions = {}
) {
  const context = useInternalFormContext(formId, "FieldArray");

  return useInternalFieldArray(context, name, validationBehavior) as [
    items: FieldArrayItem<Item>[],
    helpers: FieldArrayHelpers,
    error: string | undefined
  ];
}

export type FieldArrayProps<Item> = {
  name: string;
  children: (
    items: FieldArrayItem<Item>[],
    helpers: FieldArrayHelpers<Item>,
    error: string | undefined
  ) => React.ReactNode;
  formId?: string;
  validationBehavior?: FieldArrayValidationBehaviorOptions;
};

export function FieldArray<Item = any>({
  name,
  children,
  formId,
  validationBehavior,
}: FieldArrayProps<Item>) {
  const context = useInternalFormContext(formId, "FieldArray");
  const [value, helpers, error] = useInternalFieldArray(
    context,
    name,
    validationBehavior
  );
  return <>{children(value, helpers, error)}</>;
}
