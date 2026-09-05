import { useIsomorphicLayoutEffect } from "@carbon/react";
import type React from "react";
import type { ComponentProps, FormEvent, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FetcherWithComponents,
  FormEncType,
  FormMethod,
  SubmitOptions
} from "react-router";
import { Form as ReactRouterForm, useSubmit } from "react-router";
import * as R from "remeda";
import type { z } from "zod";
import { useIsSubmitting, useIsValid } from "./hooks";
import {
  type AdditionalValidateFunction,
  AdditionalValidatorsContext
} from "./internal/AdditionalValidators";
import { FORM_ID_FIELD } from "./internal/constants";
import type { InternalFormContextValue } from "./internal/formContext";
import { InternalFormContext } from "./internal/formContext";
import { FormStateContext } from "./internal/formStateContext";
import {
  useDefaultValuesFromLoader,
  useErrorResponseForForm,
  useHasActiveFormSubmit,
  useSetFieldErrors
} from "./internal/hooks";
import type { MultiValueMap } from "./internal/MultiValueMap";
import { useMultiValueMap } from "./internal/MultiValueMap";
import type { SyncedFormProps } from "./internal/state/createFormStore";
import { useRootFormStore } from "./internal/state/createFormStore";
import { useFormStore } from "./internal/state/storeHooks";
import { useSubmitComplete } from "./internal/submissionCallbacks";
import { mergeRefs, useDeepEqualsMemo } from "./internal/util";
import type { FieldErrors } from "./validation/types";
import { validator as zodValidator } from "./zod";

type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

type SubactionData<
  DataType,
  Subaction extends string | undefined
> = DataType & { subaction: Subaction };

// Not all validation libraries support encoding a literal value in the schema type (e.g. yup).
// This condition here allows us to provide strictness for users who are using a validation library that does support it,
// but also allows us to support users who are using a validation library that doesn't support it.
type DataForSubaction<
  DataType,
  Subaction extends string | undefined
> = Subaction extends string // Not all validation libraries support encoding a literal value in the schema type.
  ? SubactionData<DataType, Subaction> extends undefined
    ? DataType
    : SubactionData<DataType, Subaction>
  : DataType;

export type FormProps<DataType, Subaction extends string | undefined> = {
  /**
   * A `Validator` object that describes how to validate the form.
   */
  validator: z.Schema<DataType> | z.ZodEffects<any> | z.ZodObject<any>;
  /**
   * A submit callback that gets called when the form is submitted
   * after all validations have been run.
   */
  onSubmit?: (
    data: DataForSubaction<DataType, Subaction>,
    event: React.FormEvent<HTMLFormElement>
  ) => void | Promise<void>;

  /**
   * A callback that fires after the promise returned by fetcher completes.
   * As the default useFetcher doesn't support promises - we have a custom useAsyncFetcher hook.
   */
  onAfterSubmit?: () => void | Promise<void>;
  /**
   * Allows you to provide a `fetcher` from React Router's `useFetcher` hook.
   * The form will use the fetcher for loading states, action data, etc
   * instead of the default form action.
   */
  fetcher?: FetcherWithComponents<any>;
  /**
   * Accepts an object of default values for the form
   * that will automatically be propagated to the form fields via `useField`.
   */
  defaultValues?: DeepPartial<DataForSubaction<DataType, Subaction>>;
  /**
   * A ref to the form element.
   */
  formRef?: React.RefObject<HTMLFormElement>;
  /**
   * An optional sub-action to use for the form.
   * Setting a value here will cause the form to be submitted with an extra `subaction` value.
   * This can be useful when there are multiple forms on the screen handled by the same action.
   */
  subaction?: Subaction;
  /**
   * Reset the form to the default values after the form has been successfully submitted.
   * This is useful if you want to submit the same form multiple times,
   * and don't redirect in-between submissions.
   */
  resetAfterSubmit?: boolean;
  /**
   * Normally, the first invalid input will be focused when the validation fails on form submit.
   * Set this to `false` to disable this behavior.
   */
  disableFocusOnError?: boolean;
  /**
   * When true, all nested form fields will be disabled,
   * ignoring their individual `isDisabled` props.
   */
  isDisabled?: boolean;
  /**
   * When true, all nested form fields will be read-only,
   * ignoring their individual `isReadOnly` props.
   */
  isReadOnly?: boolean;
} & Omit<ComponentProps<typeof ReactRouterForm>, "onSubmit">;

const getDataFromForm = (el: HTMLFormElement) => new FormData(el);

function nonNull<T>(value: T | null | undefined): value is T {
  return value !== null;
}

const scrollIntoView = (element?: HTMLElement) => {
  if (!element) {
    return;
  }

  // try the container route first as scrollIntoView sometimes have side effects by moving the wrong container
  const container = element.closest(".overflow-hidden > .h-full");
  if (container) {
    // Get the position of the target relative to the container
    const offsetTop = element.offsetTop;

    // Scroll the container only
    container.scrollTo({
      top: offsetTop,
      behavior: "smooth" // use 'auto' if you don't want smooth scrolling
    });
  } else {
    element.scrollIntoView({ behavior: "smooth", block: "center" });
  }
};

const focusFirstInvalidInput = (
  fieldErrors: FieldErrors,
  customFocusHandlers: MultiValueMap<string, () => void>,
  formElement: HTMLFormElement
) => {
  const namesInOrder = [...formElement.elements]
    .map((el) => {
      const input = el instanceof RadioNodeList ? el[0] : el;
      if (input instanceof HTMLElement && "name" in input)
        return (input as any).name;
      return null;
    })
    .filter(nonNull)
    .filter((name) => name in fieldErrors);
  const uniqueNamesInOrder = R.uniq(namesInOrder);

  for (const fieldName of uniqueNamesInOrder) {
    if (customFocusHandlers.has(fieldName)) {
      customFocusHandlers.getAll(fieldName).forEach((handler) => {
        handler();
      });
      break;
    }

    const elem = formElement.elements.namedItem(fieldName);
    if (!elem) continue;

    if (elem instanceof RadioNodeList) {
      const selectedRadio =
        [...elem]
          .filter(
            (item): item is HTMLInputElement => item instanceof HTMLInputElement
          )
          .find((item) => item.value === elem.value) ?? elem[0];
      if (selectedRadio && selectedRadio instanceof HTMLInputElement) {
        selectedRadio.focus();
        scrollIntoView(selectedRadio);
        break;
      }
    }

    if (elem instanceof HTMLElement) {
      if (elem instanceof HTMLInputElement && elem.type === "hidden") {
        scrollIntoView(elem.parentElement ?? undefined);
        continue;
      }

      elem.focus();
      scrollIntoView(elem);
      break;
    }
  }
};

const useFormId = (providedId?: string): string | symbol => {
  // We can use a `Symbol` here because we only use it after hydration
  const [symbolId] = useState(() => Symbol("form-id"));
  return providedId ?? symbolId;
};

/**
 * Use a component to access the state so we don't cause
 * any extra rerenders of the whole form.
 */
const FormResetter = ({
  resetAfterSubmit,
  formRef,
  onComplete
}: {
  resetAfterSubmit: boolean;
  formRef: RefObject<HTMLFormElement>;
  onComplete?: () => void;
}) => {
  const isSubmitting = useIsSubmitting();
  const isValid = useIsValid();
  useSubmitComplete(isSubmitting, () => {
    typeof onComplete === "function" && onComplete();
    if (isValid && resetAfterSubmit) {
      formRef.current?.reset();
    }
  });
  return null;
};

function formEventProxy<T extends object>(event: T): T {
  let defaultPrevented = false;
  return new Proxy(event, {
    get: (target, prop) => {
      if (prop === "preventDefault") {
        return () => {
          defaultPrevented = true;
        };
      }

      if (prop === "defaultPrevented") {
        return defaultPrevented;
      }

      return target[prop as keyof T];
    }
  }) as T;
}

type HTMLSubmitEvent = React.BaseSyntheticEvent<
  SubmitEvent,
  Event,
  HTMLFormElement
>;

type HTMLFormSubmitter = HTMLButtonElement | HTMLInputElement;

/**
 * The primary form component of `remix-validated-form`.
 */
export function ValidatedForm<
  DataType extends { [fieldName: string]: any },
  Subaction extends string | undefined
>({
  validator,
  onSubmit,
  onAfterSubmit,
  children,
  fetcher,
  action,
  defaultValues: unMemoizedDefaults,
  formRef: formRefProp,
  onReset,
  subaction,
  resetAfterSubmit = false,
  disableFocusOnError,
  isDisabled = false,
  isReadOnly = false,
  method,
  replace,
  id,
  preventScrollReset,
  relative,
  encType,
  ...rest
}: FormProps<DataType, Subaction>) {
  const formId = useFormId(id);
  const providedDefaultValues = useDeepEqualsMemo(unMemoizedDefaults);
  const contextValue = useMemo<InternalFormContextValue>(
    () => ({
      formId,
      action,
      subaction,
      defaultValuesProp: providedDefaultValues,
      fetcher,
      validatorSchema: validator
    }),
    [action, fetcher, formId, providedDefaultValues, subaction, validator]
  );
  const formStateValue = useMemo(
    () => ({ isDisabled, isReadOnly }),
    [isDisabled, isReadOnly]
  );
  const backendError = useErrorResponseForForm(contextValue);
  const backendDefaultValues = useDefaultValuesFromLoader(contextValue);
  const hasActiveSubmission = useHasActiveFormSubmit(contextValue);
  const formRef = useRef<HTMLFormElement>(null);
  const Form = fetcher?.Form ?? ReactRouterForm;

  const submit = useSubmit();
  const setFieldErrors = useSetFieldErrors(formId);
  const setFieldError = useFormStore(formId, (state) => state.setFieldError);
  const reset = useFormStore(formId, (state) => state.reset);
  const startSubmit = useFormStore(formId, (state) => state.startSubmit);
  const endSubmit = useFormStore(formId, (state) => state.endSubmit);
  const syncFormProps = useFormStore(formId, (state) => state.syncFormProps);
  const setFormElementInState = useFormStore(
    formId,
    (state) => state.setFormElement
  );
  const cleanupForm = useRootFormStore((state) => state.cleanupForm);
  const registerForm = useRootFormStore((state) => state.registerForm);

  const additionalValidatorsRef = useRef(
    new Map<string, AdditionalValidateFunction>()
  );
  const additionalValidatorsContextValue = useMemo(
    () => ({
      register: (id: string, fn: AdditionalValidateFunction) => {
        additionalValidatorsRef.current.set(id, fn);
      },
      unregister: (id: string) => {
        additionalValidatorsRef.current.delete(id);
      }
    }),
    []
  );

  const customFocusHandlers = useMultiValueMap<string, () => void>();
  const registerReceiveFocus: SyncedFormProps["registerReceiveFocus"] =
    useCallback(
      (fieldName, handler) => {
        customFocusHandlers().add(fieldName, handler);
        return () => {
          customFocusHandlers().remove(fieldName, handler);
        };
      },
      [customFocusHandlers]
    );

  // TODO: all these hooks running at startup cause extra, unnecessary renders
  // There must be a nice way to avoid this.
  useIsomorphicLayoutEffect(() => {
    registerForm(formId);
    return () => cleanupForm(formId);
  }, [cleanupForm, formId, registerForm]);

  useIsomorphicLayoutEffect(() => {
    syncFormProps({
      action,
      defaultValues: providedDefaultValues ?? backendDefaultValues ?? {},
      subaction,
      registerReceiveFocus,
      validator: zodValidator(validator)
    });
  }, [
    action,
    providedDefaultValues,
    registerReceiveFocus,
    subaction,
    syncFormProps,
    backendDefaultValues,
    validator
  ]);

  useIsomorphicLayoutEffect(() => {
    setFormElementInState(formRef.current);
  }, [setFormElementInState]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    setFieldErrors(backendError?.fieldErrors ?? {});
    if (!disableFocusOnError && backendError?.fieldErrors) {
      focusFirstInvalidInput(
        backendError.fieldErrors,
        customFocusHandlers(),
        formRef.current!
      );
    }
  }, [
    backendError?.fieldErrors,
    customFocusHandlers,
    disableFocusOnError,
    setFieldErrors,
    setFieldError
  ]);

  useSubmitComplete(hasActiveSubmission, () => {
    endSubmit();
  });

  const handleSubmit = async (
    e: FormEvent<HTMLFormElement>,
    target: typeof e.currentTarget,
    nativeEvent: HTMLSubmitEvent["nativeEvent"]
  ) => {
    startSubmit();
    const submitter = nativeEvent.submitter as HTMLFormSubmitter | null;

    const isValidSubmit = submitter?.form === target;
    if (!isValidSubmit) {
      endSubmit();
      return;
    }

    const formMethod = (submitter?.formMethod as FormMethod) || method;
    const formData = getDataFromForm(target);
    if (submitter?.name) {
      formData.append(submitter.name, submitter.value);
    }

    const result = await zodValidator(validator).validate(formData);

    const additionalErrors: Record<string, string> = {};
    additionalValidatorsRef.current.forEach((validate) => {
      const errors = validate(formData);
      for (const [key, value] of Object.entries(errors)) {
        if (value !== undefined) additionalErrors[key] = value;
      }
    });
    const hasAdditionalErrors = Object.keys(additionalErrors).length > 0;

    if (result.error || hasAdditionalErrors) {
      const fieldErrors = {
        ...(result.error?.fieldErrors ?? {}),
        ...additionalErrors
      };
      setFieldErrors(fieldErrors);
      endSubmit();
      if (!disableFocusOnError) {
        focusFirstInvalidInput(
          fieldErrors,
          customFocusHandlers(),
          formRef.current!
        );
      }
    } else {
      setFieldErrors({});
      const eventProxy = formEventProxy(e);
      await onSubmit?.(result.data as any, eventProxy);
      if (eventProxy.defaultPrevented) {
        endSubmit();
        return;
      }

      const opts: SubmitOptions = {
        method: formMethod,
        replace,
        preventScrollReset,
        relative,
        action,
        encType: encType as FormEncType | undefined
      };

      // We deviate from the React Routers code here a bit because of our async submit.
      // In React Routers's `FormImpl`, they use `event.currentTarget` to get the form,
      // but we already have the form in `formRef.current` so we can just use that.
      // If we use `event.currentTarget` here, it will break because `currentTarget`
      // will have changed since the start of the submission.
      let value: any = fetcher
        ? fetcher.submit(formData, opts)
        : submit(formData, opts);

      if (value instanceof Promise) {
        await value;
      }
    }
  };

  return (
    <Form
      ref={mergeRefs([formRef, formRefProp])}
      {...rest}
      id={id}
      action={action}
      method={method}
      encType={encType}
      preventScrollReset={preventScrollReset}
      relative={relative}
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit(
          e,
          e.currentTarget,
          (e as unknown as HTMLSubmitEvent).nativeEvent
        );
      }}
      onReset={(event) => {
        onReset?.(event);
        if (event.defaultPrevented) return;
        reset();
      }}
    >
      <AdditionalValidatorsContext.Provider
        value={additionalValidatorsContextValue}
      >
        <InternalFormContext.Provider value={contextValue}>
          <FormStateContext.Provider value={formStateValue}>
            <>
              <FormResetter
                formRef={formRef}
                resetAfterSubmit={resetAfterSubmit}
                onComplete={onAfterSubmit}
              />
              {subaction && (
                <input type="hidden" value={subaction} name="subaction" />
              )}
              {id && <input type="hidden" value={id} name={FORM_ID_FIELD} />}
              {children}
            </>
          </FormStateContext.Provider>
        </InternalFormContext.Provider>
      </AdditionalValidatorsContext.Provider>
    </Form>
  );
}
