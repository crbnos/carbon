// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComponentProps, ForwardedRef } from "react";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState
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

/**
 * The FormControl this element sits in, or `null` outside one. For controls
 * that are also used on their own, such as the select and combobox triggers.
 */
export const useOptionalFormControlContext = () =>
  useContext(FormControlContext);

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
   * How many `FormHelperText`s are on screen. Each registers when it mounts and
   * unregisters when it unmounts, so helper text that gives way to the error
   * message also leaves the control's `aria-describedby`.
   */
  const [helpTextCount, setHelpTextCount] = useState(0);
  const registerHelpText = useCallback(() => {
    setHelpTextCount((count) => count + 1);
    return () => setHelpTextCount((count) => count - 1);
  }, []);

  /**
   * The id of the rendered `FormLabel`, once it is on screen. Controls that
   * are not labelable elements (the select and combobox triggers) name
   * themselves with it through `aria-labelledby`.
   */
  const [renderedLabelId, setRenderedLabelId] = useState<string>();

  // Track whether the form element (e.g, `input`) has focus.
  const [isFocused, setFocus] = useState(false);

  const getHelpTextProps = useCallback(
    (
      props: ComponentProps<"div"> & FormControlOptions = {},
      forwardedRef: ForwardedRef<HTMLDivElement> | null = null
    ) => ({
      id: helpTextId,
      ...props,
      ref: forwardedRef
    }),
    [helpTextId]
  );

  const getLabelProps = useCallback(
    (
      props: ComponentProps<"label"> & FormControlOptions = {},
      forwardedRef: ForwardedRef<HTMLLabelElement> | null = null
    ) => ({
      ...props,
      ref: mergeRefs(forwardedRef, (node: HTMLLabelElement | null) => {
        if (!node) return;
        setRenderedLabelId(node.id);
      }),
      "data-focus": dataAttr(isFocused),
      "data-disabled": dataAttr(isDisabled),
      "data-invalid": dataAttr(isInvalid),
      "data-readonly": dataAttr(isReadOnly),
      id: props.id !== undefined ? props.id : labelId,
      // The field's own id when the caller names it: the form wrappers give
      // their input `id={name}` and pass `htmlFor={name}`.
      htmlFor: props.htmlFor ?? id
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
      "aria-live": "polite" as const
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
      "data-readonly": dataAttr(isReadOnly)
    }),
    // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
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
    hasHelpText: helpTextCount > 0,
    registerHelpText,
    renderedLabelId,
    id,
    labelId,
    feedbackId,
    helpTextId,
    htmlProps,
    getHelpTextProps,
    getErrorMessageProps,
    getRootProps,
    getLabelProps
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
        {/* Its own height, never the row's: a grid stretches a field to its
            tallest neighbour (one with helper text), and a growing child —
            the comboboxes' wrapper is `flex-grow` — would then fill that
            space and sit its input lower than the fields beside it. */}
        <div
          {...getRootProps({}, ref)}
          className={cn("flex flex-col w-full h-fit gap-y-2", props.className)}
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
    const { registerHelpText } = field;
    useEffect(() => registerHelpText(), [registerHelpText]);

    return (
      <div
        {...field?.getHelpTextProps(props, ref)}
        className={cn(
          "font-normal text-xs text-muted-foreground",
          props.className
        )}
      />
    );
  }
);

FormHelperText.displayName = "FormHelperText";
