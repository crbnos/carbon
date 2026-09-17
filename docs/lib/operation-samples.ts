import { DEFAULT_APP_ORIGIN, DEFAULT_MCP_ENDPOINT } from "@/components/api/config-constants";
import type { JsonSchemaNode } from "@/components/api/schema-table";

/**
 * Request samples for one Carbon API operation, in both transports it is reachable
 * over. Built with the literal default hosts so `applyConfig` can rewrite them to
 * whatever instance the reader configured (see `config-context.tsx`).
 */

export const TRANSPORTS = ["http", "mcp"] as const;
export type Transport = (typeof TRANSPORTS)[number];

/**
 * Order matters — it is the dropdown order. cURL first (it is the one everyone can
 * read), then the languages Carbon integrators actually write in: web, scripting,
 * services, and the two that dominate manufacturing back-offices, .NET and Java.
 */
export const HTTP_LANGS = [
  "curl",
  "javascript",
  "python",
  "go",
  "csharp",
  "java",
  "php",
  "ruby"
] as const;
export type HttpLang = (typeof HTTP_LANGS)[number];

/** Sample key: every HTTP language, plus the single MCP snippet. */
export type SampleKey = `http.${HttpLang}` | "mcp";

export const SAMPLE_KEYS: SampleKey[] = [
  ...HTTP_LANGS.map((l) => `http.${l}` as SampleKey),
  "mcp",
];

/** The shiki grammar to highlight each sample with. */
export const SAMPLE_GRAMMAR: Record<SampleKey, string> = {
  "http.curl": "curl",
  "http.javascript": "javascript",
  "http.python": "python",
  "http.go": "go",
  "http.csharp": "csharp",
  "http.java": "java",
  "http.php": "php",
  "http.ruby": "ruby",
  mcp: "javascript",
};

/** Dropdown labels — the language's own spelling, not its key. */
export const HTTP_LANG_LABELS: Record<HttpLang, string> = {
  curl: "cURL",
  javascript: "JavaScript",
  python: "Python",
  go: "Go",
  csharp: "C#",
  java: "Java",
  php: "PHP",
  ruby: "Ruby"
};

/**
 * A representative value for a parameter. An enum uses its first real value rather
 * than `"string"`, so the copyable sample is one the operation would actually accept.
 */
function exampleArg(prop: unknown): unknown {
  if (!prop || typeof prop !== "object") return "string";
  const p = prop as JsonSchemaNode;
  if (Array.isArray(p.enum) && p.enum.length > 0) return p.enum[0];
  if (p.default !== undefined) return p.default;
  const type = Array.isArray(p.type) ? p.type.find((t) => t !== "null") : p.type;
  switch (type) {
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return true;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return "string";
  }
}

/** Required arguments only — the smallest call that can succeed. */
export function exampleArgs(schema: unknown): Record<string, unknown> {
  const s = (schema ?? {}) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  const props = s.properties ?? {};
  const required = s.required ?? Object.keys(props);
  const out: Record<string, unknown> = {};
  for (const key of required) out[key] = exampleArg(props[key]);
  return out;
}

/** `sales_copyQuote` + module `sales` → `copyQuote`, the id used in the v1 path. */
export function operationPath(toolName: string, moduleSlug: string): string {
  const id = toolName.startsWith(`${moduleSlug}_`)
    ? toolName.slice(moduleSlug.length + 1)
    : toolName;
  return `/api/v1/${moduleSlug}/${id}`;
}

function indent(json: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return json.split("\n").join(`\n${pad}`);
}

export function buildOperationSamples(
  toolName: string,
  moduleSlug: string,
  schema: unknown
): Record<SampleKey, string> {
  const args = exampleArgs(schema);
  const path = operationPath(toolName, moduleSlug);
  const url = `${DEFAULT_APP_ORIGIN}${path}`;
  const body = JSON.stringify(args, null, 2);
  const hasArgs = Object.keys(args).length > 0;

  const curl = [
    `curl -X POST '${url}' \\`,
    `  -H 'Authorization: Bearer <api-key>' \\`,
    hasArgs ? `  -H 'Content-Type: application/json' \\` : `  -H 'Content-Type: application/json'`,
    ...(hasArgs ? [`  -d '${indent(body, 2)}'`] : []),
  ].join("\n");

  const javascript = `const response = await fetch("${url}", {
  method: "POST",
  headers: {
    Authorization: "Bearer <api-key>",
    "Content-Type": "application/json"
  },
  body: JSON.stringify(${indent(body, 2)})
});

const data = await response.json();`;

  const python = `import requests

response = requests.post(
    "${url}",
    headers={
        "Authorization": "Bearer <api-key>",
        "Content-Type": "application/json",
    },
    json=${indent(body, 4)},
)

data = response.json()`;

  // MCP reaches the same operation through the call_tool meta-tool, where the tool
  // name keeps its module prefix.
  const mcp = `// POST ${DEFAULT_MCP_ENDPOINT}
call_tool(${JSON.stringify({ name: toolName, arguments: args }, null, 2)})`;

  const go = `package main

import (
	"bytes"
	"net/http"
)

func main() {
	body := []byte(\`${indent(body, 1).replace(/\n/g, "\n\t")}\`)

	req, _ := http.NewRequest("POST", "${url}", bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer <api-key>")
	req.Header.Set("Content-Type", "application/json")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer res.Body.Close()
}`;

  const csharp = `using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;

var client = new HttpClient();
client.DefaultRequestHeaders.Authorization =
    new AuthenticationHeaderValue("Bearer", "<api-key>");

var body = new StringContent(
    """
    ${indent(body, 4)}
    """,
    Encoding.UTF8,
    "application/json");

var response = await client.PostAsync("${url}", body);
var data = await response.Content.ReadAsStringAsync();`;

  const java = `import java.net.URI;
import java.net.http.*;

var client = HttpClient.newHttpClient();

var request = HttpRequest.newBuilder()
    .uri(URI.create("${url}"))
    .header("Authorization", "Bearer <api-key>")
    .header("Content-Type", "application/json")
    .POST(HttpRequest.BodyPublishers.ofString("""
        ${indent(body, 8)}
        """))
    .build();

var response = client.send(request, HttpResponse.BodyHandlers.ofString());`;

  const php = `<?php

$ch = curl_init('${url}');

curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer <api-key>',
        'Content-Type: application/json',
    ],
    CURLOPT_POSTFIELDS => json_encode(${phpArray(args, 4)}),
]);

$data = json_decode(curl_exec($ch), true);
curl_close($ch);`;

  const ruby = `require "net/http"
require "json"

uri = URI("${url}")

request = Net::HTTP::Post.new(uri)
request["Authorization"] = "Bearer <api-key>"
request["Content-Type"] = "application/json"
request.body = JSON.generate(${rubyHash(args, 2)})

response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == "https") do |http|
  http.request(request)
end

data = JSON.parse(response.body)`;

  return {
    "http.curl": curl,
    "http.javascript": javascript,
    "http.python": python,
    "http.go": go,
    "http.csharp": csharp,
    "http.java": java,
    "http.php": php,
    "http.ruby": ruby,
    mcp,
  };
}

/** PHP has no JSON literal, so the body is rendered as an associative array. */
function phpArray(value: unknown, spaces: number): string {
  const json = JSON.stringify(value, null, 2)
    .replace(/^\{/, "[")
    .replace(/\}$/, "]")
    .replace(/"([^"]+)":/g, "'$1' =>")
    .replace(/"/g, "'");
  return indent(json, spaces);
}

/** Ruby renders the body as a hash literal with symbol-ish string keys. */
function rubyHash(value: unknown, spaces: number): string {
  const json = JSON.stringify(value, null, 2).replace(/"([^"]+)":/g, '"$1" =>');
  return indent(json, spaces);
}
