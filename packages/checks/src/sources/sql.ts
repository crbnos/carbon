// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  loadModule,
  type Node,
  parsePlPgSQLSync,
  parseSync,
  SqlError,
  scanSync,
  type TypeName
} from "libpg-query";
import type { SourceFile } from "../check";

// A check that asks what a migration DOES reads the statements Postgres's own
// parser returns (libpg-query is that parser, compiled to WebAssembly), so a
// comment, a string or an unusual layout cannot hide a statement or fake one.
//
// A migration is several pieces of SQL: the file itself, and the SQL inside
// each function body and DO block. Each piece is a `SqlFragment`. A check that
// cares what runs when the migration is applied reads the fragments it wants
// by `inside`; a check that cares what the SQL says reads them all.

/**
 * Loads the parser. Await it once before reading SQL: `collectFindings` does,
 * and every test file does through `sql.setup.ts`.
 */
export const loadSqlParser = loadModule;

export type SqlStatement = {
  node: Node;
  /** The statement as written, with the comments inside it. */
  text: string;
  /** Where `text` starts: the byte offset a node's `location` counts from. */
  start: number;
  /** The 1-based line the statement starts on. */
  line: number;
};

/** A DO block or a function, and its body as the PL/pgSQL parser reads it. */
export type SqlBody = {
  /** The `DoStmt` or `CreateFunctionStmt` that holds the body. */
  statement: Node;
  /** The PL/pgSQL function tree (`PLpgSQL_function`), when the body is PL/pgSQL. */
  plpgsql?: unknown;
};

export type SqlFragment = {
  statements: SqlStatement[];
  /** The 1-based file line of a node's `location`. */
  lineAt(location: number | undefined): number;
  /** The bodies this SQL sits in, outermost first. Empty for the file itself. */
  inside: SqlBody[];
  /** The PL/pgSQL variable this SQL is the declared default of, when it is one. */
  variable?: string;
};

/** A parse tree node (`{ SelectStmt: {…} }`) and where it sits. */
type SqlNode = {
  node: Node;
  /** The node that contains it; undefined for a statement. */
  parent: SqlNode | undefined;
  /** Its own `location`, or the nearest parent's. */
  location: number | undefined;
};

/** The nodes that contain `found`, nearest first. */
export function* ancestorsOf(found: SqlNode): Generator<Node> {
  for (let at = found.parent; at; at = at.parent) yield at.node;
}

/** A node is an object with one key, a capitalised tag, holding its fields. */
function isNode(value: object): value is Node {
  let tag: string | undefined;
  for (const key in value) {
    if (tag !== undefined) return false;
    tag = key;
  }
  if (tag === undefined) return false;
  const first = tag.charCodeAt(0);
  return first >= 65 && first <= 90;
}

/**
 * Every node under `root`, in the order written, parents before children. A
 * loop with its own stack, not a recursive generator: a migration's trees hold
 * millions of nodes, and each check walks them all.
 */
export function* nodesIn(root: unknown): Generator<SqlNode> {
  type Pending = {
    value: unknown;
    parent: SqlNode | undefined;
    location: number | undefined;
  };
  const stack: Pending[] = [
    { value: root, parent: undefined, location: undefined }
  ];
  for (let next = stack.pop(); next; next = stack.pop()) {
    const { value, parent, location } = next;
    if (value === null || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) {
        stack.push({ value: value[i], parent, location });
      }
      continue;
    }
    let inside = parent;
    let at = location;
    let children: unknown[] = Object.values(value);
    if (isNode(value)) {
      const fields: { location?: unknown } = children[0] ?? {};
      if (typeof fields.location === "number") at = fields.location;
      inside = { node: value, parent, location: at };
      yield inside;
      children = fields === null ? [] : Object.values(fields);
    }
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child !== null && typeof child === "object") {
        stack.push({ value: child, parent: inside, location: at });
      }
    }
  }
}

function isTypeName(value: object): value is TypeName {
  return "names" in value && "typemod" in value;
}

/**
 * Every type written under `root`: a column's, a cast's, a parameter's. A type
 * is a plain field of the node that holds it, not a node, so `nodesIn` does not
 * reach it.
 */
export function* typeNamesIn(root: unknown): Generator<TypeName> {
  if (Array.isArray(root)) {
    for (const item of root) yield* typeNamesIn(item);
    return;
  }
  if (root === null || typeof root !== "object") return;
  if (isTypeName(root)) yield root;
  for (const value of Object.values(root)) yield* typeNamesIn(value);
}

/** `"public".x` and `x` are one object: the name without the default schema. */
export function relationName(relation: {
  schemaname?: string;
  relname?: string;
}): string {
  const { schemaname, relname = "" } = relation;
  return schemaname && schemaname !== "public"
    ? `${schemaname}.${relname}`
    : relname;
}

/** A name written as a list of `String` nodes: `public.f` is `["public", "f"]`. */
export function nameParts(names: Node[] | undefined): string[] {
  return (names ?? []).flatMap((name) =>
    "String" in name && name.String.sval !== undefined ? [name.String.sval] : []
  );
}

/**
 * The line of a byte offset: `firstLine` plus the newlines before it. The
 * newline offsets are found once, on the first lookup, and searched after.
 */
function lineCounter(bytes: Buffer, firstLine: number) {
  let newlines: number[] | undefined;
  return (location: number | undefined) => {
    if (!newlines) {
      newlines = [];
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 10) newlines.push(i);
      }
    }
    const offset = location ?? 0;
    // How many newlines sit before `offset`: the first index not before it.
    let low = 0;
    let high = newlines.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((newlines[middle] ?? 0) < offset) low = middle + 1;
      else high = middle;
    }
    return firstLine + low;
  };
}

/** The offset of the first byte of `text` that is not whitespace or a comment. */
function firstTokenAt(text: string): number {
  // Scanning a whole statement to find its first token was half the cost of
  // reading the migrations. Only a statement that starts with a comment needs
  // the scanner; whitespace is one byte a character, so the index is the offset.
  const start = text.search(/[^ \t\n\r\f\v]/);
  if (start === -1) return 0;
  if (text[start] !== "-" && text[start] !== "/") return start;
  for (const token of scanSync(text).tokens) {
    if (token.tokenName !== "SQL_COMMENT" && token.tokenName !== "C_COMMENT") {
      return token.start;
    }
  }
  return 0;
}

/**
 * The statements of one piece of SQL. Text that is not SQL has none: Postgres
 * refuses such a migration when it is applied, so this is not the place that
 * reports it.
 */
function parseFragment(
  sql: string,
  lineAt: (bytes: Buffer) => (location: number | undefined) => number,
  inside: SqlBody[]
): SqlFragment | undefined {
  if (sql.trim() === "") return undefined;
  const bytes = Buffer.from(sql);
  const toLine = lineAt(bytes);
  try {
    const statements = (parseSync(sql).stmts ?? []).flatMap((raw) => {
      if (!raw.stmt) return [];
      const start = raw.stmt_location ?? 0;
      const end = raw.stmt_len ? start + raw.stmt_len : bytes.length;
      const text = bytes.subarray(start, end).toString();
      return [
        {
          node: raw.stmt,
          text,
          start,
          line: toLine(start + firstTokenAt(text))
        }
      ];
    });
    return { statements, lineAt: toLine, inside };
  } catch (error) {
    if (error instanceof SqlError) return undefined;
    throw error;
  }
}

function option(options: Node[] | undefined, name: string) {
  for (const item of options ?? []) {
    if ("DefElem" in item && item.DefElem.defname === name) return item.DefElem;
  }
  return undefined;
}

function stringOf(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if ("String" in node) return node.String.sval;
  if ("List" in node) return stringOf(node.List.items?.[0]);
  return undefined;
}

/** The body of a function or DO block: its text, language and `AS` position. */
function bodyOf(statement: Node) {
  const options =
    "CreateFunctionStmt" in statement
      ? statement.CreateFunctionStmt.options
      : "DoStmt" in statement
        ? statement.DoStmt.args
        : undefined;
  const as = option(options, "as");
  const text = stringOf(as?.arg);
  if (text === undefined) return undefined;
  const language =
    stringOf(option(options, "language")?.arg)?.toLowerCase() ??
    ("DoStmt" in statement ? "plpgsql" : "sql");
  return { text, language, location: as?.location };
}

type PlpgsqlExpression = {
  query: string;
  lineno: number;
  /** The query is `target := expression`, as PL/pgSQL keeps an assignment. */
  assigns?: boolean;
  variable?: string;
};

/** Every SQL text in a PL/pgSQL tree, with the line of the statement holding it. */
function* plpgsqlExpressions(
  tree: unknown,
  lineno = 1
): Generator<PlpgsqlExpression> {
  if (Array.isArray(tree)) {
    for (const item of tree) yield* plpgsqlExpressions(item, lineno);
    return;
  }
  if (tree === null || typeof tree !== "object") return;
  const fields: { lineno?: unknown; refname?: unknown } = tree;
  const here = typeof fields.lineno === "number" ? fields.lineno : lineno;
  for (const [key, value] of Object.entries(tree)) {
    if (key === "PLpgSQL_expr" && value !== null && typeof value === "object") {
      const { query, parseMode }: { query?: unknown; parseMode?: unknown } =
        value;
      // Modes 3 to 5 are the assignment forms (RAW_PARSE_PLPGSQL_ASSIGN1..3).
      const assigns = typeof parseMode === "number" && parseMode >= 3;
      if (typeof query === "string") yield { query, lineno: here, assigns };
    } else if (
      key === "PLpgSQL_type" &&
      value !== null &&
      typeof value === "object"
    ) {
      // A declared variable's type, read as the cast it is: `v NUMERIC(10,2)`.
      const { typname }: { typname?: unknown } = value;
      if (typeof typname === "string") {
        yield { query: `NULL::${typname}`, lineno: here };
      }
    } else if (key === "default_val" && typeof fields.refname === "string") {
      // `name TYPE := expression` in DECLARE: the expression, with its variable.
      for (const found of plpgsqlExpressions(value, here)) {
        yield { ...found, variable: fields.refname };
      }
    } else {
      yield* plpgsqlExpressions(value, here);
    }
  }
}

/**
 * The expression of `target := expression` (PL/pgSQL also takes `=`): what
 * follows the first assignment sign outside the target's own brackets
 * (`list[i] := …`).
 */
function assignedExpression(query: string): string {
  let depth = 0;
  for (const token of scanSync(query).tokens) {
    if (token.text === "[" || token.text === "(") depth++;
    if (token.text === "]" || token.text === ")") depth--;
    if (depth === 0 && (token.text === ":=" || token.text === "=")) {
      return Buffer.from(query).subarray(token.end).toString();
    }
  }
  return query;
}

/** The words after which a PL/pgSQL statement may start. */
const CONTROL_WORDS = new Set(["BEGIN", "THEN", "ELSE", "LOOP"]);

/**
 * The SQL statements of a PL/pgSQL body, without the PL/pgSQL parser: the
 * body's tokens split at each `;`, and each piece read from its first token,
 * or failing that from after one of its control words (`IF x THEN INSERT …`).
 * Conditions and loop queries are not statements and are not read.
 */
function looseStatements(body: string): { sql: string; line: number }[] {
  const bytes = Buffer.from(body);
  const toLine = lineCounter(bytes, 1);
  const tokens = scanSync(body).tokens.filter(
    (token) =>
      token.tokenName !== "SQL_COMMENT" && token.tokenName !== "C_COMMENT"
  );
  const out: { sql: string; line: number }[] = [];
  let piece: typeof tokens = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.text === "(") depth++;
    if (token.text === ")") depth--;
    if (token.text !== ";" || depth > 0) {
      piece.push(token);
      continue;
    }
    const starts = piece.filter(
      (candidate, index) =>
        index === 0 ||
        CONTROL_WORDS.has(piece[index - 1]?.text.toUpperCase() ?? "")
    );
    for (const start of starts) {
      const sql = bytes.subarray(start.start, token.start).toString();
      try {
        parseSync(sql);
      } catch {
        continue;
      }
      out.push({ sql, line: toLine(start.start) });
      break;
    }
    piece = [];
  }
  return out;
}

/**
 * The fragments inside `fragment`'s function bodies and DO blocks, and inside
 * theirs. A body the PL/pgSQL parser refuses has none.
 */
function bodiesOf(fragment: SqlFragment): SqlFragment[] {
  const out: SqlFragment[] = [];
  const add = (
    sql: string,
    firstLine: number,
    body: SqlBody,
    prefix = "",
    variable?: string
  ): boolean => {
    // The prefix holds no newline, so lines count the same with it.
    const inner = parseFragment(
      prefix + sql,
      (bytes) => lineCounter(bytes, firstLine),
      [...fragment.inside, body]
    );
    if (!inner) return false;
    out.push(variable ? { ...inner, variable } : inner, ...bodiesOf(inner));
    return true;
  };

  for (const statement of fragment.statements) {
    const body = bodyOf(statement.node);
    if (!body) continue;
    // The body's first line: where its text sits in the statement as written.
    // A body written with quote escapes is not found verbatim; its lines then
    // count from the statement's own.
    const at = statement.text.indexOf(body.text);
    const firstLine =
      statement.line +
      (at === -1
        ? 0
        : statement.text.slice(firstTokenAt(statement.text), at).split("\n")
            .length - 1);

    if (body.language === "sql") {
      add(body.text, firstLine, { statement: statement.node });
      continue;
    }
    if (body.language !== "plpgsql") continue;
    let plpgsql: unknown;
    try {
      plpgsql = parsePlPgSQLSync(statement.text);
    } catch {
      // The PL/pgSQL parser has no catalog, so it refuses some bodies Postgres
      // accepts (a `%ROWTYPE` variable it cannot look up). Their statements
      // are still read, one by one.
      for (const piece of looseStatements(body.text)) {
        add(piece.sql, firstLine + piece.line - 1, {
          statement: statement.node
        });
      }
      continue;
    }
    const inside: SqlBody = { statement: statement.node, plpgsql };
    const bodyLines = body.text.split("\n");
    for (const found of plpgsqlExpressions(plpgsql)) {
      const { query, lineno, variable } = found;
      const expression = found.assigns ? assignedExpression(query) : query;
      // PL/pgSQL gives the line of the statement that holds the SQL, counted
      // from the body's first. The SQL itself is found from there on, for its
      // exact line; SQL the parser rewrote (an INTO target blanked out, a
      // declared type) is not in the body as such and takes the statement's.
      const statementAt = bodyLines.slice(0, lineno - 1).join("\n").length;
      const at = body.text.indexOf(expression, statementAt);
      const line =
        firstLine +
        (at === -1 ? lineno : body.text.slice(0, at).split("\n").length) -
        1;
      if (add(expression, line, inside, "", variable)) continue;
      if (!add(expression, line, inside, "SELECT ", variable)) continue;
      // EXECUTE 'a statement': the SQL it runs, when it is a plain string.
      const [only] = out.at(-1)?.statements ?? [];
      const target =
        only && "SelectStmt" in only.node
          ? only.node.SelectStmt.targetList?.[0]
          : undefined;
      const value =
        target && "ResTarget" in target ? target.ResTarget.val : undefined;
      const text =
        value && "A_Const" in value ? value.A_Const.sval?.sval : undefined;
      if (text !== undefined) add(text, line, inside);
    }
  }
  return out;
}

// Every SQL check reads the same files, and the ones that read several files read every
// migration again, so each file is parsed once.
const parsed = new Map<string, SqlFragment[]>();

/**
 * Every piece of SQL in a file: the file first, then each function body and DO
 * block (and the SQL an `EXECUTE` of a plain string runs). The pieces of one
 * body come in the PL/pgSQL tree's order, not always the written one: sort by
 * line where order matters.
 */
export function sqlFragments(contents: string): SqlFragment[] {
  const known = parsed.get(contents);
  if (known) return known;
  const file = parseFragment(contents, (bytes) => lineCounter(bytes, 1), []);
  const fragments = file ? [file, ...bodiesOf(file)] : [];
  parsed.set(contents, fragments);
  return fragments;
}

/**
 * `files`, once the parser has read every one of them. A file the parser
 * refuses has no statements, so every SQL check would pass it unread; it
 * fails here instead, by name.
 */
export function readableSql(files: SourceFile[]): SourceFile[] {
  const refused = files
    .filter(
      ({ contents }) =>
        contents.trim() !== "" && sqlFragments(contents).length === 0
    )
    .map(({ file }) => file);
  if (refused.length > 0) {
    throw new Error(
      `The SQL parser cannot read ${refused.join(", ")}, so no SQL check can check it. Correct the SQL; if Postgres accepts it as written, update libpg-query.`
    );
  }
  return files;
}

type SqlFileNode = SqlNode & {
  fragment: SqlFragment;
  statement: SqlStatement;
  line: number;
};

// Most SQL checks walk every node of every migration, so each file's nodes are
// listed once.
const listed = new Map<string, readonly SqlFileNode[]>();

/**
 * Every node of every fragment, with the fragment and statement it is in and
 * its file line: its own, or the statement's when the parser keeps none for it.
 */
export function sqlNodes(contents: string): readonly SqlFileNode[] {
  const known = listed.get(contents);
  if (known) return known;
  const out: SqlFileNode[] = [];
  for (const fragment of sqlFragments(contents)) {
    for (const statement of fragment.statements) {
      for (const found of nodesIn(statement.node)) {
        const line =
          found.location === undefined
            ? statement.line
            : fragment.lineAt(found.location);
        out.push({
          node: found.node,
          parent: found.parent,
          location: found.location,
          fragment,
          statement,
          line
        });
      }
    }
  }
  listed.set(contents, out);
  return out;
}

/**
 * The words and symbols of a statement from `location` on, comments left out.
 * For what the parse tree does not keep: it records a foreign key's action,
 * not whether the statement wrote one.
 */
export function tokensFrom(statement: SqlStatement, location: number) {
  return scanSync(statement.text).tokens.filter(
    (token) =>
      token.start >= location - statement.start &&
      token.tokenName !== "SQL_COMMENT" &&
      token.tokenName !== "C_COMMENT"
  );
}
