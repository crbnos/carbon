// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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

  it("keys a schema-qualified definition by the OBJECT, not the schema", () => {
    const sql = `
      CREATE OR REPLACE VIEW public."salesOrders" AS SELECT * FROM x;
      CREATE OR REPLACE FUNCTION public.get_total() RETURNS int AS $$ $$;
    `;
    expect(objectRefs(sql)).toEqual(
      new Set(["view:salesOrders", "function:get_total"])
    );
  });

  it("treats a qualified and a bare name as the same object", () => {
    const branch = [
      {
        file: "b.sql",
        contents: "CREATE OR REPLACE FUNCTION public.f() RETURNS int AS $$ $$;"
      }
    ];
    const main = [
      {
        file: "m.sql",
        contents: "CREATE OR REPLACE FUNCTION f() RETURNS int AS $$ $$;"
      }
    ];
    expect(findClobbers(branch, main)).toHaveLength(1);
  });

  it("does not flag two unrelated schema-qualified functions", () => {
    const branch = [
      {
        file: "b.sql",
        contents: "CREATE OR REPLACE FUNCTION public.a() RETURNS int AS $$ $$;"
      }
    ];
    const main = [
      {
        file: "m.sql",
        contents: "CREATE OR REPLACE FUNCTION public.b() RETURNS int AS $$ $$;"
      }
    ];
    expect(findClobbers(branch, main)).toHaveLength(0);
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
