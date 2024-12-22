import type * as Monaco from "monaco-editor";
import {
  typeMap,
  type ConfiguratorDataType,
  type Parameter,
  type ReturnType,
} from "./types";

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

export function generateDefaultCode(
  params: Parameter[],
  returnType: ReturnType,
  defaultCode?: string
): string {
  const parameterTypes = params
    .map((parameter) => {
      if (parameter.type === "list" && parameter.config?.options) {
        const unionType = parameter.config.options
          .map((opt) => `"${opt}"`)
          .join(" | ");
        return ` * @param params.${parameter.name}: ${unionType}`;
      }
      return ` * @param params.${parameter.name}: ${typeMap[parameter.type]}`;
    })
    .join("\n ");

  const returnTypeStr =
    returnType.type === "list" && returnType.listOptions
      ? `Array<${returnType.listOptions.map((opt) => `"${opt}"`).join(" | ")}>`
      : typeMap[returnType.type];

  return `
/** 
  * Configure function that processes the provided params
  * @returns ${
    returnType.type === "list"
      ? "an array of predefined values"
      : `a ${returnType.type} value`
  }
 ${parameterTypes}
**/

function configure(params: Params): ${returnTypeStr} {
  // return ${
    returnType.type === "list"
      ? "an array of predefined values"
      : `a ${returnType.type} value`
  }
  ${
    defaultCode
      ? `${defaultCode}`
      : `return ${
          returnType.type === "text"
            ? '"test"'
            : returnType.type === "numeric"
            ? "1"
            : returnType.type === "boolean"
            ? "true"
            : returnType.listOptions
            ? `["${returnType.listOptions[0]}"]`
            : "[]"
        };`
  }
}`;
}

export function getDefaultValue(
  type: ConfiguratorDataType,
  listOptions: string[] | null
): string {
  switch (type) {
    case "numeric":
      return "1";
    case "text":
      return "test";
    case "boolean":
      return "true";
    case "list":
      return listOptions ? listOptions[0] : "";
  }
}

export function generateTypeDefinitions(
  params: Parameter[],
  returnType: ReturnType
): string {
  const properties = params
    .map((parameter) => {
      let typeStr = parameter.type;
      if (parameter.type === "list" && parameter.config?.options) {
        // @ts-expect-error - we know this is a list
        typeStr = parameter.config.options.map((opt) => `"${opt}"`).join(" | ");
      }
      const comment = `/** ${parameter.name} - ${parameter.type} parameter */`;
      return `    ${comment}\n    ${parameter.name}: ${typeStr};`;
    })
    .join("\n\n");

  const returnTypeStr =
    returnType.type === "list" && returnType.listOptions
      ? `(${returnType.listOptions.map((opt) => `"${opt}"`).join(" | ")})[]`
      : returnType.type;

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

export function stripTypeScript(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/interface\s+\w+\s*{[^}]*}/g, "")
    .replace(/type\s+\w+\s*=\s*[^;]+;/g, "")
    .replace(/(\w+)\s*:\s*[^,)]+([,)])/g, "$1$2")
    .replace(/\)\s*:\s*[^{]+({)/g, ") $1")
    .replace(/as\s+[^;,)]+([;,)])/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim();
}
