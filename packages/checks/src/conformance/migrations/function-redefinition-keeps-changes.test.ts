// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { SourceFile } from "../../check";
import { functionRedefinitionKeepsChanges } from "./function-redefinition-keeps-changes";

const findDroppedFunctionChanges = (migrations: SourceFile[]) =>
  functionRedefinitionKeepsChanges.find({ migrations });

const fn = (body: string[]) => `
CREATE OR REPLACE FUNCTION public.complete_job(p_job_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
${body.join("\n")}
END;
$$;`;

const ORIGINAL = [
  "  SELECT accountingEnabled INTO v_enabled FROM settings;",
  "  IF NOT v_enabled THEN RETURN; END IF;"
];
const ALWAYS_POST = [
  "  v_posting_status := journal_posting_status(p_company_id);",
  "  INSERT INTO journal (status) VALUES (v_posting_status);"
];
const SERIAL = ["  AND te.status NOT IN ('Rejected', 'Scrapped')"];

const migrations = (third: string[], file = "20261020101010_third.sql") => [
  { file: "20261001101010_first.sql", contents: fn(ORIGINAL) },
  { file: "20261009101010_always-post.sql", contents: fn(ALWAYS_POST) },
  { file, contents: fn(third) }
];

describe("function-redefinition-keeps-changes", () => {
  it("fails a redefinition forked from an older copy", () => {
    const [finding] = findDroppedFunctionChanges(
      migrations([...ORIGINAL, ...SERIAL])
    );
    expect(finding?.snippet).toBe(
      "complete_job drops 20261009101010_always-post.sql"
    );
  });

  it("passes a redefinition that starts from the newest definition", () => {
    expect(
      findDroppedFunctionChanges(migrations([...ALWAYS_POST, ...SERIAL]))
    ).toEqual([]);
  });

  it("tells an overload from the function it shares a name with", () => {
    const overload = (args: string, body: string[]) =>
      fn(body).replace("(p_job_id TEXT)", `(${args})`);
    const SERIAL_OVERLOAD = [
      "  v_serials := array_agg(p_serial ORDER BY p_serial);",
      "  PERFORM receive_serials(p_job_id, v_serials);"
    ];
    expect(
      findDroppedFunctionChanges([
        { file: "20261001101010_first.sql", contents: fn(ORIGINAL) },
        {
          file: "20261009101010_overload.sql",
          contents: overload(
            "p_job_id TEXT, p_serial character varying(20) DEFAULT NULL",
            SERIAL_OVERLOAD
          )
        },
        {
          file: "20261020101010_third.sql",
          contents: overload("text", [...ORIGINAL, ...SERIAL])
        }
      ])
    ).toEqual([]);
    // The overload redefined from an older copy of itself is still caught.
    const [finding] = findDroppedFunctionChanges([
      {
        file: "20261001101010_first.sql",
        contents: overload("t TEXT, n int", ORIGINAL)
      },
      {
        file: "20261009101010_always-post.sql",
        contents: overload("t text, n INTEGER", ALWAYS_POST)
      },
      {
        file: "20261020101010_third.sql",
        contents: overload("IN t TEXT, n int4, OUT ok boolean", [
          ...ORIGINAL,
          ...SERIAL
        ])
      }
    ]);
    expect(finding?.message).toMatch(
      /redefines public\.complete_job\(text, integer\)/
    );
  });

  it("checks a function outside the public schema", () => {
    const util = (body: string[]) =>
      fn(body).replace("public.complete_job", "util.complete_job");
    const [finding] = findDroppedFunctionChanges([
      { file: "20261001101010_first.sql", contents: util(ORIGINAL) },
      { file: "20261009101010_always-post.sql", contents: util(ALWAYS_POST) },
      {
        file: "20261020101010_third.sql",
        contents: util([...ORIGINAL, ...SERIAL])
      }
    ]);
    expect(finding?.snippet).toBe(
      "util.complete_job drops 20261009101010_always-post.sql"
    );
  });

  it("skips a function written without an AS body", () => {
    const findings = findDroppedFunctionChanges([
      ...migrations([...ORIGINAL, ...SERIAL]),
      {
        file: "20261021101010_sql-body.sql",
        contents:
          "CREATE FUNCTION public.one() RETURNS integer LANGUAGE sql RETURN 1;"
      }
    ]);
    expect(findings.map((finding) => finding.snippet)).toEqual([
      "complete_job drops 20261009101010_always-post.sql"
    ]);
  });

  // complete_job_to_inventory as its migrations defined it before 6907343728:
  // 20261014135003 added the production-event lock, and 20261014171619
  // re-created the function from the always-post body, without it.
  const jobCompletion = (file: string, lock: boolean) => ({
    file,
    contents: `
CREATE OR REPLACE FUNCTION public.complete_job_to_inventory(p_job_id TEXT, p_quantity_complete NUMERIC, p_storage_unit_id TEXT, p_user_id TEXT, p_company_id TEXT, p_location_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  FOR v_event IN
    SELECT pe.id, pe.duration, pe.type
    FROM "productionEvent" pe
    INNER JOIN "jobOperation" jo ON jo.id = pe."jobOperationId"
    WHERE jo."jobId" = p_job_id
      AND pe."endTime" IS NOT NULL
      AND pe."postedToGL" = false
      AND pe.duration > 0
${lock ? "    ORDER BY pe.id\n    FOR UPDATE OF pe" : ""}
  LOOP
    v_duration_hours := v_event.duration::NUMERIC / 3600;
  END LOOP;
END;
$$;`
  });

  it("flags 20261014171619, which dropped the production-event lock (fixed by 6907343728)", () => {
    expect(
      findDroppedFunctionChanges([
        jobCompletion("20261009010412_job-costing-always-post.sql", false),
        jobCompletion(
          "20261014135003_lock-production-events-at-job-completion.sql",
          true
        ),
        jobCompletion("20261014171619_receive-consumed-serial-units.sql", false)
      ]).map((v) => v.snippet)
    ).toEqual([
      "complete_job_to_inventory drops 20261014135003_lock-production-events-at-job-completion.sql"
    ]);
  });

  it("passes a redefinition that keeps the production-event lock", () => {
    expect(
      findDroppedFunctionChanges([
        jobCompletion("20261009010412_job-costing-always-post.sql", false),
        jobCompletion(
          "20261014135003_lock-production-events-at-job-completion.sql",
          true
        ),
        jobCompletion("20261014171619_receive-consumed-serial-units.sql", true)
      ])
    ).toEqual([]);
  });

  it("leaves migrations from before it was added alone", () => {
    expect(
      findDroppedFunctionChanges(
        migrations([...ORIGINAL, ...SERIAL], "20261012101010_third.sql")
      )
    ).toEqual([]);
  });
});
