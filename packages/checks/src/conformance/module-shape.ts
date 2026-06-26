import type { StructureCheck, Violation } from "../check";

/** Literal entries every module must contain. Edit this to grow the rule. */
const REQUIRED_ENTRIES = ["types.ts", "ui", "index.ts"];

export const moduleShape: StructureCheck = {
  id: "module-shape",
  description:
    "Each ERP module: one <name>.service.ts, one <name>.models.ts, types.ts, ui/, index.ts.",
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
      const expected = `${module.name}.${kind}.ts`;
      const found = module.entries.filter((e) => e.endsWith(`.${kind}.ts`));
      if (!found.includes(expected)) {
        add(
          `missing:${expected}`,
          `Module "${module.name}" must have ${expected}.`
        );
      }
      for (const extra of found.filter((e) => e !== expected)) {
        add(
          `extra-${kind}:${extra}`,
          `Extra ${kind} file "${extra}" — fold into ${expected}.`
        );
      }
    }

    return violations;
  }
};
