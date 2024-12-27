import {
  Button,
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
} from "@carbon/react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";
import { z } from "zod";
import { zfd } from "zod-form-data";
import type {
  ConfigurationParameter,
  ConfigurationParameterGroup,
} from "~/modules/items/types";

interface FormData {
  [key: string]: string | number | boolean;
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

  const handleChange = (value: string | number | boolean) => {
    setFormData({ ...formData, [parameter.key]: value });
  };

  switch (parameter.dataType) {
    case "numeric":
      return (
        <div className="space-y-2">
          <Label htmlFor={parameter.key}>{parameter.label}</Label>
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
          <Label htmlFor={parameter.key}>{parameter.label}</Label>
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
          <Label htmlFor={parameter.key}>{parameter.label}</Label>
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
          <Label htmlFor={parameter.key}>{parameter.label}</Label>
          <Switch
            id={parameter.key}
            checked={(formData[parameter.key] as boolean) || false}
            onCheckedChange={handleChange}
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
};

const ConfiguratorContext = createContext<ConfiguratorContextType | undefined>(
  undefined
);

interface ConfiguratorProviderProps {
  children: React.ReactNode;
  totalSteps: number;
  initialValues?: FormData;
}

function ConfiguratorProvider({
  children,
  totalSteps,
  initialValues = {},
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
}

function ConfiguratorFormContent({
  groups,
  parameters,
  onSubmit,
  onGroupChange,
}: ConfiguratorFormProps) {
  const { currentStep, totalSteps, formData, nextStep, previousStep } =
    useConfigurator();

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
      return (
        formData[parameter.key] !== undefined && formData[parameter.key] !== ""
      );
    });
  }, [currentStep, groupedParameters, formData]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log({
      currentStep,
      totalSteps,
      formData,
      isStepValid,
    });
    if (currentStep === totalSteps - 1) {
      const schema = generateConfigurationSchema(parameters);
      const result = schema.safeParse(formData);
      console.log({ result });
      if (result.success) {
        onSubmit(result.data);
      }
    } else {
      nextStep();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <ConfiguratorProgress />

      {groupedParameters[currentStep] && (
        <ConfiguratorStep
          group={groupedParameters[currentStep].group}
          parameters={groupedParameters[currentStep].parameters}
        />
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

        <Button type="submit" disabled={!isStepValid}>
          {currentStep === totalSteps - 1 ? "Save" : "Next"}
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
    >
      <ConfiguratorFormContent {...props} />
    </ConfiguratorProvider>
  );
}

type ConfiguratorModalProps = {
  groups: ConfigurationParameterGroup[];
  parameters: ConfigurationParameter[];
  open: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, any>) => void;
  initialValues?: FormData;
};

function ConfiguratorModal({
  groups,
  parameters,
  open,
  onClose,
  onSubmit,
  initialValues,
}: ConfiguratorModalProps) {
  const validGroups = useMemo(
    () =>
      groups.filter((group) =>
        parameters.some((p) => p.configurationParameterGroupId === group.id)
      ),
    [groups, parameters]
  );

  const [currentGroup, setCurrentGroup] = useState<ConfigurationParameterGroup>(
    validGroups[0]
  );

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
          <ModalTitle>{currentGroup.name}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <ConfiguratorForm
            groups={groups}
            parameters={parameters}
            onSubmit={onSubmit}
            onGroupChange={setCurrentGroup}
            initialValues={initialValues}
          />
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

function ConfiguratorProgress() {
  const { currentStep, totalSteps } = useConfigurator();
  const progress = ((currentStep + 1) / totalSteps) * 100;

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
