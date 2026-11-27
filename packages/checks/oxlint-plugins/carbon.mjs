// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// route-action-shape: an ERP route writes only through a service function.
// A write in a route is logic the API and MCP cannot reach: a tool named like
// the button does less than the button. Only calls that are certainly writes
// match; `.rpc()` reads as often as it writes.
//
// Deprecates: a route action that composes writes itself.
// Replaced by: one defineServiceFn per operation, called through authorize(request).
// Since: 2026-10-15.

const POSTINGS = new Set([
  "invokePosting",
  "invokePostingOrThrow",
  "invokeCreate"
]);
const KYSELY_WRITES = new Set(["insertInto", "updateTable", "deleteFrom"]);
const CLIENT_WRITES = new Set(["insert", "upsert", "update", "delete"]);

/** The name of `x.name`, or null for anything else (`x[name]` included). */
function propertyName(node) {
  if (node.type !== "MemberExpression" || node.computed) return null;
  return node.property.type === "Identifier" ? node.property.name : null;
}

/** `<client>.from(<table>)` */
function isFromCall(node) {
  return (
    node.type === "CallExpression" &&
    node.arguments.length === 1 &&
    propertyName(node.callee) === "from"
  );
}

function isWrite(callee) {
  if (callee.type === "Identifier") return POSTINGS.has(callee.name);
  const name = propertyName(callee);
  if (KYSELY_WRITES.has(name)) return true;
  return CLIENT_WRITES.has(name) && isFromCall(callee.object);
}

const routeActionShape = {
  meta: {
    type: "problem",
    docs: {
      description: "An ERP route writes only through a service function"
    }
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isWrite(node.callee)) return;
        context.report({
          node: node.callee,
          message:
            "Move this write into a service function (defineServiceFn in the module's .server.ts) and call it from the route."
        });
      }
    };
  }
};

export default {
  meta: { name: "carbon" },
  rules: { "route-action-shape": routeActionShape }
};
