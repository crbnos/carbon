// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCallback, useEffect } from "react";
import type { InternalFormContextValue } from "../formContext";
import { useFieldDefaultValue } from "../hooks";
import { useFormStore } from "./storeHooks";
import type { InternalFormId } from "./types";

export const useControlledFieldValue = (
  context: InternalFormContextValue,
  field: string
) => {
  const value = useFormStore(context.formId, (state) =>
    state.controlledFields.getValue(field)
  );
  const isFormHydrated = useFormStore(
    context.formId,
    (state) => state.isHydrated
  );
  const defaultValue = useFieldDefaultValue(field, context);

  return isFormHydrated ? value : defaultValue;
};

export const useRegisterControlledField = (
  context: InternalFormContextValue,
  field: string
) => {
  const resolveUpdate = useFormStore(
    context.formId,
    (state) => state.controlledFields.valueUpdateResolvers[field]
  );
  useEffect(() => {
    resolveUpdate?.();
  }, [resolveUpdate]);

  const register = useFormStore(
    context.formId,
    (state) => state.controlledFields.register
  );
  const unregister = useFormStore(
    context.formId,
    (state) => state.controlledFields.unregister
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    register(field);
    return () => unregister(field);
  }, [context.formId, field, register, unregister]);
};

export const useControllableValue = (
  context: InternalFormContextValue,
  field: string
) => {
  useRegisterControlledField(context, field);

  const setControlledFieldValue = useFormStore(
    context.formId,
    (state) => state.controlledFields.setValue
  );
  const setTouched = useFormStore(context.formId, (state) => state.setTouched);
  const defaultValue = useFieldDefaultValue(field, context);

  const setValue = useCallback(
    (value: unknown) => {
      setControlledFieldValue(field, value);
      if (value !== defaultValue) {
        setTouched(field, true);
      }
    },
    [field, setControlledFieldValue, setTouched, defaultValue]
  );

  const value = useControlledFieldValue(context, field);

  return [value, setValue] as const;
};

export const useUpdateControllableValue = (formId: InternalFormId) => {
  const setValue = useFormStore(
    formId,
    (state) => state.controlledFields.setValue
  );
  return useCallback(
    (field: string, value: unknown) => setValue(field, value),
    [setValue]
  );
};

export const useAwaitValue = (formId: InternalFormId) => {
  const awaitValue = useFormStore(
    formId,
    (state) => state.controlledFields.awaitValueUpdate
  );
  return useCallback((field: string) => awaitValue(field), [awaitValue]);
};
