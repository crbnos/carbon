// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { findDroppedFunctionChanges } from "./function-redefinition-keeps-changes";

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

  it("leaves migrations from before it was added alone", () => {
    expect(
      findDroppedFunctionChanges(
        migrations([...ORIGINAL, ...SERIAL], "20261012101010_third.sql")
      )
    ).toEqual([]);
  });
});
