/* eslint-disable no-new-func */
import { Button, Modal, ModalContent, ModalTitle } from "@carbon/react";
import type { OnMount } from "@monaco-editor/react";
import Editor from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LuPlay, LuPower, LuSave } from "react-icons/lu";
import { useMode } from "~/hooks/useMode";
import ParameterPanel from "./ParameterPanel";
import type { Configuration, Parameter, ParameterInput } from "./types";
import { typeMap } from "./types";
import {
  configureMonaco,
  generateDefaultCode,
  generateTypeDefinitions,
  getDefaultValue,
  stripTypeScript,
} from "./utils";

interface ConfiguratorProps {
  configuration: Configuration;
  parameters: ParameterInput[];
  open: boolean;
  onClose: () => void;
  onSave: (code: string) => void;
}

export default function Configurator({
  configuration,
  open,
  parameters: defaultParameters,
  onClose,
  onSave,
}: ConfiguratorProps) {
  const { code: defaultCode, defaultValue, label, returnType } = configuration;

  const mode = useMode();
  const [output, setOutput] = useState<string>("");
  const [parameters, setParameters] = useState<Parameter[]>(
    defaultParameters.map((param) => ({
      name: param.key,
      type: param.dataType,
      value: getDefaultValue(param.dataType, param.listOptions),
      config:
        param.dataType === "list"
          ? { options: param.listOptions ?? [] }
          : undefined,
    }))
  );

  useEffect(() => {
    setParameters((prev) =>
      defaultParameters.map((param) => ({
        name: param.key,
        type: param.dataType,
        value:
          prev.find((p) => p.name === param.key)?.value ||
          getDefaultValue(param.dataType, param.listOptions),
        config:
          param.dataType === "list"
            ? { options: param.listOptions ?? [] }
            : undefined,
      }))
    );
  }, [defaultParameters]);

  const [code, setCode] = useState(
    generateDefaultCode(parameters, returnType, defaultCode, defaultValue)
  );
  const [editor, setEditor] =
    useState<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const [monaco, setMonaco] = useState<typeof Monaco | null>(null);

  const lockedLines = useMemo(() => {
    const baseLockedLines = 8; // For the function declaration and closing lines
    const totalLockedLines = baseLockedLines + parameters.length;

    return totalLockedLines;
  }, [parameters]);

  useEffect(() => {
    if (editor && monaco) {
      editor.onDidChangeCursorSelection(() => {
        const selectionInLockedRange = editor
          .getSelections()
          ?.some((selection) => {
            return selection.intersectRanges(
              new monaco.Range(1, 0, lockedLines + 1, 0)
            );
          });
        editor.updateOptions({
          readOnly: selectionInLockedRange,
          readOnlyMessage: { value: "Cannot edit locked lines." },
        });
      });
    }
  }, [editor, monaco, lockedLines]);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    setEditor(editor);
    setMonaco(monaco);

    // Configure Monaco
    configureMonaco(monaco);

    // Add initial type definitions
    const typeDefinitions = generateTypeDefinitions(parameters, returnType);
    monaco.languages.typescript.javascriptDefaults.addExtraLib(
      typeDefinitions,
      "parameters.d.ts"
    );

    editor.onDidChangeCursorSelection(() => {
      const selectionInLockedRange = editor
        .getSelections()
        ?.some((selection) => {
          return selection.intersectRanges(
            new monaco.Range(1, 0, lockedLines + 1, 0)
          );
        });

      editor.updateOptions({
        readOnly: selectionInLockedRange,
        readOnlyMessage: { value: "Cannot edit locked lines." },
      });
    });
  };

  // Update type definitions when parameters change
  useEffect(() => {
    if (monaco && editor) {
      const typeDefinitions = generateTypeDefinitions(parameters, returnType);
      monaco.languages.typescript.javascriptDefaults.addExtraLib(
        typeDefinitions,
        "parameters.d.ts"
      );

      // Trigger a re-validation of the model
      const model = editor.getModel();
      if (model) {
        monaco.editor.setModelMarkers(model, "typescript", []);
      }
    }
  }, [parameters, monaco, editor, returnType]);

  const getCodeToSave = () => {
    const lines = code.split("\n");
    const startLine = lockedLines;
    let endLine = lines.length - 1;

    // Find the closing brace of the configure function
    let braceCount = 0;
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      braceCount += (line.match(/{/g) || []).length;
      braceCount -= (line.match(/}/g) || []).length;
      if (braceCount === -1) {
        endLine = i;
        break;
      }
    }

    const storedCode = lines.slice(startLine, endLine).join("\n").trim();
    return storedCode;
  };

  const handleSave = () => {
    const codeToSave = getCodeToSave();
    onSave(codeToSave);
  };

  const runCode = useCallback(() => {
    try {
      // Check for potentially problematic code
      const codeStr = stripTypeScript(code);

      // Create parameters object from the panel
      const parametersObj = parameters.reduce((acc, v) => {
        acc[v.name] =
          v.type === "numeric"
            ? Number(v.value)
            : v.type === "boolean"
            ? v.value === "true"
            : v.value;
        return acc;
      }, {} as Record<string, string | number | boolean>);

      // Execute the code
      const fn = new Function(
        "parameters",
        `
        ${codeStr}
        return configure(parameters);
      `
      );

      const result = fn(parametersObj);

      // Verify return type
      if (returnType.type === "list") {
        if (!Array.isArray(result)) {
          throw new Error("Expected return type to be an array");
        }
        if (returnType.listOptions) {
          const invalidValue = result.find(
            (value) => !returnType.listOptions?.includes(value)
          );
          if (invalidValue) {
            throw new Error(
              `Invalid value "${invalidValue}" in array. Must be one of: ${returnType.listOptions.join(
                ", "
              )}`
            );
          }
        }
      } else if (returnType.type === "enum") {
        if (Array.isArray(result)) {
          throw new Error(
            "Expected return type to be a single value, not an array"
          );
        }
        if (
          returnType.listOptions &&
          !returnType.listOptions.includes(result)
        ) {
          throw new Error(
            `Invalid value "${result}". Must be one of: ${returnType.listOptions.join(
              ", "
            )}`
          );
        }
      } else {
        const actualType = typeof result;
        if (actualType !== typeMap[returnType.type]) {
          throw new Error(
            `Expected return type ${returnType.type}, but got ${actualType}`
          );
        }
      }

      setOutput(`Result: ${JSON.stringify(result)}`);
    } catch (error) {
      setOutput(`Error: ${(error as Error).message}`);
    }
  }, [code, parameters, returnType]);

  if (!open) return null;

  return (
    <Modal
      open={open}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ModalContent size="xxxlarge" className="p-0 gap-0 h-[90dvh]">
        <div className="flex items-center justify-between p-6 pr-14">
          <ModalTitle>Configure {label}</ModalTitle>
          <ConfigurationToggle isActive={true} onChange={() => {}} />
        </div>

        <div className="flex-1 flex h-full border-t">
          <div className="flex-1 w-2/3 border-r">
            <div className="h-full">
              <Editor
                height="100%"
                defaultLanguage="javascript"
                value={code}
                onChange={(value) => setCode(value || "")}
                theme={mode === "light" ? "vs-light" : "vs-dark"}
                onMount={handleEditorDidMount}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  suggest: {
                    showProperties: true,
                    showValues: true,
                    preview: true,
                  },
                  quickSuggestions: true,
                  snippetSuggestions: "inline",
                  formatOnType: true,
                  formatOnPaste: true,
                }}
              />
            </div>
          </div>

          <div className="w-1/3 flex flex-col">
            <ParameterPanel parameters={parameters} onChange={setParameters} />
            <div className="p-4 border-t space-y-2">
              <Button
                onClick={handleSave}
                className="w-full"
                leftIcon={<LuSave />}
                variant="secondary"
              >
                Save & Close
              </Button>
              <Button
                onClick={runCode}
                className="w-full"
                leftIcon={<LuPlay />}
                variant="primary"
              >
                Run Test
              </Button>

              <div className="font-mono mt-4 p-2 bg-accent rounded min-h-[100px] whitespace-pre-wrap">
                {output}
              </div>
            </div>
          </div>
        </div>
      </ModalContent>
    </Modal>
  );
}

type ConfigurationToggleProps = {
  isActive: boolean;
  onChange: (active: boolean) => void;
};

function ConfigurationToggle({ isActive, onChange }: ConfigurationToggleProps) {
  return (
    <button
      onClick={() => onChange(!isActive)}
      className={`
        flex items-center gap-2 px-4 py-2 rounded-lg
        ${
          isActive
            ? "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800"
            : "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800"
        }
        `}
    >
      <LuPower className="w-4 h-4" />
      <span>{isActive ? "Active" : "Inactive"}</span>
    </button>
  );
}
