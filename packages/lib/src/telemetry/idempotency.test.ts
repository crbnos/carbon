import { describe, expect, it } from "vitest";
import { asJobSource, JOB_SOURCES } from "./events";
import { __testing, workEventId } from "./idempotency";

describe("workEventId", () => {
  const occurrence = {
    event: "job_released",
    companyId: "co_1",
    recordId: "job_1"
  };

  it("is stable across calls, which is what makes a retry safe", () => {
    expect(workEventId(occurrence)).toBe(workEventId(occurrence));
  });

  it("is a syntactically valid v5 UUID", () => {
    expect(workEventId(occurrence)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("separates companies, so one tenant cannot collide with another", () => {
    expect(workEventId(occurrence)).not.toBe(
      workEventId({ ...occurrence, companyId: "co_2" })
    );
  });

  it("separates events on the same record", () => {
    expect(workEventId(occurrence)).not.toBe(
      workEventId({ ...occurrence, event: "job_completed" })
    );
  });

  it("separates records", () => {
    expect(workEventId(occurrence)).not.toBe(
      workEventId({ ...occurrence, recordId: "job_2" })
    );
  });

  it("treats an omitted, null and undefined discriminator as the same occurrence", () => {
    const base = workEventId(occurrence);
    expect(workEventId({ ...occurrence, discriminator: null })).toBe(base);
    expect(workEventId({ ...occurrence, discriminator: undefined })).toBe(base);
  });

  it("separates repeat work on one record when a discriminator is given", () => {
    const first = workEventId({ ...occurrence, discriminator: 1 });
    const second = workEventId({ ...occurrence, discriminator: 2 });
    expect(first).not.toBe(second);
  });

  it("does not let a discriminator forge a different record", () => {
    // "job_1" + "2" must not equal "job_12" + "" — the separator prevents it.
    expect(workEventId({ ...occurrence, discriminator: "2" })).not.toBe(
      workEventId({ ...occurrence, recordId: "job_12" })
    );
  });

  it("computes SHA-1 correctly against the standard vectors", () => {
    const hash = (text: string) =>
      __testing.toHex(__testing.sha1(new TextEncoder().encode(text)));
    expect(hash("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    expect(hash("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(
      hash("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")
    ).toBe("84983e441c3bd26ebaae4aa1f95129e5e54670f1");
    // Multi-block: crosses the 64-byte boundary and exercises the length field.
    expect(hash("a".repeat(1000))).toBe(
      "291e9a6c66994949b57ba5e650361e98fc36b1ba"
    );
  });

  it("matches the RFC 4122 §A worked example, so the hash is a real v5", () => {
    // The canonical DNS namespace and name from the RFC's own test vector.
    expect(
      __testing.uuidv5(
        "www.example.org",
        "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
      )
    ).toBe("74738ff5-5367-5958-9aee-98fffdcd1876");
  });
});

describe("asJobSource", () => {
  it("passes a real source through", () => {
    expect(asJobSource("kanban")).toBe("kanban");
  });

  // insertJob is an MCP tool and the generated schema types this field as {},
  // so an agent can send anything. Without narrowing it lands in the analytics
  // enum permanently.
  it("narrows anything else to unknown", () => {
    for (const bad of ["banana", "", null, undefined, 7, {}, ["erp"]]) {
      expect(asJobSource(bad)).toBe("unknown");
    }
  });

  it("keeps the runtime list and the type in step", () => {
    // A source added to the union but not the array would silently narrow to
    // "unknown" at runtime; deriving the type from the array makes that
    // impossible, and this pins the array itself.
    expect([...JOB_SOURCES]).toEqual([
      "erp",
      "bulk",
      "mrp",
      "salesOrder",
      "kanban",
      "api",
      "workflow",
      "unknown"
    ]);
  });
});
