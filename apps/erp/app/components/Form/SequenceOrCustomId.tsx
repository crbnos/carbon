import { useField } from "@carbon/form";
import type { InputProps } from "@carbon/react";
import {
  Button,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  HStack,
  IconButton,
  Input,
} from "@carbon/react";
import { forwardRef, useState } from "react";
import { LuToggleLeft, LuToggleRight } from "react-icons/lu";

type SequenceOrCustomIdProps = InputProps & {
  name: string;
  label: string;
  table: string;
  isOptional?: boolean;
  helperText?: string;
};

const SequenceOrCustomId = forwardRef<
  HTMLInputElement,
  SequenceOrCustomIdProps
>(({ name, label, table, isOptional = false, helperText, ...rest }, ref) => {
  const [isCustom, setIsCustom] = useState(false);
  const { getInputProps, error } = useField(name);

  return (
    <div>
      <HStack className="justify-between mb-2">
        <FormControl isInvalid={!!error}>
          {label && (
            <FormLabel htmlFor={name} isOptional={isOptional}>
              {label}
            </FormLabel>
          )}
          <HStack className="w-full" spacing={0}>
            {isCustom ? (
              <Input
                ref={ref}
                {...getInputProps({
                  id: name,
                  placeholder: `Custom ${label}`,
                  ...rest,
                })}
                className="rounded-r-none"
              />
            ) : (
              <Button
                size="md"
                variant="secondary"
                className="flex-grow bg-muted text-muted-foreground justify-start pl-4 h-10 rounded-r-none"
              >
                Next Sequence
              </Button>
            )}
            <IconButton
              aria-label="Toggle"
              className="bg-transparent flex-shrink-0 h-10 rounded-l-none border border-l-0"
              icon={isCustom ? <LuToggleLeft /> : <LuToggleRight />}
              variant="secondary"
              size="lg"
              onClick={() => setIsCustom(!isCustom)}
            />
          </HStack>

          {helperText && <FormHelperText>{helperText}</FormHelperText>}
          {error && <FormErrorMessage>{error}</FormErrorMessage>}
        </FormControl>
      </HStack>
    </div>
  );
});

SequenceOrCustomId.displayName = "SequenceOrCustomId";

export default SequenceOrCustomId;
