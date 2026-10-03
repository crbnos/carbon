// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * How a service reports failure in the value it returns.
 *
 * A service does not throw: it returns what happened, and dispatch has to read
 * it. Dispatch used to read exactly one shape, `{ data, error }`, so a result
 * that carried its `error` any other way went back to the caller as a success
 * with the error inside it. The shape is read here off the declared return type
 * by the checker, recorded in the manifest, and followed by `dispatchOperation`:
 *
 *  - `envelope`  an object with an `error` member — PostgREST's response, or a
 *                hand-built `{ error }` with or without `data`.
 *  - `envelopes` a list of those — a `Promise.all` of writes.
 *  - `flag`      an object that says `ok` / `success` and carries no `error`.
 *  - `plain`     none of the above: the value is the result.
 *
 * A return type dispatch could not read unambiguously fails generation.
 */
import { ts } from "ts-morph";
import type { ResultShape } from "@carbon/api";
import type { ServiceFunction } from "./service-ast";

type MemberKind = "envelope" | "flag" | "plain";

const NULLISH =
  ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void;

function members(type: ts.Type): ts.Type[] {
  const all = type.isUnion() ? type.types : [type];
  return all.filter((member) => !(member.flags & NULLISH));
}

function memberKind(checker: ts.TypeChecker, type: ts.Type): MemberKind {
  if (!(type.flags & ts.TypeFlags.Object)) return "plain";
  const names = new Set(
    checker.getPropertiesOfType(type).map((property) => property.getName())
  );
  // PostgREST's response has both `error` and `success`; `error` decides.
  if (names.has("error")) return "envelope";
  if (names.has("ok") || names.has("success")) return "flag";
  return "plain";
}

export function resultShapeOf(
  checker: ts.TypeChecker,
  fn: Pick<ServiceFunction, "node" | "toolName">
): ResultShape {
  const declared = fn.node.getReturnType().compilerType;
  // Resolves a Promise and a query builder returned without `await` alike.
  const awaited = checker.getAwaitedType(declared) ?? declared;
  const top = members(awaited);

  const isList =
    top.length === 1 &&
    (checker.isArrayType(top[0]) || checker.isTupleType(top[0]));
  const parts = isList
    ? checker.getTypeArguments(top[0] as ts.TypeReference).flatMap(members)
    : top;
  const kinds = new Set(parts.map((part) => memberKind(checker, part)));

  if (kinds.has("envelope") && kinds.has("flag")) {
    throw new Error(
      `${fn.toolName} returns both a result with an \`error\` member and one that says \`ok\`/\`success\` without it, so dispatch cannot tell which reports failure. Return one shape.`
    );
  }
  if (isList) {
    if (kinds.size > 1 || kinds.has("flag")) {
      throw new Error(
        `${fn.toolName} returns a list whose items do not all report failure the same way, so dispatch cannot read it. Return a list of \`{ data, error }\` results or a list of plain values.`
      );
    }
    return kinds.has("envelope") ? "envelopes" : "plain";
  }
  if (kinds.has("envelope")) return "envelope";
  if (kinds.has("flag")) return "flag";
  return "plain";
}
