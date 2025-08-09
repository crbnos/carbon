import {
  Alert,
  AlertTitle,
  Button,
  Combobox,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  ModalTitle,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  toast,
} from "@carbon/react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { LuChevronDown, LuChevronUp, LuTriangleAlert } from "react-icons/lu";
import { z } from "zod";
import { zfd } from "zod-form-data";
import type {
  ConfigurationParameter,
  ConfigurationParameterGroup,
  MaterialConfigurationData,
} from "~/modules/items/types";
import { useMaterials } from "~/stores/items";

interface FormData {
  [key: string]: string | number | boolean | MaterialConfigurationData;
}

interface ParameterFieldProps {
  parameter: ConfigurationParameter;
}

function getParameterSchema(parameter: ConfigurationParameter) {
  switch (parameter.dataType) {
    case "numeric":
      return zfd.numeric(
        z.number({
          required_error: `${parameter.label} is required`,
        })
      );
    case "text":
      return z.string({
        required_error: `${parameter.label} is required`,
      });
    case "list":
      return z.enum(parameter.listOptions as [string, ...string[]], {
        required_error: `${parameter.label} is required`,
      });
    case "boolean":
      return z.boolean();
    case "material":
      return z.string({
        required_error: `${parameter.label} is required`,
      });
    default:
      return z.any();
  }
}

function generateConfigurationSchema(parameters: ConfigurationParameter[]) {
  const schemaFields = parameters.reduce((acc, parameter) => {
    acc[parameter.key] = getParameterSchema(parameter);
    return acc;
  }, {} as Record<string, z.ZodType>);

  return z.object(schemaFields);
}

function ParameterField({ parameter }: ParameterFieldProps) {
  const { formData, setFormData } = useConfigurator();
  const materials = useMaterials();

  const handleChange = (value: string | number | boolean) => {
    setFormData({ ...formData, [parameter.key]: value });
  };

  switch (parameter.dataType) {
    case "numeric":
      return (
        <div className="space-y-2">
          <Label
            className="text-xs text-muted-foreground"
            htmlFor={parameter.key}
          >
            {parameter.label}
          </Label>
          <NumberField
            onChange={(value) => handleChange(Number(value))}
            value={formData[parameter.key] as number}
          >
            <NumberInputGroup className="relative">
              <NumberInput id={parameter.key} />
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
        </div>
      );

    case "text":
      return (
        <div className="space-y-2">
          <Label
            className="text-xs text-muted-foreground"
            htmlFor={parameter.key}
          >
            {parameter.label}
          </Label>
          <Input
            id={parameter.key}
            type="text"
            value={(formData[parameter.key] as string) || ""}
            onChange={(e) => handleChange(e.target.value)}
            className="w-full"
          />
        </div>
      );

    case "list":
      return (
        <div className="space-y-2">
          <Label
            className="text-xs text-muted-foreground"
            htmlFor={parameter.key}
          >
            {parameter.label}
          </Label>
          <Select
            value={formData[parameter.key] as string}
            onValueChange={handleChange}
          >
            <SelectTrigger id={parameter.key}>
              <SelectValue placeholder="Select an option" />
            </SelectTrigger>
            <SelectContent>
              {parameter.listOptions?.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );

    case "boolean":
      return (
        <div className="flex flex-col items-start gap-2">
          <Label
            className="text-xs text-muted-foreground"
            htmlFor={parameter.key}
          >
            {parameter.label}
          </Label>
          <Switch
            id={parameter.key}
            checked={(formData[parameter.key] as boolean) || false}
            onCheckedChange={handleChange}
          />
        </div>
      );

    case "material":
      return (
        <div className="space-y-2">
          <Label
            className="text-xs text-muted-foreground"
            htmlFor={parameter.key}
          >
            {parameter.label}
          </Label>
          <Combobox
            id={parameter.key}
            options={materials.map((material) => ({
              label: material.name,
              value: material.id,
              helper: material.readableIdWithRevision,
            }))}
            value={formData[parameter.key] as string}
            onChange={(value) => handleChange(value)}
          />
        </div>
      );

    default:
      return null;
  }
}

type ConfiguratorContextType = {
  currentStep: number;
  totalSteps: number;
  formData: FormData;
  setFormData: (data: FormData) => void;
  nextStep: () => void;
  previousStep: () => void;
  goToStep: (step: number) => void;
  destructive: boolean;
};

const ConfiguratorContext = createContext<ConfiguratorContextType | undefined>(
  undefined
);

interface ConfiguratorProviderProps {
  children: React.ReactNode;
  totalSteps: number;
  initialValues?: FormData;
  destructive?: boolean;
}

function ConfiguratorProvider({
  children,
  totalSteps,
  initialValues = {},
  destructive = false,
}: ConfiguratorProviderProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<FormData>(initialValues);

  const nextStep = () => {
    if (currentStep < totalSteps - 1) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const previousStep = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const goToStep = (step: number) => {
    if (step >= 0 && step < totalSteps) {
      setCurrentStep(step);
    }
  };

  return (
    <ConfiguratorContext.Provider
      value={{
        currentStep,
        totalSteps,
        formData,
        setFormData,
        nextStep,
        previousStep,
        goToStep,
        destructive,
      }}
    >
      {children}
    </ConfiguratorContext.Provider>
  );
}

function useConfigurator() {
  const context = useContext(ConfiguratorContext);
  if (!context) {
    throw new Error(
      "useConfigurator must be used within a ConfiguratorProvider"
    );
  }
  return context;
}

interface ConfiguratorFormProps {
  groups: ConfigurationParameterGroup[];
  parameters: ConfigurationParameter[];
  onSubmit: (data: Record<string, any>) => void;
  onGroupChange: (group: ConfigurationParameterGroup) => void;
  initialValues?: FormData;
  destructive?: boolean;
}

function ConfiguratorFormContent({
  groups,
  parameters,
  onSubmit,
  onGroupChange,
}: ConfiguratorFormProps) {
  const {
    currentStep,
    totalSteps,
    formData,
    nextStep,
    previousStep,
    destructive,
  } = useConfigurator();

  const groupedParameters = useMemo(() => {
    const sortedGroups = [...groups]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .filter((group) =>
        parameters.some((p) => p.configurationParameterGroupId === group.id)
      );

    return sortedGroups.map((group) => ({
      group,
      parameters: parameters
        .filter((p) => p.configurationParameterGroupId === group.id)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }));
  }, [groups, parameters]);

  useEffect(() => {
    if (groupedParameters[currentStep]) {
      onGroupChange(groupedParameters[currentStep].group);
    }
  }, [currentStep, groupedParameters, onGroupChange]);

  const isStepValid = useMemo(() => {
    if (!groupedParameters[currentStep]) return false;

    return groupedParameters[currentStep].parameters.every((parameter) => {
      if (parameter.dataType === "boolean") return true;
      if (parameter.dataType === "numeric")
        return formData[parameter.key] !== undefined;
      return (
        formData[parameter.key] !== undefined && formData[parameter.key] !== ""
      );
    });
  }, [currentStep, groupedParameters, formData]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (currentStep === totalSteps - 1) {
      const schema = generateConfigurationSchema(parameters);
      const result = schema.safeParse(formData);

      if (result.success) {
        onSubmit(result.data);
      } else {
        toast.error("Please fill out all required fields");
      }
    } else {
      nextStep();
    }
  };

  const isLastStep = currentStep === totalSteps - 1;

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <ConfiguratorProgress />

      {groupedParameters[currentStep] && (
        <ConfiguratorStep
          group={groupedParameters[currentStep].group}
          parameters={groupedParameters[currentStep].parameters}
        />
      )}

      {isLastStep && destructive && (
        <Alert variant="destructive">
          <LuTriangleAlert className="h-4 w-4" />
          <AlertTitle>
            Changing this will overwrite the existing method
          </AlertTitle>
        </Alert>
      )}
      <div className="flex justify-between pt-4">
        <Button
          type="button"
          variant="secondary"
          onClick={previousStep}
          disabled={currentStep === 0}
        >
          Previous
        </Button>

        <Button
          type="submit"
          disabled={!isStepValid}
          variant={isLastStep && destructive ? "destructive" : "primary"}
        >
          {isLastStep ? (destructive ? "Save and Overwrite" : "Save") : "Next"}
        </Button>
      </div>
    </form>
  );
}

function ConfiguratorForm(props: ConfiguratorFormProps) {
  const validGroups = useMemo(
    () =>
      props.groups.filter((group) =>
        props.parameters.some(
          (p) => p.configurationParameterGroupId === group.id
        )
      ),
    [props.groups, props.parameters]
  );

  const initialValues = useMemo(() => {
    const values: FormData = {};
    props.parameters.forEach((param) => {
      if (param.dataType === "boolean") {
        values[param.key] = props.initialValues?.[param.key] ?? false;
      } else if (param.dataType === "numeric") {
        values[param.key] = props.initialValues?.[param.key] ?? 0;
      } else {
        values[param.key] = props.initialValues?.[param.key] ?? "";
      }
    });
    return values;
  }, [props.initialValues, props.parameters]);

  return (
    <ConfiguratorProvider
      initialValues={initialValues}
      totalSteps={validGroups.length}
      destructive={props.destructive}
    >
      <ConfiguratorFormContent {...props} />
    </ConfiguratorProvider>
  );
}

type ConfiguratorModalProps = {
  groups: ConfigurationParameterGroup[];
  parameters: ConfigurationParameter[];
  open: boolean;
  initialValues?: FormData;
  destructive?: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, any>) => void;
};

function ConfiguratorModal({
  groups,
  parameters,
  open,
  onClose,
  onSubmit,
  initialValues,
  destructive,
}: ConfiguratorModalProps) {
  const validGroups = useMemo(
    () =>
      groups.filter((group) =>
        parameters.some((p) => p.configurationParameterGroupId === group.id)
      ),
    [groups, parameters]
  );

  const [currentGroup, setCurrentGroup] = useState<
    ConfigurationParameterGroup | undefined
  >(validGroups[0]);

  return (
    <Modal
      open={open}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ModalContent size="large">
        <ModalHeader>
          <ModalTitle>{currentGroup?.name ?? "Configurator"}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <ConfiguratorForm
            groups={groups}
            parameters={parameters}
            onSubmit={onSubmit}
            onGroupChange={setCurrentGroup}
            initialValues={initialValues}
            destructive={destructive}
          />
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

function ConfiguratorProgress() {
  const { currentStep, totalSteps } = useConfigurator();
  const progress = ((currentStep + 1) / totalSteps) * 100;

  if (totalSteps <= 1) return null;

  return (
    <div className="w-full space-y-2">
      <Progress value={progress} className="h-2" />
    </div>
  );
}

type ConfiguratorStepProps = {
  group: ConfigurationParameterGroup;
  parameters: ConfigurationParameter[];
};

function ConfiguratorStep({ group, parameters }: ConfiguratorStepProps) {
  return (
    <div className="flex flex-col gap-6">
      {parameters.map((parameter) => (
        <ParameterField key={parameter.id} parameter={parameter} />
      ))}
    </div>
  );
}

export { ConfiguratorModal };
