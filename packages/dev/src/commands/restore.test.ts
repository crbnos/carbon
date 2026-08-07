import { describe, expect, it } from "vitest";
import { buildRestoreEnv } from "./restore.js";

// The restore itself is ~200 lines of SQL in scripts/restore-database.sh and is
// not unit-testable. What IS testable — and what a mistake here would actually
// cost — is the flag→env mapping: getting the scrub wrong silently loads real
// production email addresses into a local database.
describe("buildRestoreEnv", () => {
  it("scrubs emails by default, inverting the script's opt-in default", () => {
    expect(buildRestoreEnv({}).SCRUB_EMAILS).toBe("1");
  });

  it("OMITS the key when opted out — the script treats any non-empty value as true", () => {
    const env = buildRestoreEnv({ scrubEmails: false });
    // "0" would enable scrubbing, not disable it.
    expect(env).not.toHaveProperty("SCRUB_EMAILS");
  });

  it("defaults to local mode so the restore cannot talk to production services", () => {
    expect(buildRestoreEnv({}).RESTORE_MODE).toBe("local");
    expect(buildRestoreEnv({ mode: "prod" }).RESTORE_MODE).toBe("prod");
  });

  it("passes admin credentials through only when supplied", () => {
    expect(buildRestoreEnv({})).not.toHaveProperty("ADMIN_EMAIL");
    expect(buildRestoreEnv({})).not.toHaveProperty("ADMIN_PASSWORD");

    const env = buildRestoreEnv({
      adminEmail: "me@prod.com",
      adminPassword: "s3cret"
    });
    expect(env.ADMIN_EMAIL).toBe("me@prod.com");
    expect(env.ADMIN_PASSWORD).toBe("s3cret");
  });

  it("does not leak an empty ADMIN_EMAIL that would make the script look up ''", () => {
    expect(buildRestoreEnv({ adminEmail: "" })).not.toHaveProperty(
      "ADMIN_EMAIL"
    );
  });

  it("clears storage metadata unless explicitly asked to keep it", () => {
    // Default matters: kept rows point at files that only exist in the source
    // environment's backend, so every download 404s.
    expect(buildRestoreEnv({})).not.toHaveProperty("KEEP_STORAGE_OBJECTS");
    expect(buildRestoreEnv({ keepStorageObjects: false })).not.toHaveProperty(
      "KEEP_STORAGE_OBJECTS"
    );
    expect(
      buildRestoreEnv({ keepStorageObjects: true }).KEEP_STORAGE_OBJECTS
    ).toBe("1");
  });
});
