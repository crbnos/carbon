import type { TermId } from "@carbon/glossary";
import type { InputProps } from "@carbon/react";
import {
  Button,
  FormControl,
  FormErrorMessage,
  FormLabel,
  HStack,
  IconButton,
  Input as InputBase,
  LabelWithHelp,
  VStack
} from "@carbon/react";
import { forwardRef, useRef } from "react";
import { flushSync } from "react-dom";
import { IoMdAdd, IoMdClose } from "react-icons/io";
import { useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";
import { useFieldArray } from "../internal/state/fieldArray";

type FormArrayProps = InputProps & {
  name: string;
  label?: string;
  termId?: TermId;
  isRequired?: boolean;
};

const Array = forwardRef<HTMLInputElement, FormArrayProps>(
  (
    {
      name,
      label,
      termId,
      isRequired,
      isDisabled: isDisabledProp,
      isReadOnly: isReadOnlyProp,
      ...rest
    },
    ref
  ) => {
    const { isOptional: fieldIsOptional } = useField(name);
    const listRef = useRef<HTMLDivElement>(null);
    const [items, { push, remove }, error] = useFieldArray<string>(name);
    const formState = useFormStateContext();
    const isDisabled = formState.isDisabled || isDisabledProp;
    const isReadOnly = formState.isReadOnly || isReadOnlyProp;
    const resolvedIsOptional = isRequired ? false : (fieldIsOptional ?? false);
    const onAdd = () => {
      flushSync(() => {
        push("");
      });
      const lastInput = listRef.current?.querySelectorAll("input")?.[
        items.length
      ] as HTMLInputElement | undefined;
      lastInput?.focus();
    };

    return (
      <FormControl isInvalid={!!error} isRequired={isRequired}>
        {label && (
          <FormLabel htmlFor={`${name}`} isOptional={resolvedIsOptional}>
            <LabelWithHelp termId={termId}>{label}</LabelWithHelp>
          </FormLabel>
        )}
        <VStack className="mb-4" ref={listRef}>
          {items.map((item, index) => (
            <ArrayInput
              key={`${item}-${index}`}
              id={`${name}[${index}]`}
              name={`${name}[${index}]`}
              ref={index === 0 ? ref : undefined}
              onRemove={() => remove(index)}
              isDisabled={isDisabled}
              isReadOnly={isReadOnly}
              {...rest}
            />
          ))}
          <Button
            variant="secondary"
            leftIcon={<IoMdAdd />}
            onClick={onAdd}
            isDisabled={isDisabled || isReadOnly}
          >
            {items.length > 0 ? "Add another option" : "Add option"}
          </Button>
        </VStack>
        {error && <FormErrorMessage>{error}</FormErrorMessage>}
      </FormControl>
    );
  }
);

Array.displayName = "Array";

type ArrayInputProps = InputProps & {
  name: string;
  onRemove: () => void;
};

const ArrayInput = forwardRef<HTMLInputElement, ArrayInputProps>(
  ({ name, onRemove, isDisabled, isReadOnly, ...rest }, ref) => {
    const { getInputProps, error } = useField(name);

    return (
      <FormControl isInvalid={!!error} isRequired>
        <HStack className="w-full content-between">
          <InputBase
            ref={ref}
            {...getInputProps({
              id: name,
              ...rest
            })}
            isDisabled={isDisabled}
            isReadOnly={isReadOnly}
          />
          <IconButton
            variant="ghost"
            aria-label="Remove item"
            icon={<IoMdClose />}
            onClick={onRemove}
            isDisabled={isDisabled || isReadOnly}
          />
        </HStack>

        {error && <FormErrorMessage>{error}</FormErrorMessage>}
      </FormControl>
    );
  }
);

ArrayInput.displayName = "ArrayInput";

export default Array;
