/* eslint-disable no-new-func */
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Modal,
  ModalContent,
  ModalTitle,
  toast,
  useDisclosure,
} from "@carbon/react";
import { useMode } from "@carbon/remix";
import type { OnMount } from "@monaco-editor/react";
import Editor from "@monaco-editor/react";
import { useFetcher, useParams } from "@remix-run/react";
import type * as Monaco from "monaco-editor";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LuEllipsisVertical,
  LuPlay,
  LuSave,
  LuSquareFunction,
  LuTrash2,
} from "react-icons/lu";
import type { action } from "~/routes/x+/part+/$itemId.rule";
import { path } from "~/utils/path";
import { ConfirmDelete } from "../../Modals";
import type { Configuration, Parameter, ParameterInput } from "../types";
import { typeMap } from "../types";
import {
  configureMonaco,
  convertTypescriptToJavaScript,
  generateDefaultCode,
  generateTypeDefinitions,
  getDefaultValue,
} from "../utils";
import ParameterPanel from "./ParameterPanel.ee";

interface ConfiguratorProps {
  configuration: Configuration;
  parameters: ParameterInput[];
  open: boolean;
  onClose: () => void;
}

export default function Configurator({
  configuration,
  open,
  parameters: defaultParameters,
  onClose,
}: ConfiguratorProps) {
  const { code: defaultCode, defaultValue, label, returnType } = configuration;
  const isActive = !!defaultCode;

  const mode = useMode();

  const [output, setOutput] = useState<string>("");
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);
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

  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  const fetcher = useFetcher<typeof action>();

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
    const formData = new FormData();
    formData.append("code", getCodeToSave());
    formData.append("field", configuration.field);
    fetcher.submit(formData, {
      method: "post",
      action: path.to.configurationRule(itemId),
    });
  };

  useEffect(() => {
    const head = document.querySelector("head")!;
    const script = document.createElement("script");
    script.setAttribute(
      "src",
      "https://unpkg.com/typescript@5.5.4/lib/typescript.js"
    );
    script.onload = () => setIsScriptLoaded(true);
    head.appendChild(script);
    return () => {
      head.removeChild(script);
    };
  }, []);

  useEffect(() => {
    if (fetcher.data?.success === false) {
      toast.error("Failed to save configuration rule");
    }

    if (fetcher.data?.success === true) {
      onClose();
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const runCode = useCallback(() => {
    const jsCode = convertTypescriptToJavaScript(code);
    if (isUnsafeCode(jsCode)) {
      setOutput(
        "Error: Unsupported code detected. The code you're trying to run contains disallowed patterns."
      );
      return;
    }

    try {
      // Create parameters object from the panel
      const parametersObj = parameters.reduce((acc, v) => {
        if (v.type === "material") {
          acc[v.name] = v.value;
        } else {
          acc[v.name] =
            v.type === "numeric"
              ? Number(v.value)
              : v.type === "boolean"
              ? v.value === "true"
              : v.value;
        }
        return acc;
      }, {} as Record<string, any>);

      // Execute the code
      const fn = new Function(
        "parameters",
        `
        ${jsCode}
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

  const deleteDialog = useDisclosure();

  if (!open) return null;

  return (
    <>
      <Modal
        open={open}
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
      >
        <ModalContent size="xxxlarge" className="p-0 gap-0 h-[90dvh]">
          <div className="flex items-center justify-between p-5 pr-14">
            <ModalTitle>Configure {label}</ModalTitle>
            <HStack>
              <Badge variant={isActive ? "green" : "gray"}>
                {isActive ? "Active" : "Inactive"}
                <LuSquareFunction className="ml-1" />
              </Badge>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    icon={<LuEllipsisVertical />}
                    variant="secondary"
                    size="sm"
                    aria-label="Actions"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    destructive
                    disabled={!isActive}
                    onClick={deleteDialog.onOpen}
                  >
                    <LuTrash2 className="mr-2 h-4 w-4" />
                    Delete Rule
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </HStack>
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
              <ParameterPanel
                parameters={parameters}
                onChange={setParameters}
              />
              <div className="p-4 border-t space-y-2">
                <Button
                  onClick={runCode}
                  className="w-full"
                  leftIcon={<LuPlay />}
                  variant="secondary"
                  isDisabled={!isScriptLoaded}
                >
                  Run Test
                </Button>
                <Button
                  onClick={handleSave}
                  className="w-full"
                  leftIcon={<LuSave />}
                  variant="primary"
                  isDisabled={fetcher.state !== "idle"}
                  isLoading={fetcher.state !== "idle"}
                >
                  Save & Close
                </Button>

                <div className="font-mono mt-4 p-2 bg-accent rounded min-h-[100px] max-h-[300px] max-w-[395px] overflow-auto whitespace-pre-wrap">
                  {output}
                </div>
              </div>
            </div>
          </div>
        </ModalContent>
      </Modal>
      {isActive && deleteDialog.isOpen && (
        <ConfirmDelete
          isOpen={deleteDialog.isOpen}
          action={path.to.deleteConfigurationRule(itemId, configuration.field)}
          name={label}
          text={`Are you sure you want to deactivate the ${label} configuration rule?`}
          onCancel={deleteDialog.onClose}
          onSubmit={onClose}
        />
      )}
    </>
  );
}

function isUnsafeCode(code: string) {
  // Check for disallowed code patterns
  const disallowedPatterns = [
    /\bfetch\b/, // fetch calls
    /setTimeout|setInterval/, // timeouts
    /\bimport\b/, // dynamic imports
    /new Promise/, // promise construction
    /Function\(/, // Function constructor
  ];

  return disallowedPatterns.some((pattern) => pattern.test(code));
}
