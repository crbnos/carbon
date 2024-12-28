import { useControlField, useField } from "@carbon/form";
import {
  FormControl,
  FormErrorMessage,
  FormLabel,
  HStack,
  useDisclosure,
  useOutsideClick,
} from "@carbon/react";
import { useRef } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";

type ColorFieldProps = {
  name: string;
  label: string;
};

const ColorPicker = ({ name, label }: ColorFieldProps) => {
  const { error } = useField(name);
  const [value, setValue] = useControlField<string>(name);
  const disclosure = useDisclosure();
  const containerRef = useRef<HTMLDivElement>(null);

  useOutsideClick({
    ref: containerRef,
    handler: () => disclosure.onClose(),
  });

  return (
    <FormControl>
      <FormLabel>{label}</FormLabel>
      <input type="hidden" name={name} value={value} />
      <div className="relative" ref={containerRef}>
        <HStack>
          <button
            className="inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-8 w-8 border border-border"
            style={{ background: value }}
            onClick={disclosure.onToggle}
            type="button"
          />
          <HexColorInput
            color={value}
            onChange={setValue}
            className="py-0 px-2 h-9 rounded-md outline-2 outline-offset-2 outline-transparent border border-border bg-background text-foreground focus:ring-ring focus:ring-offset-background focus:ring-2 focus:outline-none disabled:pointer-events-none disabled:opacity-50"
          />
        </HStack>
        {disclosure.isOpen && (
          <div className="absolute mt-1 top-10 z-50">
            <HexColorPicker color={value} onChange={setValue} />
          </div>
        )}
      </div>
      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
};

export default ColorPicker;
