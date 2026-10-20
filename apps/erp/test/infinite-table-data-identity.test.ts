// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * `useInfiniteRows` reads a new `data` array as a revalidation: it re-reads
 * every loaded page (up to 20). So a table with `infinite` must pass the
 * loader's array itself, or a memoized one. A copy built in the render body
 * (`const rows = data.map(…)`) is a new array on every render, and every
 * render then refreshes the whole list.
 */

const APP = join(__dirname, "..", "app");

const COPY_METHODS = new Set(["map", "filter", "slice", "concat", "toSorted"]);

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

function parse(source: string) {
  return ts.createSourceFile(
    "file.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** A new array on every evaluation: `x.map(…)` and the like, or `[...x]`. */
function isArrayCopy(node: ts.Expression): boolean {
  const expression = unwrap(node);
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.some(ts.isSpreadElement);
  }
  return (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    COPY_METHODS.has(expression.expression.name.text)
  );
}

function visit(node: ts.Node, onNode: (node: ts.Node) => void) {
  onNode(node);
  ts.forEachChild(node, (child) => visit(child, onNode));
}

/** The `data={…}` expression of every `<Table>` element that has `infinite`. */
function infiniteDataExpressions(file: ts.SourceFile): ts.Expression[] {
  const expressions: ts.Expression[] = [];
  visit(file, (node) => {
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) {
      return;
    }
    if (node.tagName.getText(file) !== "Table") return;
    const attribute = (name: string) =>
      node.attributes.properties.find(
        (property): property is ts.JsxAttribute =>
          ts.isJsxAttribute(property) && property.name.getText(file) === name
      );
    const data = attribute("data")?.initializer;
    if (!attribute("infinite") || !data || !ts.isJsxExpression(data)) return;
    if (data.expression) expressions.push(data.expression);
  });
  return expressions;
}

/** The names of the variables in the file that hold a render-body copy. */
function renderCopyNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  visit(file, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isArrayCopy(node.initializer)
    ) {
      names.add(node.name.text);
    }
  });
  return names;
}

/** How each infinite table's `data` is written that copies during render. */
function renderCopies(source: string): string[] {
  const file = parse(source);
  const copies = renderCopyNames(file);
  return infiniteDataExpressions(file).flatMap((expression) => {
    const data = unwrap(expression);
    if (isArrayCopy(data)) return [data.getText(file)];
    if (ts.isIdentifier(data) && copies.has(data.text)) return [data.text];
    return [];
  });
}

describe("infinite tables pass a stable data array", () => {
  const files = tsxFiles(APP).filter((file) =>
    readFileSync(file, "utf8").includes("infinite={")
  );

  it("reads the data of every infinite table", () => {
    const tables = files.reduce(
      (total, file) =>
        total + infiniteDataExpressions(parse(readFileSync(file, "utf8"))).length,
      0
    );
    // Most files with `infinite={` render one infinite `<Table>`.
    expect(tables).toBeGreaterThan(100);
  });

  it("never passes an array copied during render", () => {
    const offenders = files.flatMap((file) =>
      renderCopies(readFileSync(file, "utf8")).map(
        (data) => `${relative(APP, file)}: data={${data}}`
      )
    );
    expect(offenders).toEqual([]);
  });

  it("detects a copy built with .map, behind props that contain =>", () => {
    const source = `
      const rows = data.map((row) => ({ ...row }));
      return (
        <Table<Row>
          onRowClick={(row) => navigate(row.id)}
          data={rows}
          infinite={{ dataKey: "x", nextCursor }}
        />
      );
    `;
    expect(renderCopies(source)).toEqual(["rows"]);
  });

  it("detects a copy written inline and a spread copy", () => {
    expect(
      renderCopies(
        `<Table data={data.filter((r) => r.ok)} infinite={{ dataKey: "x" }} />`
      )
    ).toEqual(["data.filter((r) => r.ok)"]);
    expect(
      renderCopies(`
        const rows = [...data];
        <Table data={rows} infinite={{ dataKey: "x" }}></Table>
      `)
    ).toEqual(["rows"]);
  });

  it("accepts a memoized array and the loader's own array", () => {
    const source = `
      const rows = useMemo(() => data.map((row) => ({ ...row })), [data]);
      <Table data={rows} infinite={{ dataKey: "x", nextCursor }} />;
      <Table data={data} infinite={{ dataKey: "y", nextCursor }} />;
    `;
    expect(renderCopies(source)).toEqual([]);
  });

  it("ignores a table without infinite", () => {
    expect(renderCopies(`<Table data={data.map((r) => r)} />`)).toEqual([]);
  });
});
