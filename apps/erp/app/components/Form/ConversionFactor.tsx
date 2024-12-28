import { useControlField, useField } from "@carbon/form";
import {
  Button,
  cn,
  CommandTrigger,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
  VStack,
} from "@carbon/react";
import { twoDecimals } from "@carbon/utils";
import type { ElementRef } from "react";
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import {
  LuArrowRightLeft,
  LuChevronDown,
  LuChevronUp,
  LuLanguages,
} from "react-icons/lu";
import { useUnitOfMeasure } from "./UnitOfMeasure";

enum ConversionDirection {
  PurchasedToInventory,
  InventoryToPurchased,
}

type ConversionFactorProps = {
  name: string;
  label?: string;
  inventoryCode?: string;
  purchasingCode?: string;
  isReadOnly?: boolean;
  isRequired?: boolean;
  helperText?: string;
  value?: number;
  onChange?: (newValue: number) => void;
};

const ConversionFactor = forwardRef<
  ElementRef<typeof CommandTrigger>,
  ConversionFactorProps
>(
  (
    {
      name,
      label = "Conversion Factor",
      isRequired,
      isReadOnly,
      helperText,
      value,
      onChange,
      purchasingCode,
      inventoryCode,
    },
    ref
  ) => {
    const { getInputProps, error, defaultValue } = useField(name);
    const [controlValue, setControlValue] = useControlField<number>(name);

    const [open, setOpen] = useState(false);
    const initialValue = useRef(defaultValue);

    const [conversionFactor, setConversionFactor] = useState(
      initialValue.current
    );

    useEffect(() => {
      if (value) {
        setControlValue(value);
        setConversionFactor(value);
        initialValue.current = value;
      }
    }, [setControlValue, value]);

    const [conversionDirection, setConversionDirection] = useState(
      ConversionDirection.InventoryToPurchased
    );

    const switchDirection = () => {
      if (conversionDirection === ConversionDirection.InventoryToPurchased) {
        setConversionDirection(ConversionDirection.PurchasedToInventory);
      } else {
        setConversionDirection(ConversionDirection.InventoryToPurchased);
      }
    };

    const unitOfMeasureOptions = useUnitOfMeasure();

    const description = useMemo(() => {
      const purchaseUnit =
        unitOfMeasureOptions.find((option) => option.value === purchasingCode)
          ?.label ??
        purchasingCode ??
        "";

      const inventoryUnit =
        unitOfMeasureOptions.find((option) => option.value === inventoryCode)
          ?.label ??
        inventoryCode ??
        "";

      const inverseOfConversion = 1 / conversionFactor;
      if (purchasingCode === inventoryCode) return `No conversion is required`;

      if (conversionDirection === ConversionDirection.InventoryToPurchased) {
        return (
          <>
            <span className={cn(Number.isNaN(conversionFactor) && "opacity-0")}>
              {`There ${conversionFactor === 1 ? "is" : "are"} ${twoDecimals(
                conversionFactor
              )} ${inventoryUnit.toLocaleLowerCase()} in one `}
              <span className="text-primary">
                {purchaseUnit.toLocaleLowerCase()}
              </span>
            </span>
          </>
        );
      }

      return (
        <>
          <span>
            {`There ${conversionFactor === 1 ? "is" : "are"} ${twoDecimals(
              inverseOfConversion
            )} `}
            <span className="text-primary">
              {purchaseUnit.toLocaleLowerCase()}
            </span>
            {` in one ${inventoryUnit.toLocaleLowerCase()}`}
          </span>
        </>
      );
    }, [
      conversionDirection,
      conversionFactor,
      inventoryCode,
      purchasingCode,
      unitOfMeasureOptions,
    ]);

    useEffect(() => {
      if (inventoryCode === purchasingCode) {
        setConversionFactor(1);
        setControlValue(1);
        initialValue.current = 1;
      }
    }, [inventoryCode, purchasingCode, setControlValue]);

    const onPurchaseUnitChange = (v: number) => {
      setConversionFactor(1 / v);
      onChange?.(1 / v);
    };

    const onInventoryUnitChange = (v: number) => {
      setConversionFactor(v);
      onChange?.(v);
    };

    const onConfirm = () => {
      setControlValue(conversionFactor);
      setOpen(false);
      initialValue.current = conversionFactor;
    };

    const onCancel = () => {
      setConversionFactor(initialValue.current);
      setOpen(false);
    };

    return (
      <FormControl isInvalid={!!error} isRequired={isRequired}>
        {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
        <input
          {...getInputProps({
            id: name,
          })}
          type="hidden"
          name={name}
          id={name}
          value={controlValue}
        />
        <Modal
          open={open}
          onOpenChange={(open) => {
            if (!open) onCancel();
          }}
        >
          <CommandTrigger
            disabled={isReadOnly || inventoryCode === purchasingCode}
            icon={<LuLanguages className="w-4 h-4 opacity-50" />}
            ref={ref}
            onClick={() => setOpen(true)}
          >
            {controlValue ? twoDecimals(controlValue) : "-"}
          </CommandTrigger>

          <ModalContent>
            <ModalBody>
              <VStack spacing={8}>
                <VStack className="w-full text-center">
                  <div className="w-full text-lg">{description}</div>
                  <div className="w-full">
                    <Button
                      onClick={switchDirection}
                      variant="secondary"
                      size="sm"
                      className="border-dashed"
                    >
                      Switch
                      <LuArrowRightLeft className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                </VStack>
                {conversionDirection ===
                ConversionDirection.PurchasedToInventory ? (
                  <HStack className="w-full justify-around items-start">
                    <VStack spacing={1}>
                      <NumberField
                        value={1 / conversionFactor}
                        onChange={onPurchaseUnitChange}
                      >
                        <NumberInputGroup className="relative">
                          <NumberInput />

                          <NumberInputStepper>
                            <NumberIncrementStepper>
                              <LuChevronUp size="1em" strokeWidth="3" />
                            </NumberIncrementStepper>
                            <NumberDecrementStepper>
                              <LuChevronDown size="1em" strokeWidth="3" />
                            </NumberDecrementStepper>
                          </NumberInputStepper>
                        </NumberInputGroup>
                      </NumberField>
                      <span className="text-xs text-primary">Purchased</span>
                    </VStack>
                    <VStack className="w-auto pt-2">
                      <span className="font-mono text-xl">=</span>
                    </VStack>
                    <VStack spacing={1}>
                      <NumberField value={1}>
                        <NumberInputGroup className="relative">
                          <NumberInput isReadOnly />
                        </NumberInputGroup>
                      </NumberField>
                      <span className="text-xs text-muted-foreground ">
                        Inventory
                      </span>
                    </VStack>
                  </HStack>
                ) : (
                  <HStack className="w-full justify-around items-start">
                    <VStack spacing={1}>
                      <NumberField
                        value={conversionFactor}
                        onChange={onInventoryUnitChange}
                      >
                        <NumberInputGroup className="relative">
                          <NumberInput />

                          <NumberInputStepper>
                            <NumberIncrementStepper>
                              <LuChevronUp size="1em" strokeWidth="3" />
                            </NumberIncrementStepper>
                            <NumberDecrementStepper>
                              <LuChevronDown size="1em" strokeWidth="3" />
                            </NumberDecrementStepper>
                          </NumberInputStepper>
                        </NumberInputGroup>
                      </NumberField>
                      <span className="text-xs text-muted-foreground ">
                        Inventory
                      </span>
                    </VStack>
                    <VStack className="w-auto pt-2">
                      <span className="font-mono text-xl">=</span>
                    </VStack>
                    <VStack spacing={1}>
                      <NumberField value={1}>
                        <NumberInputGroup className="relative">
                          <NumberInput isReadOnly />
                        </NumberInputGroup>
                      </NumberField>
                      <span className="text-xs text-muted-foreground text-primary">
                        Purchased
                      </span>
                    </VStack>
                  </HStack>
                )}
              </VStack>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={onCancel}>
                Cancel
              </Button>
              <Button onClick={onConfirm}>Confirm</Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
        {helperText && <FormHelperText>{helperText}</FormHelperText>}
        {error && <FormErrorMessage>{error}</FormErrorMessage>}
      </FormControl>
    );
  }
);
ConversionFactor.displayName = "ConversionFactor";

export default ConversionFactor;
