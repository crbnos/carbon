import type { StructureCheck, Violation } from "../check";

/** Literal entries every module must contain. Edit this to grow the rule. */
const REQUIRED_ENTRIES = ["types.ts", "ui", "index.ts"];

export const moduleShape: StructureCheck = {
  id: "module-shape",
  description:
    "Each ERP module: one <name>.service.ts (or <name>.ee.service.ts), one <name>.models.ts, types.ts, ui/, index.ts.",
  provenance: {
    deprecates: "scattered service/models files",
    replacedBy: "one <module>.service.ts + one <module>.models.ts"
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

    return violations;
  }
};
