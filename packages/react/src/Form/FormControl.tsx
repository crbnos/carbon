import type { ComponentProps, ForwardedRef } from "react";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useId,
  useState,
} from "react";
import { cn } from "../utils/cn";
import { dataAttr } from "../utils/dom";
import { mergeRefs } from "../utils/react";

export interface FormControlOptions {
  /**
   * If `true`, the form control will be required. This has 2 side effects:
   * - The `FormLabel` will show a required indicator
   * - The form element (e.g, Input) will have `aria-required` set to `true`
   *
   * @default false
   */
  isRequired?: boolean;
  /**
   * If `true`, the form control will be disabled. This has 2 side effects:
   * - The `FormLabel` will have `data-disabled` attribute
   * - The form element (e.g, Input) will be disabled
   *
   * @default false
   */
  isDisabled?: boolean;
  /**
   * If `true`, the form control will be invalid. This has 2 side effects:
   * - The `FormLabel` and `FormErrorIcon` will have `data-invalid` set to `true`
   * - The form element (e.g, Input) will have `aria-invalid` set to `true`
   *
   * @default false
   */
  isInvalid?: boolean;
  /**
   * If `true`, the form control will be readonly
   *
   * @default false
   */
  isReadOnly?: boolean;
}

interface FormControlContextType extends FormControlOptions {
  /**
   * The label text used to inform users as to what information is
   * requested for a text field.
   */
  label?: string;
  /**
   * The custom `id` to use for the form control. This is passed directly to the form element (e.g, Input).
   * - The form element (e.g. Input) gets the `id`
   * - The form label id: `form-label-${id}`
   * - The form error text id: `form-error-text-${id}`
   * - The form helper text id: `form-helper-text-${id}`
   */
  id?: string;
}

type FormControlProviderContext = Omit<
  ReturnType<typeof useFormControlProvider>,
  "getRootProps" | "htmlProps"
>;

const FormControlContext = createContext<FormControlProviderContext | null>(
  null
);

export const useFormControlContext = () => {
  const ctx = useContext(FormControlContext);

  if (!ctx) {
    throw Error("useFormControlContext() must be used inside of a FormControl");
  }

  return ctx;
};

function useFormControlProvider(props: FormControlContextType) {
  const {
    id: idProp,
    isRequired,
    isInvalid,
    isDisabled,
    isReadOnly,
    ...htmlProps
  } = props;

  // Generate all the required ids
  const uuid = useId();
  const id = idProp || `field-${uuid}`;

  const labelId = `${id}-label`;
  const feedbackId = `${id}-feedback`;
  const helpTextId = `${id}-helptext`;

  /**
   * Track whether the `FormErrorMessage` has been rendered.
   * We use this to append its id the `aria-describedby` of the `input`.
   */
  const [hasFeedbackText, setHasFeedbackText] = useState(false);

  /**
   * Track whether the `FormHelperText` has been rendered.
   * We use this to append its id the `aria-describedby` of the `input`.
   */
  const [hasHelpText, setHasHelpText] = useState(false);

  // Track whether the form element (e.g, `input`) has focus.
  const [isFocused, setFocus] = useState(false);

  const getHelpTextProps = useCallback(
    (
      props: ComponentProps<"div"> & FormControlOptions = {},
      forwardedRef: ForwardedRef<HTMLDivElement> | null = null
    ) => ({
      id: helpTextId,
      ...props,
      /**
       * Notify the field context when the help text is rendered on screen,
       * so we can apply the correct `aria-describedby` to the field (e.g. input, textarea).
       */
      ref: mergeRefs(forwardedRef, (node) => {
        if (!node) return;
        setHasHelpText(true);
      }),
    }),
    [helpTextId]
  );

  const getLabelProps = useCallback(
    (
      props: ComponentProps<"label"> & FormControlOptions = {},
      forwardedRef: ForwardedRef<HTMLLabelElement> | null = null
    ) => ({
      ...props,
      ref: forwardedRef,
      "data-focus": dataAttr(isFocused),
      "data-disabled": dataAttr(isDisabled),
      "data-invalid": dataAttr(isInvalid),
      "data-readonly": dataAttr(isReadOnly),
      id: props.id !== undefined ? props.id : labelId,
      htmlFor: id,
    }),
    [id, isDisabled, isFocused, isInvalid, isReadOnly, labelId]
  );

  const getErrorMessageProps = useCallback(
    (
      props: ComponentProps<"div"> & FormControlOptions = {},
      forwardedRef: ForwardedRef<HTMLDivElement> | null = null
    ) => ({
      id: feedbackId,
      ...props,
      /**
       * Notify the field context when the error message is rendered on screen,
       * so we can apply the correct `aria-describedby` to the field (e.g. input, textarea).
       */
      ref: mergeRefs(forwardedRef, (node) => {
        if (!node) return;
        setHasFeedbackText(true);
      }),
      "aria-live": "polite" as const,
    }),
    [feedbackId]
  );

  const getRootProps = useCallback(
    (
      props: FormControlOptions = {},
      forwardedRef: ForwardedRef<HTMLDivElement> | null = null
    ) => ({
      ...props,
      ...htmlProps,
      ref: forwardedRef,
      role: "group",
      "data-focus": dataAttr(isFocused),
      "data-disabled": dataAttr(isDisabled),
      "data-invalid": dataAttr(isInvalid),
      "data-readonly": dataAttr(isReadOnly),
    }),
    [htmlProps, isDisabled, isFocused, isInvalid, isReadOnly]
  );

  return {
    isRequired: !!isRequired,
    isInvalid: !!isInvalid,
    isReadOnly: !!isReadOnly,
    isDisabled: !!isDisabled,
    isFocused: !!isFocused,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    hasFeedbackText,
    setHasFeedbackText,
    hasHelpText,
    setHasHelpText,
    id,
    labelId,
    feedbackId,
    helpTextId,
    htmlProps,
    getHelpTextProps,
    getErrorMessageProps,
    getRootProps,
    getLabelProps,
  };
}

export interface FormControlProps
  extends ComponentProps<"div">,
    FormControlContextType {}

/**
 * FormControl provides context such as
 * `isInvalid`, `isDisabled`, and `isRequired` to form elements.
 *
 * This is commonly used in form elements such as `input`,
 * `select`, `textarea`, etc.
 *
 */
export const FormControl = forwardRef<HTMLDivElement, FormControlProps>(
  function FormControl(props, ref) {
    const {
      getRootProps,
      htmlProps: _,
      ...context
    } = useFormControlProvider(props);

    return (
      <FormControlContext.Provider value={context}>
        <div
          {...getRootProps({}, ref)}
          className={cn("flex flex-col w-full gap-y-2", props.className)}
        />
      </FormControlContext.Provider>
    );
  }
);

FormControl.displayName = "FormControl";

export interface FormHelperTextProps extends ComponentProps<"div"> {}

/**
 * FormHelperText
 *
 * Assistive component that conveys additional guidance
 * about the field, such as how it will be used and what
 * types in values should be provided.
 */
export const FormHelperText = forwardRef<HTMLDivElement, FormHelperTextProps>(
  function FormHelperText(props, ref) {
    const field = useFormControlContext();

    return (
      <div
        {...field?.getHelpTextProps(props, ref)}
        className={cn(
          "font-normal text-sm text-muted-foreground",
          props.className
        )}
      />
    );
  }
);

FormHelperText.displayName = "FormHelperText";
