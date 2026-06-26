import { describe, expect, it } from "vitest";
import { findClobbers, objectRefs } from "./clobber";

describe("objectRefs", () => {
  it("extracts views, functions, and event-trigger redefinitions", () => {
    const sql = `
      CREATE OR REPLACE VIEW "salesOrders" AS SELECT * FROM x;
      CREATE OR REPLACE FUNCTION get_total() RETURNS int AS $$ $$;
      SELECT attach_event_trigger('job', ARRAY[]::text[]);
    `;
    expect(objectRefs(sql)).toEqual(
      new Set(["view:salesOrders", "function:get_total", "event-trigger:job"])
    );
  });

  it("ignores non-redefining SQL", () => {
    expect(objectRefs("SELECT 1; INSERT INTO t VALUES (1);").size).toBe(0);
  });
});

describe("findClobbers", () => {
  it("flags an object redefined on both sides", () => {
    const branch = [
      { file: "b.sql", contents: 'CREATE OR REPLACE VIEW "v" AS SELECT 1;' }
    ];
    const main = [
      { file: "m.sql", contents: 'CREATE OR REPLACE VIEW "v" AS SELECT 2;' }
    ];
    const v = findClobbers(branch, main);
    expect(v).toHaveLength(1);
    expect(v[0]?.snippet).toBe("view:v");
    expect(v[0]?.file).toBe("b.sql");
    expect(v[0]?.message).toContain("m.sql");
  });

  it("does not flag disjoint redefinitions", () => {
    const branch = [
      { file: "b.sql", contents: 'CREATE OR REPLACE VIEW "a" AS SELECT 1;' }
    ];
    const main = [
      { file: "m.sql", contents: 'CREATE OR REPLACE VIEW "b" AS SELECT 2;' }
    ];
    expect(findClobbers(branch, main)).toHaveLength(0);
  });
});
