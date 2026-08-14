import { describe, expect, it } from "vitest";
import { requiresItarEntityCertification } from "./const";

describe("requiresItarEntityCertification", () => {
  it("exempts Carbon staff, who provision customer tenants but cannot bind them", () => {
    expect(requiresItarEntityCertification("chase@carbon.ms")).toBe(false);
    expect(requiresItarEntityCertification("someone@carbon.us.org")).toBe(
      false
    );
  });

  it("normalizes case and padding, so the gate cannot be dodged by formatting", () => {
    expect(requiresItarEntityCertification("Chase@Carbon.MS")).toBe(false);
    expect(requiresItarEntityCertification("  chase@carbon.ms  ")).toBe(false);
  });

  it("requires the entity Rider from customer accounts", () => {
    expect(requiresItarEntityCertification("admin@customer.com")).toBe(true);
    expect(requiresItarEntityCertification("ops@defense-primes.mil")).toBe(
      true
    );
  });

  it("does not hand the exemption to addresses that merely contain a Carbon domain", () => {
    // The bypass decides who may sign on a customer's behalf, so near-misses
    // must all fall through to "required".
    expect(requiresItarEntityCertification("attacker@carbon.ms.evil.com")).toBe(
      true
    );
    expect(requiresItarEntityCertification("carbon.ms@customer.com")).toBe(
      true
    );
    expect(requiresItarEntityCertification("attacker@notcarbon.ms")).toBe(true);
    expect(requiresItarEntityCertification("attacker@sub.carbon.ms")).toBe(
      true
    );
    expect(requiresItarEntityCertification("attacker+carbon.ms@evil.com")).toBe(
      true
    );
  });

  it("fails closed when the email is unknown", () => {
    expect(requiresItarEntityCertification(null)).toBe(true);
    expect(requiresItarEntityCertification(undefined)).toBe(true);
    expect(requiresItarEntityCertification("")).toBe(true);
  });
});
