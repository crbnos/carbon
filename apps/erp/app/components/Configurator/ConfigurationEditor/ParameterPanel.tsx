import { ConfiguratorDataTypeIcon } from "../Icons";
import type { Parameter } from "../types";

interface ParameterPanelProps {
  parameters: Parameter[];
  onChange: (parameters: Parameter[]) => void;
}

export default function ParameterPanel({
  parameters,
  onChange,
}: ParameterPanelProps) {
  const updateValue = (index: number, value: string) => {
    const newParameters = [...parameters];
    newParameters[index] = { ...newParameters[index], value };
    onChange(newParameters);
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
          .map((parameter, index) => (
            <div
              key={parameter.name}
              className="grid grid-cols-2 border-b last:border-b-0 hover:bg-accent"
            >
              <div className="px-4 py-2 border-r flex items-center gap-2 min-w-[140px]">
                <ConfiguratorDataTypeIcon type={parameter.type} />
                <span className="text-sm font-medium text-foreground">
                  {parameter.name}
                </span>
              </div>
              <div className="px-2 py-1">
                {parameter.type === "boolean" ? (
                  <select
                    value={parameter.value}
                    onChange={(e) => updateValue(index, e.target.value)}
                    className="w-full h-full px-2 bg-transparent border-0 focus:ring-0"
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : parameter.type === "list" && parameter.config?.options ? (
                  <select
                    value={parameter.value}
                    onChange={(e) => updateValue(index, e.target.value)}
                    className="w-full h-full px-2 bg-transparent border-0 focus:ring-0"
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
                    value={parameter.value}
                    onChange={(e) => updateValue(index, e.target.value)}
                    className="w-full h-full px-2 bg-transparent border-0 focus:ring-0"
                  />
                )}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
