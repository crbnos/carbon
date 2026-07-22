import type { IntakeAnswers } from "../content/intake";
import type { IntakeRowPayload } from "../models";
import { intakeRowValidator } from "../models";
import type { ImplementationRowData } from "../types";

// Intake state lives as versioned snapshot rows in implementationRow
// (collection "intake"): one row per version, latest completed row = current
// truth, an optional draft row = the wizard's resumable in-progress state.
// History comes free (rows are snapshots) and a re-tune diff is a pure
// comparison of two versions' answers. These helpers shape those rows; they
// tolerate malformed payloads by skipping them (never throwing on read).

export const INTAKE_COLLECTION = "intake";
export const INTAKE_TRANSCRIPT_COLLECTION = "intakeTranscript";

export interface IntakeVersionRow {
  rowId: string;
  payload: IntakeRowPayload;
}

export interface IntakeState {
  versions: IntakeVersionRow[]; // completed, ascending by version
  current: IntakeVersionRow | null; // latest completed
  previous: IntakeVersionRow | null; // the completed version before current
  draft: IntakeVersionRow | null; // in-progress wizard state, if any
  nextVersion: number;
}

export function parseIntakeRows(rows: ImplementationRowData[]): IntakeState {
  const parsed: IntakeVersionRow[] = [];
  let draft: IntakeVersionRow | null = null;

  for (const row of rows) {
    if (row.collection !== INTAKE_COLLECTION) continue;
    const result = intakeRowValidator.safeParse(row.payload);
    if (!result.success) continue;
    const version: IntakeVersionRow = { rowId: row.id, payload: result.data };
    if (result.data.status === "draft") {
      // At most one draft is expected; a stray extra draft loses to the newer
      // version number rather than corrupting anything.
      if (!draft || result.data.version > draft.payload.version) draft = version;
    } else {
      parsed.push(version);
    }
  }

  parsed.sort((a, b) => a.payload.version - b.payload.version);
  const current = parsed[parsed.length - 1] ?? null;
  const previous = parsed[parsed.length - 2] ?? null;
  const maxVersion = Math.max(
    0,
    ...parsed.map((v) => v.payload.version),
    draft ? draft.payload.version : 0
  );

  return {
    versions: parsed,
    current,
    previous,
    draft,
    nextVersion: maxVersion + 1
  };
}

// The answers the plan tailors from: the latest completed version's, or empty
// before the intake has ever been completed (the untailored plan shows all).
export function currentAnswers(state: IntakeState): IntakeAnswers {
  return state.current?.payload.answers ?? {};
}
