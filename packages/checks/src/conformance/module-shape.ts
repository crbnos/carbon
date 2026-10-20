// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { StructureCheck, Violation } from "../check";

/** Literal entries every module must contain. Edit this to grow the rule. */
const REQUIRED_ENTRIES = ["types.ts", "ui"];

/** A module has no barrel: everything is imported from the file that defines it. */
const BARRELS = ["index.ts", "index.server.ts"];

const isTest = (entry: string) => /\.(test|spec)\.tsx?$/.test(entry);

export const moduleShape: StructureCheck = {
  id: "module-shape",
  description:
    "Each ERP module: one <name>.service.ts (or <name>.ee.service.ts), one <name>.models.ts, types.ts, ui/, at most one <name>.server.ts, and no barrel.",
  provenance: {
    deprecates:
      "scattered service/models files, module barrels (index.ts, index.server.ts), and server files besides <module>.server.ts",
    replacedBy:
      "one <module>.service.ts + one <module>.models.ts; <module>.server.ts for the service functions; imports from the defining file"
  },
  inspect(module): Violation[] {
    const violations: Violation[] = [];
    const add = (snippet: string, message: string) =>
      violations.push({ file: module.name, line: 0, snippet, message });

    for (const name of REQUIRED_ENTRIES) {
      if (!module.entries.includes(name)) {
        add(`missing:${name}`, `Module "${module.name}" is missing ${name}.`);
      }
    }

    for (const kind of ["service", "models"] as const) {
      const canonical = `${module.name}.${kind}.ts`;
      // A `.ee` infix marks a file as commercial-licensed (see root LICENSE);
      // a module may keep its single service/models file under that name.
      const eeVariant = `${module.name}.ee.${kind}.ts`;
      const found = module.entries.filter((e) => e.endsWith(`.${kind}.ts`));
      if (!found.includes(canonical) && !found.includes(eeVariant)) {
        add(
          `missing:${canonical}`,
          `Module "${module.name}" must have ${canonical} (or ${eeVariant}).`
        );
      }
      for (const extra of found.filter(
        (e) => e !== canonical && e !== eeVariant
      )) {
        add(
          `extra-${kind}:${extra}`,
          `Extra ${kind} file "${extra}" — fold into ${canonical}.`
        );
      }
    }

    for (const barrel of BARRELS.filter((b) => module.entries.includes(b))) {
      add(
        `barrel:${barrel}`,
        `Module "${module.name}" has a barrel (${barrel}): import from the file that defines a thing, and let the router import ${module.name}.server.ts as a namespace.`
      );
    }

    const server = `${module.name}.server.ts`;
    const servers = [server, `${module.name}.ee.server.ts`];
    for (const extra of module.entries.filter(
      (e) =>
        /\.server\.tsx?$/.test(e) &&
        !servers.includes(e) &&
        !isTest(e) &&
        !BARRELS.includes(e)
    )) {
      add(
        `extra-server:${extra}`,
        `"${extra}": a module's only .server file is ${server}, and it holds service functions. Move its functions into ${module.name}.service.ts.`
      );
    }

    return violations;
  }
};
