import { ConfiguratorDataTypeIcon } from "../Icons";
import type { MaterialValue, Parameter } from "../types";

interface ParameterPanelProps {
  parameters: Parameter[];
  onChange: (parameters: Parameter[]) => void;
}

export default function ParameterPanel({
  parameters,
  onChange,
}: ParameterPanelProps) {
  const updateValue = (index: number, value: string | MaterialValue) => {
    const newParameters = [...parameters];
    newParameters[index] = { ...newParameters[index], value };
    onChange(newParameters);
  };

  const updateMaterialProperty = (
    index: number,
    property: keyof MaterialValue,
    value: string | null
  ) => {
    const newParameters = [...parameters];
    const param = newParameters[index];
    if (param.type === "material" && typeof param.value === "object") {
      newParameters[index] = {
        ...param,
        value: {
          ...(param.value as MaterialValue),
          [property]: value || null,
        },
      };
      onChange(newParameters);
    }
  };

  return (
    <div className="flex-1 p-4 overflow-y-auto text-sm">
      <h3 className="text-lg font-semibold mb-4">Parameters</h3>
      <div className="border rounded-lg overflow-hidden">
        <div className="grid grid-cols-2 bg-accent border-b">
          <div className="px-4 py-2 font-medium text-muted-foreground border-r">
            Name
          </div>
          <div className="px-4 py-2 font-medium text-muted-foreground">
            Test Value
          </div>
        </div>

        {parameters
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((parameter, index) => {
            if (parameter.type === "material") {
              const materialValue = parameter.value as MaterialValue;
              const materialProperties = [
                { key: "id", value: materialValue.id },
                { key: "materialFormId", value: materialValue.materialFormId },
                {
                  key: "materialSubstanceId",
                  value: materialValue.materialSubstanceId,
                },
                { key: "materialTypeId", value: materialValue.materialTypeId },
                { key: "dimensionId", value: materialValue.dimensionId },
                { key: "finishId", value: materialValue.finishId },
                { key: "gradeId", value: materialValue.gradeId },
              ];

              return materialProperties.map((prop) => (
                <div
                  key={`${parameter.name}.${prop.key}`}
                  className="grid grid-cols-2 border-b last:border-b-0 hover:bg-accent"
                >
                  <div className="px-4 py-2 border-r flex items-center gap-2 min-w-[140px] overflow-hidden">
                    <ConfiguratorDataTypeIcon type={parameter.type} />
                    <span className="text-sm font-medium text-foreground truncate">
                      {parameter.name}.{prop.key}
                    </span>
                  </div>
                  <div className="px-2 py-1 overflow-hidden">
                    <input
                      type="text"
                      value={prop.value || ""}
                      onChange={(e) =>
                        updateMaterialProperty(
                          index,
                          prop.key as keyof MaterialValue,
                          e.target.value
                        )
                      }
                      className="w-full h-full px-2 bg-transparent border-0 focus:ring-0 truncate"
                      placeholder={prop.key}
                    />
                  </div>
                </div>
              ));
            }

            return (
              <div
                key={parameter.name}
                className="grid grid-cols-2 border-b last:border-b-0 hover:bg-accent"
              >
                <div className="px-4 py-2 border-r flex items-center gap-2 min-w-[140px] overflow-hidden">
                  <ConfiguratorDataTypeIcon type={parameter.type} />
                  <span className="text-sm font-medium text-foreground truncate">
                    {parameter.name}
                  </span>
                </div>
                <div className="px-2 py-1 overflow-hidden">
                  {parameter.type === "boolean" ? (
                    <select
                      value={parameter.value as string}
                      onChange={(e) => updateValue(index, e.target.value)}
                      className="w-full h-full px-2 bg-transparent border-0 focus:ring-0 truncate"
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : parameter.type === "list" && parameter.config?.options ? (
                    <select
                      value={parameter.value as string}
                      onChange={(e) => updateValue(index, e.target.value)}
                      className="w-full h-full px-2 bg-transparent border-0 focus:ring-0 truncate"
                    >
                      {parameter.config.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={parameter.type === "numeric" ? "number" : "text"}
                      value={parameter.value as string}
                      onChange={(e) => updateValue(index, e.target.value)}
                      className="w-full h-full px-2 bg-transparent border-0 focus:ring-0 truncate"
                    />
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
