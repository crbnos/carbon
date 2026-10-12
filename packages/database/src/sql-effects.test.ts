// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { loadSqlFunctionEffects, sqlFunctionEffects } from "./sql-effects";

// Real SQL through Postgres's own parser — nothing stubbed.
const effectsOf = (...sql: string[]) =>
  sqlFunctionEffects(
    sql.map((text, index) => ({ name: `${index}.sql`, sql: text }))
  );

const plpgsql = (name: string, body: string, args = "") => `
  CREATE OR REPLACE FUNCTION ${name}(${args}) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN
    ${body}
  END $$;`;

describe("what a SQL function does", () => {
  it("sees a write in a plpgsql body, and none in a body that only reads", async () => {
    const effects = await effectsOf(
      plpgsql("bump", `UPDATE sequence SET next = next + 1 WHERE id = 1;`),
      plpgsql("peek", `PERFORM 1 FROM sequence WHERE id = 1;`)
    );
    expect(effects.effectOf("bump")).toEqual({
      kind: "writes",
      reason: "public.bump: UPDATE sequence"
    });
    expect(effects.effectOf("peek")).toEqual({ kind: "reads" });
  });

  it("reads a sql-language body and a data-modifying CTE", async () => {
    const effects = await effectsOf(`
      CREATE FUNCTION log_it(msg text) RETURNS void LANGUAGE sql AS $$
        INSERT INTO log (message) VALUES (msg);
      $$;
      CREATE FUNCTION archive() RETURNS bigint LANGUAGE sql AS $$
        WITH gone AS (DELETE FROM job WHERE closed RETURNING id)
        SELECT count(*) FROM gone;
      $$;`);
    expect(effects.effectOf("log_it").kind).toBe("writes");
    expect(effects.effectOf("archive")).toEqual({
      kind: "writes",
      reason: "public.archive: DELETE job"
    });
  });

  it("is not fooled by a write that is only text", async () => {
    const effects = await effectsOf(
      plpgsql(
        "describe_it",
        `-- UPDATE job SET status = 'x';
         RAISE NOTICE 'run DELETE FROM job to reset';
         PERFORM 'INSERT INTO job'::text;`
      )
    );
    expect(effects.effectOf("describe_it")).toEqual({ kind: "reads" });
  });

  it("follows a call into a function that writes, through an assignment", async () => {
    const effects = await effectsOf(
      `CREATE FUNCTION next_number() RETURNS int LANGUAGE sql AS $$
         UPDATE sequence SET next = next + 1 RETURNING next;
       $$;`,
      `CREATE FUNCTION label() RETURNS text LANGUAGE plpgsql AS $$
       DECLARE n int;
       BEGIN
         n := next_number();
         RETURN 'J' || n;
       END $$;`
    );
    expect(effects.effectOf("label")).toEqual({
      kind: "writes",
      reason: "public.label calls public.next_number: UPDATE sequence"
    });
  });

  it("uses the definition that is current: a later source replaces, a drop removes", async () => {
    const effects = await effectsOf(
      plpgsql("f", `DELETE FROM job;`),
      plpgsql("f", `PERFORM 1;`),
      plpgsql("g", `PERFORM 1;`),
      `DROP FUNCTION g();`
    );
    expect(effects.effectOf("f")).toEqual({ kind: "reads" });
    expect(effects.effectOf("g")).toEqual({
      kind: "unknown",
      reason: "public.g is not defined by any source"
    });
  });

  it("answers for every overload a caller could reach by name", async () => {
    const effects = await effectsOf(
      plpgsql("touch", `PERFORM 1;`, "a text"),
      plpgsql("touch", `DELETE FROM job;`, "a text, b int")
    );
    expect(effects.effectOf("touch").kind).toBe("writes");
  });

  it("treats built-ins that change state as writes", async () => {
    const effects = await effectsOf(
      `CREATE FUNCTION take() RETURNS bigint LANGUAGE sql AS $$ SELECT nextval('s') $$;`,
      `CREATE FUNCTION now_text() RETURNS text LANGUAGE sql AS $$ SELECT now()::text $$;`
    );
    expect(effects.effectOf("take")).toEqual({
      kind: "writes",
      reason: "public.take: nextval()"
    });
    expect(effects.effectOf("now_text")).toEqual({ kind: "reads" });
  });

  it("says it cannot tell, and why, rather than guess", async () => {
    const effects = await effectsOf(
      plpgsql("dynamic", `EXECUTE format('SELECT 1 FROM %I', 'job');`),
      plpgsql("outside", `PERFORM mystery.do_something();`),
      plpgsql("queued", `PERFORM pgmq.send('q', '{}'::jsonb);`),
      `CREATE FUNCTION native() RETURNS int LANGUAGE c AS 'lib', 'sym';`
    );
    expect(effects.effectOf("dynamic")).toMatchObject({
      kind: "unknown",
      reason: expect.stringContaining("dynamic SQL")
    });
    expect(effects.effectOf("outside")).toMatchObject({
      kind: "unknown",
      reason: expect.stringContaining("mystery.do_something()")
    });
    // An extension function that is classified is not a guess.
    expect(effects.effectOf("queued").kind).toBe("writes");
    expect(effects.effectOf("native")).toMatchObject({
      kind: "unknown",
      reason: expect.stringContaining("written in c")
    });
  });

  it("keeps a write certain even when another part could not be read", async () => {
    const effects = await effectsOf(
      plpgsql("mixed", `EXECUTE 'SELECT 1'; DELETE FROM job;`)
    );
    expect(effects.effectOf("mixed").kind).toBe("writes");
  });
});

describe("functions that call each other in a circle", () => {
  it("does not keep an answer worked out while its caller was unfinished", async () => {
    // a calls b, b calls a, and a then writes. Asked about a first, b is seen
    // from inside a — where a still looks like a read.
    const effects = await effectsOf(
      plpgsql("a", `PERFORM b(); UPDATE job SET status = 'x';`),
      plpgsql("b", `PERFORM a();`)
    );
    expect(effects.effectOf("a").kind).toBe("writes");
    expect(effects.effectOf("b").kind).toBe("writes");
  });

  it("still reads a circle that never writes as a read", async () => {
    const effects = await effectsOf(
      plpgsql("ping", `PERFORM pong();`),
      plpgsql("pong", `PERFORM ping();`)
    );
    expect(effects.effectOf("ping")).toEqual({ kind: "reads" });
    expect(effects.effectOf("pong")).toEqual({ kind: "reads" });
  });
});

describe("the repo's own functions", () => {
  it("reads every migration and finds the sequence function's write", async () => {
    const effects = await loadSqlFunctionEffects();
    expect(effects.stats.unparsed).toEqual([]);
    expect(effects.effectOf("get_next_sequence")).toEqual({
      kind: "writes",
      reason: "public.get_next_sequence: UPDATE sequence"
    });
    // Dynamic SQL a person has read, pinned to the definition that was read.
    expect(effects.effectOf("get_unit_of_measure_usage")).toEqual({
      kind: "reads"
    });
    // It parses over a thousand migration files; a CI runner needs more than
    // vitest's five seconds.
  }, 60_000);
});
