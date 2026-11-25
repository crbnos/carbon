// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  ancestorsOf,
  nameParts,
  nodesIn,
  readableSql,
  sqlFragments,
  sqlNodes,
  tokensFrom,
  typeNamesIn
} from "./sql";

/** Every function called in `sql`, with its line and how deep in bodies it sits. */
const calls = (sql: string) =>
  [...sqlNodes(sql)].flatMap(({ node, line, fragment }) =>
    "FuncCall" in node
      ? [
          [
            nameParts(node.FuncCall.funcname).at(-1),
            line,
            fragment.inside.length
          ]
        ]
      : []
  );

describe("sqlFragments", () => {
  it("reads the file's statements with their text and line", () => {
    const [file] = sqlFragments("-- a note\nSELECT 1;\n\n  SELECT 2;");
    expect(file?.statements.map((s) => [s.line, s.text.trim()])).toEqual([
      [2, "SELECT 1"],
      [4, "SELECT 2"]
    ]);
    expect(file?.inside).toEqual([]);
  });

  it("gives a statement the line of its first word when a comment sits inside it", () => {
    const [file] = sqlFragments("SELECT 1;\nSELECT\n  2 -- two\n  , 3;");
    expect(file?.statements.map((s) => s.line)).toEqual([1, 2]);
  });

  it("gives no statements for text that is not SQL, or is empty", () => {
    expect(sqlFragments('"x" TEXT NOT NULL,')).toEqual([]);
    expect(sqlFragments("  \n")).toEqual([]);
    expect(sqlFragments("-- only a comment")[0]?.statements).toEqual([]);
  });

  it("reads a PL/pgSQL body: statements, conditions, loop queries and assignments, at their lines", () => {
    const sql = [
      "CREATE FUNCTION f() RETURNS SETOF int",
      "LANGUAGE plpgsql AS $$",
      "DECLARE",
      "  r RECORD;",
      "  v TEXT;",
      "BEGIN",
      "  IF in_condition() THEN",
      "    PERFORM in_statement();",
      "  END IF;",
      "  FOR r IN SELECT in_loop_query() LOOP",
      "    v := in_assignment();",
      "  END LOOP;",
      "  RETURN",
      "    QUERY SELECT",
      "      on_a_later_line();",
      "END $$;"
    ].join("\n");
    // A loop's body comes before its query in the PL/pgSQL tree, so by line.
    const byLine = calls(sql).sort((a, b) => Number(a[1]) - Number(b[1]));
    expect(byLine).toEqual([
      ["in_condition", 7, 1],
      ["in_statement", 8, 1],
      ["in_loop_query", 10, 1],
      ["in_assignment", 11, 1],
      ["on_a_later_line", 15, 1]
    ]);
  });

  it("reads a SQL-language body and a DO block", () => {
    const sql = [
      "CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $$",
      "  SELECT in_sql_body()",
      "$$;",
      "DO $$ BEGIN",
      "  PERFORM in_do_block();",
      "END $$;"
    ].join("\n");
    expect(calls(sql)).toEqual([
      ["in_sql_body", 2, 1],
      ["in_do_block", 5, 1]
    ]);
  });

  it("reads the SQL an EXECUTE of a plain string runs, and a function defined in a DO block", () => {
    const sql = [
      "DO $do$ BEGIN",
      "  EXECUTE 'SELECT in_executed_string()';",
      "  CREATE FUNCTION g() RETURNS int LANGUAGE sql AS $g$ SELECT nested() $g$;",
      "END $do$;"
    ].join("\n");
    expect(calls(sql).map(([name, , depth]) => [name, depth])).toEqual([
      ["in_executed_string", 1],
      ["nested", 2]
    ]);
  });

  it("marks the SQL that is a declared variable's default", () => {
    const sql = [
      "CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$",
      "DECLARE",
      "  ignored CONSTANT TEXT[] := ARRAY['a', 'b'];",
      "BEGIN",
      "END $$;"
    ].join("\n");
    const declared = sqlFragments(sql).find((f) => f.variable === "ignored");
    expect(declared?.statements[0]?.line).toBe(3);
    expect(declared?.statements[0]?.text).toBe("SELECT ARRAY['a', 'b']");
  });

  it("reads a declared variable's type as a cast, at the variable's line", () => {
    const sql = [
      "CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$",
      "DECLARE",
      "  v NUMERIC(10,2);",
      "BEGIN",
      "END $$;"
    ].join("\n");
    const declared = [...sqlNodes(sql)].find(
      ({ node }) =>
        "TypeCast" in node &&
        nameParts(node.TypeCast.typeName?.names).at(-1) === "numeric"
    );
    expect(declared?.line).toBe(3);
  });

  it("still reads the statements of a body the PL/pgSQL parser refuses", () => {
    // A %ROWTYPE variable cannot be looked up without a catalog.
    const sql = [
      "CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$",
      "DECLARE",
      '  v_row "someTable"%ROWTYPE;',
      "BEGIN",
      "  SELECT * INTO v_row.a, v_row FROM t;",
      "  IF v_row.a IS NULL THEN",
      "    PERFORM after_then();",
      "  END IF;",
      "  UPDATE t SET a = plain_statement();",
      "END $$;"
    ].join("\n");
    const [, ...bodies] = sqlFragments(sql);
    expect(bodies.every((body) => body.inside[0]?.plpgsql === undefined)).toBe(
      true
    );
    expect(calls(sql).map(([name, line]) => [name, line])).toEqual([
      ["plain_statement", 9]
    ]);
  });
});

describe("sqlNodes", () => {
  it("gives a node the statement's line when the parser keeps none for it, and its ancestors", () => {
    const sql = 'SELECT 1;\n\nALTER TABLE "t"\n  ADD COLUMN "c" TEXT;';
    const column = [...sqlNodes(sql)].find(({ node }) => "ColumnDef" in node);
    const command = [...sqlNodes(sql)].find(
      ({ node }) => "AlterTableCmd" in node
    );
    expect(column?.line).toBe(4);
    expect(command?.line).toBe(3);
    expect(
      column && [...ancestorsOf(column)].map((node) => Object.keys(node)[0])
    ).toEqual(["AlterTableCmd", "AlterTableStmt"]);
  });

  it("walks a statement that holds an empty object, as the parser writes the constant 0", () => {
    expect(
      [...sqlNodes("SELECT 0;")].map(({ node }) => Object.keys(node)[0])
    ).toEqual(["SelectStmt", "ResTarget", "A_Const"]);
  });

  it("has no nodes under a value that is absent", () => {
    // A check hands over an optional part as it is: an UPDATE's missing WHERE.
    expect([...nodesIn(undefined)]).toEqual([]);
  });

  it("counts lines in bytes, as the parser's locations are", () => {
    const sql = "SELECT 'é—é';\nSELECT late();";
    const late = [...sqlNodes(sql)].find(({ node }) => "FuncCall" in node);
    expect(late?.line).toBe(2);
  });
});

describe("typeNamesIn and tokensFrom", () => {
  it("finds a column's, a cast's and a parameter's type", () => {
    const sql =
      "CREATE TABLE t (a int);\nSELECT 1::text;\nCREATE FUNCTION f(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;";
    const [file] = sqlFragments(sql);
    const types = [
      ...typeNamesIn(file?.statements.map((statement) => statement.node))
    ].map((type) => nameParts(type.names).at(-1));
    expect(types).toEqual(["int4", "text", "uuid", "void"]);
  });

  it("gives the written tokens from a location on, comments left out", () => {
    const sql =
      'CREATE TABLE t (a TEXT REFERENCES "job" -- why\n  ON DELETE NO ACTION);';
    const [file] = sqlFragments(sql);
    const [statement] = file?.statements ?? [];
    const at = sql.indexOf("REFERENCES");
    expect(
      statement && tokensFrom(statement, at).map((token) => token.text)
    ).toEqual(["REFERENCES", '"job"', "ON", "DELETE", "NO", "ACTION", ")"]);
  });
});

describe("readableSql", () => {
  it("returns the files when the parser reads every one", () => {
    const files = [
      { file: "a.sql", contents: "SELECT 1;" },
      { file: "empty.sql", contents: "\n" },
      { file: "comment.sql", contents: "-- nothing to run yet\n" }
    ];
    expect(readableSql(files)).toBe(files);
  });

  it("fails, naming the file, when the parser refuses one", () => {
    expect(() =>
      readableSql([
        { file: "a.sql", contents: "SELECT 1;" },
        { file: "b.sql", contents: "CREATE TABEL t (a TEXT);" }
      ])
    ).toThrow(/cannot read b\.sql,/);
  });
});
