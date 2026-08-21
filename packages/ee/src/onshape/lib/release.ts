// Reading a release package. Pure functions over the shape
// `OnshapeClient.getReleasePackage` returns, so they unit-test without a network.
//
// Why this file exists at all: the release NAME and NOTES are engineering-
// meaningful text a human wrote at approval time, and they reach Carbon through
// no other route. The webhook envelope carries `releaseId` and `releaseName`
// and nothing else; `OnshapeRevision` carries the same two; no exported asset
// contains either — Onshape has no release report and no PDF of a package.
//
// Property ids verified live 2026-08-21 against release package
// eff3a8e5ba701fc7bffb3191 ("TB-REL-001 Test Bench Erstfreigabe").

import type {
  OnshapeReleasePackage,
  OnshapeReleasePackageProperty
} from "./client";

/** "Release name" — plain string, Onshape validates 2..128 chars. */
const RELEASE_NAME_PROPERTY_ID = "594964b7040fc85d2b418138";

/** "Release notes" — plain string, Onshape validates 0..10000 chars. */
const RELEASE_NOTES_PROPERTY_ID = "594964df040fc85d2b418144";

/** "Approvers" — the property carrying `isApproverProperty: true`. */
const RELEASE_APPROVERS_PROPERTY_ID = "59403fa4040fc83120937a90";

// "Comment" (594964df040fc85d2b418145) and the `comments`/`parentComments`
// arrays are deliberately NOT read. A comment is a discussion artifact, not the
// engineering intent of the release, and folding it into the notes would put
// side conversation into a change notice's reason for change.

/**
 * Onshape's own cap on the notes field. Clamped defensively rather than
 * trusted: this text lands in a tiptap document and in a change notice a human
 * reads, and a pathological value should not be the thing that discovers the
 * limit.
 */
const NOTES_MAX_LENGTH = 10_000;

function findByPropertyId(
  pkg: OnshapeReleasePackage,
  propertyId: string
): OnshapeReleasePackageProperty | undefined {
  const properties = Array.isArray(pkg?.properties) ? pkg.properties : [];
  return properties.find((property) => property?.propertyId === propertyId);
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Resolve one of the release package's text fields.
 *
 * Order is propertyId first, then the top-level convenience key. Display names
 * are NEVER matched — unlike `readPartNumber` in the v2 elements route, which
 * falls back to the English "Part number" label, these two properties are
 * always present on a release package, so a name fallback would only ever add
 * the risk of matching a company's own similarly-labelled custom property in
 * whatever locale the account runs in.
 */
function readPackageText(
  pkg: OnshapeReleasePackage | null | undefined,
  propertyId: string,
  topLevelKey: "name" | "description"
): string | null {
  if (!pkg || typeof pkg !== "object") return null;
  const fromProperty = asTrimmedString(
    findByPropertyId(pkg, propertyId)?.value
  );
  if (fromProperty) return fromProperty;
  return asTrimmedString(pkg[topLevelKey]);
}

/** The release's name, e.g. "TB-REL-001 Test Bench Erstfreigabe". */
export function readReleasePackageName(
  pkg: OnshapeReleasePackage | null | undefined
): string | null {
  return readPackageText(pkg, RELEASE_NAME_PROPERTY_ID, "name");
}

/** The release's free-text notes, or null when the releaser wrote none. */
export function readReleasePackageNotes(
  pkg: OnshapeReleasePackage | null | undefined
): string | null {
  const notes = readPackageText(pkg, RELEASE_NOTES_PROPERTY_ID, "description");
  return notes ? notes.slice(0, NOTES_MAX_LENGTH) : null;
}

/**
 * The workflow state, e.g. "RELEASED". Read from the three places Onshape
 * reports it, in decreasing authority.
 */
export function readReleasePackageState(
  pkg: OnshapeReleasePackage | null | undefined
): string | null {
  if (!pkg || typeof pkg !== "object") return null;
  return (
    asTrimmedString(pkg.workflow?.state?.name) ??
    asTrimmedString(pkg.metadataState) ??
    asTrimmedString(pkg.workflow?.currentStateDisplayName)
  );
}

/**
 * Whoever approved the release, as Onshape reports them.
 *
 * Returns [] rather than throwing when the property is absent or empty, which
 * is the COMMON case: a release workflow with no approvers configured produces
 * an empty list, exactly as the probed test package did. Any output built on
 * this must degrade to saying nothing rather than asserting the release was
 * unapproved — Onshape was simply never told who approves.
 */
export function readReleasePackageApprovers(
  pkg: OnshapeReleasePackage | null | undefined
): string[] {
  if (!pkg || typeof pkg !== "object") return [];
  const value = findByPropertyId(pkg, RELEASE_APPROVERS_PROPERTY_ID)?.value;
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        return (
          asTrimmedString(record.name) ??
          asTrimmedString(record.email) ??
          asTrimmedString(record.id) ??
          ""
        );
      }
      return "";
    })
    .filter((entry): entry is string => Boolean(entry));
}
