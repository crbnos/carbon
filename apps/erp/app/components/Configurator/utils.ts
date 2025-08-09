import type * as Monaco from "monaco-editor";
import type {
  ConfiguratorDataType,
  MaterialValue,
  Parameter,
  ReturnType,
} from "./types";
import { typeMap } from "./types";

const MATERIAL_TYPE =
  "{ id: string; materialFormId: string | null; materialSubstanceId: string | null; materialTypeId: string | null; dimensionId: string | null; finishId: string | null; gradeId: string | null; }";

export function configureMonaco(monaco: typeof Monaco) {
  // Configure JavaScript defaults
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });

  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    allowNonTsExtensions: true,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    module: monaco.languages.typescript.ModuleKind.CommonJS,
    noEmit: true,
    typeRoots: ["node_modules/@types"],
    strict: true,
  });
}

function getParameterTypeString(parameter: Parameter): string {
  if (parameter.type === "list" && parameter.config?.options) {
    const unionType = parameter.config.options
      .map((opt) => `"${opt}"`)
      .join(" | ");
    return ` * @param params.${parameter.name}: ${unionType}`;
  }

  if (parameter.type === "enum") {
    return ` * @param params.${
      parameter.name
    }: ${parameter.config?.options?.join(" | ")}`;
  }

  if (parameter.type === "material") {
    return ` * @param params.${parameter.name}: ${MATERIAL_TYPE}`;
  }

  return ` * @param params.${parameter.name}: ${typeMap[parameter.type]}`;
}

function getReturnTypeString(returnType: ReturnType): string {
  if (returnType.type === "list" && returnType.listOptions) {
    return `Array<${returnType.listOptions
      .map((opt) => `"${opt}"`)
      .join(" | ")}>`;
  }

  if (returnType.type === "enum" && returnType.listOptions) {
    return returnType.listOptions.map((opt) => `"${opt}"`).join(" | ");
  }

  if (returnType.type === "material") {
    return MATERIAL_TYPE;
  }

  return typeMap[returnType.type];
}

function getReturnComment(returnType: ReturnType): string {
  if (returnType.type === "list") {
    return "an array of predefined values";
  }

  if (returnType.type === "material") {
    return "a material object";
  }

  return `a ${returnType.type} value`;
}

function getReturnHelperText(returnType: ReturnType): string {
  if (returnType.helperText) {
    return returnType.helperText;
  }

  if (returnType.type === "list") {
    return `an array containing any of: [${returnType.listOptions
      ?.map((opt) => `"${opt}"`)
      .join(", ")}]`;
  }

  if (returnType.type === "enum" && returnType.listOptions) {
    return `one of: ${returnType.listOptions
      .map((opt) => `"${opt}"`)
      .join(" | ")}`;
  }

  if (returnType.type === "material") {
    return "a material object";
  }

  return `a ${returnType.type} value`;
}

function getDefaultReturnValue(
  returnType: ReturnType,
  defaultValue?: string | number | boolean | string[] | null
): string {
  switch (returnType.type) {
    case "text":
      return defaultValue ? `"${defaultValue}"` : '"test"';
    case "numeric":
      return defaultValue?.toString() ?? "1";
    case "boolean":
      return defaultValue?.toString() ?? "true";
    case "enum":
      return `"${defaultValue ?? returnType.listOptions?.[0]}"`;
    case "material":
      return `{
      id: "",
      materialFormId: null,
      materialSubstanceId: null,
      materialTypeId: null,
      dimensionId: null,
      finishId: null,
      gradeId: null,
    }`;
    case "list":
      return returnType.listOptions
        ? `[${returnType.listOptions.map((opt) => `"${opt}"`).join(", ")}]`
        : "[]";
    default:
      return "[]";
  }
}

export function generateDefaultCode(
  params: Parameter[],
  returnType: ReturnType,
  defaultCode?: string,
  defaultValue?: string | number | boolean | string[] | null
): string {
  const parameterTypes = params.map(getParameterTypeString).join("\n ");

  const returnTypeStr = getReturnTypeString(returnType);
  const returnComment = getReturnComment(returnType);
  const returnHelperText = getReturnHelperText(returnType);
  const defaultReturnValue = getDefaultReturnValue(returnType, defaultValue);

  return `
/** 
  * Configure function that processes the provided params
  * @returns ${returnComment}
 ${parameterTypes}
**/

function configure(params: Params): ${returnTypeStr} {
  // return ${returnHelperText}
  ${defaultCode ? defaultCode : `return ${defaultReturnValue};`}
}`;
}

export function getDefaultValue(
  type: ConfiguratorDataType,
  listOptions: string[] | null
): string | MaterialValue {
  switch (type) {
    case "numeric":
      return "1";
    case "text":
      return "test";
    case "boolean":
      return "true";
    case "list":
    case "enum":
      return listOptions?.[0] ?? "";
    case "material":
      return {
        id: "item_1234567890",
        materialFormId: "plate",
        materialSubstanceId: "steel",
        materialTypeId: null,
        dimensionId: "plate-1/4",
        finishId: null,
        gradeId: "steel-a36",
      };
    case "date":
      return new Date().toISOString();
    default:
      return "";
  }
}

export function generateTypeDefinitions(
  params: Parameter[],
  returnType: ReturnType
): string {
  const properties = params
    .map((parameter) => {
      let typeStr: string;

      if (parameter.type === "list" && parameter.config?.options) {
        typeStr = parameter.config.options.map((opt) => `"${opt}"`).join(" | ");
      } else if (parameter.type === "material") {
        typeStr = MATERIAL_TYPE;
      } else {
        typeStr = parameter.type;
      }

      const comment = `/** ${parameter.name} - ${parameter.type} parameter */`;
      return `    ${comment}\n    ${parameter.name}: ${typeStr};`;
    })
    .join("\n\n");

  const returnTypeStr = getReturnTypeString(returnType);

  return `
declare type Params = {
${properties}
}

/**
 * Configure function that processes the provided params
 * @param params The params object containing all available params
 * @returns A value matching the selected return type
 */
declare function configure(params: Params): ${returnTypeStr};
`;
}

export function convertTypescriptToJavaScript(code: string): string {
  // @ts-expect-error - TypeScript compiler is loaded globally
  if (window?.ts) {
    // @ts-expect-error - TypeScript compiler is loaded globally
    return window.ts.transpileModule(code, {
      compilerOptions: {
        // @ts-expect-error - TypeScript compiler is loaded globally
        target: window.ts.ScriptTarget.ES2020,
      },
    }).outputText;
  }
  return "";
}
