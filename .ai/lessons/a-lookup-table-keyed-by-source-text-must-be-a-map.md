---
paths: ["scripts/lib/service-ast.ts"]
triggers: ["memberName", "Object.hasOwn"]
promoted: null
---
# A lookup table keyed by source text must be a `Map`

**Context:** The MCP generator decided "is this call a database write" with
`WRITES[memberName]` over an object literal.

**Problem:** `memberName` comes from the code being analysed, so `x.toString()` looked up
`WRITES["toString"]`, found `Object.prototype.toString`, and counted as a write. Five read
tools silently left the manifest until the digest diff showed them missing.

**Rule:** When the key is arbitrary input (an identifier from parsed source, a column name,
a user string), use a `Map`/`Set` or `Object.hasOwn`, never `obj[key]` truthiness. And diff
the generated manifest against the previous one before trusting a generator change.

**Applies to:** `scripts/lib/service-ast.ts`, and any analyser or dispatcher that indexes a
record by a name it did not choose.
