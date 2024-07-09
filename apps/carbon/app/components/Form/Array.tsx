import type { InputProps } from "@carbon/react";
import {
  Button,
  FormControl,
  FormErrorMessage,
  FormLabel,
  HStack,
  IconButton,
  Input as InputBase,
  VStack,
} from "@carbon/react";
import { useField, useFieldArray } from "@carbon/remix-validated-form";
import { forwardRef, useRef } from "react";
import { IoMdAdd, IoMdClose } from "react-icons/io";

type FormArrayProps = InputProps & {
  name: string;
  label?: string;
  isRequired?: boolean;
};

const Array = forwardRef<HTMLInputElement, FormArrayProps>(
  ({ name, label, isRequired, ...rest }, ref) => {
    const listRef = useRef<HTMLDivElement>(null);
    const [items, { push, remove }, error] = useFieldArray<string>(name);
    const onAdd = () => {
      push("");
      const lastInput =
        listRef.current?.lastElementChild?.querySelector("input");
      lastInput?.focus();
    };

    return (
      <FormControl isInvalid={!!error} isRequired={isRequired}>
        {label && <FormLabel htmlFor={`${name}`}>{label}</FormLabel>}
        <VStack className="mb-4" ref={listRef}>
          {items.map((item, index) => (
            <ArrayInput
              key={`${item}-${index}`}
              id={`${name}[${index}]`}
              name={`${name}[${index}]`}
              ref={index === 0 ? ref : undefined}
              onRemove={() => remove(index)}
              {...rest}
            />
          ))}
          <Button variant="secondary" leftIcon={<IoMdAdd />} onClick={onAdd}>
            New Option
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
  ({ name, onRemove, ...rest }, ref) => {
    const { getInputProps, error } = useField(name);

    return (
      <FormControl isInvalid={!!error} isRequired>
        <HStack className="w-full content-between">
          <InputBase
            ref={ref}
            {...getInputProps({
              id: name,
              ...rest,
            })}
          />
          <IconButton
            variant="ghost"
            aria-label="Remove item"
            icon={<IoMdClose />}
            onClick={onRemove}
          />
        </HStack>

        {error && <FormErrorMessage>{error}</FormErrorMessage>}
      </FormControl>
    );
  }
);

ArrayInput.displayName = "ArrayInput";

export default Array;
