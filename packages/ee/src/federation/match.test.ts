// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { GITHUB_ACTIONS_ISSUER, GOOGLE_ISSUER } from "./constants";
import {
  firstClaimMismatch,
  issuerUrlError,
  matchSubject,
  ruleRequirementErrors
} from "./match";
import { federationRuleFields, federationRuleValidator } from "./models";

describe("matchSubject", () => {
  it("matches exactly", () => {
    expect(
      matchSubject(
        "repo:acme/plm:ref:refs/heads/main",
        "repo:acme/plm:ref:refs/heads/main"
      )
    ).toBe(true);
    expect(
      matchSubject(
        "repo:acme/plm:ref:refs/heads/main",
        "repo:acme/plm:ref:refs/heads/dev"
      )
    ).toBe(false);
  });

  it("matches a prefix only when the pattern ends in *", () => {
    expect(
      matchSubject("repo:acme/plm:*", "repo:acme/plm:ref:refs/heads/dev")
    ).toBe(true);
    expect(
      matchSubject("repo:acme/plm:*", "repo:acme/plmx:ref:refs/heads/dev")
    ).toBe(false);
    expect(matchSubject("repo:acme/*/x", "repo:acme/a/x")).toBe(false);
  });

  it("never treats a bare * as every subject", () => {
    expect(matchSubject("*", "anything")).toBe(false);
  });

  it("accepts any subject when the rule has none", () => {
    expect(matchSubject(null, "anything")).toBe(true);
  });
});

describe("firstClaimMismatch", () => {
  it("compares numbers and strings as text", () => {
    expect(
      firstClaimMismatch(
        { repository_owner_id: "123" },
        { repository_owner_id: 123 }
      )
    ).toBeNull();
  });

  it("names the first claim that differs or is missing", () => {
    expect(
      firstClaimMismatch(
        { repository_owner_id: "123", environment: "production" },
        { repository_owner_id: "123" }
      )
    ).toBe("environment");
  });

  it("never matches an object claim", () => {
    expect(firstClaimMismatch({ nested: "x" }, { nested: { a: "x" } })).toBe(
      "nested"
    );
  });
});

describe("issuerUrlError", () => {
  it("accepts an https host name", () => {
    expect(
      issuerUrlError("https://token.actions.githubusercontent.com")
    ).toBeNull();
    expect(issuerUrlError("https://sts.windows.net/tenant/")).toBeNull();
  });

  it.each([
    "http://issuer.example.com",
    "https://issuer.example.com:8443",
    "https://10.0.0.1",
    "https://[::1]",
    "https://user:pass@issuer.example.com",
    "https://issuer.example.com?x=1",
    "not a url"
  ])("refuses %s", (issuer) => {
    expect(issuerUrlError(issuer)).not.toBeNull();
  });
});

describe("ruleRequirementErrors", () => {
  const base = {
    issuer: "https://issuer.example.com",
    subject: null,
    claimConditions: {}
  };

  it("refuses a rule that names no workload", () => {
    expect(ruleRequirementErrors(base).subject).toBeDefined();
  });

  it("refuses a bare * subject", () => {
    expect(
      ruleRequirementErrors({ ...base, subject: "*" }).subject
    ).toBeDefined();
  });

  it("refuses a prefix that does not end at a separator", () => {
    expect(
      ruleRequirementErrors({ ...base, subject: "org:acme*" }).subject
    ).toBeDefined();
    expect(
      ruleRequirementErrors({ ...base, subject: "repo:acme/plm:*" })
    ).toEqual({});
  });

  it("accepts a rule with only a claim condition", () => {
    expect(
      ruleRequirementErrors({ ...base, claimConditions: { aud_tenant: "x" } })
    ).toEqual({});
  });

  it("requires repository_owner_id for GitHub Actions", () => {
    const rule = {
      issuer: GITHUB_ACTIONS_ISSUER,
      subject: "repo:acme/plm:ref:refs/heads/main",
      claimConditions: {}
    };
    expect(ruleRequirementErrors(rule).claimConditions).toContain(
      "repository_owner_id"
    );
    expect(
      ruleRequirementErrors({
        ...rule,
        claimConditions: { repository_owner_id: "123" }
      })
    ).toEqual({});
  });

  it("applies the shared-issuer rule with a trailing slash too", () => {
    expect(
      ruleRequirementErrors({
        issuer: `${GITHUB_ACTIONS_ISSUER}/`,
        subject: "repo:acme/plm:*",
        claimConditions: {}
      }).claimConditions
    ).toBeDefined();
  });

  it("requires an exact subject for Google", () => {
    const rule = {
      issuer: GOOGLE_ISSUER,
      subject: "1234*",
      claimConditions: {}
    };
    expect(ruleRequirementErrors(rule).subject).toBeDefined();
    expect(ruleRequirementErrors({ ...rule, subject: "123456789" })).toEqual(
      {}
    );
  });

  it("caps the claim conditions", () => {
    const claimConditions = Object.fromEntries(
      Array.from({ length: 11 }, (_, i) => [`c${i}`, "v"])
    );
    expect(
      ruleRequirementErrors({ ...base, claimConditions }).claimConditions
    ).toBeDefined();
  });
});

describe("federationRuleValidator", () => {
  const form = {
    name: "PLM sync",
    provider: "GitHub Actions",
    issuer: GITHUB_ACTIONS_ISSUER,
    audience: "https://app.carbon.ms",
    subject: "repo:acme/plm:ref:refs/heads/main",
    claimConditions: JSON.stringify([
      { claim: "repository_owner_id", value: "123" }
    ]),
    scopes: "{}",
    tokenLifetimeMinutes: "15"
  };

  it("accepts a complete GitHub rule", () => {
    expect(federationRuleValidator.safeParse(form).success).toBe(true);
  });

  it("reports the missing owner id on the claim conditions field", () => {
    const result = federationRuleValidator.safeParse({
      ...form,
      claimConditions: "[]"
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["claimConditions"]);
  });

  it("refuses a claim condition with an empty value", () => {
    const result = federationRuleValidator.safeParse({
      ...form,
      claimConditions: JSON.stringify([
        { claim: "repository_owner_id", value: "" }
      ])
    });
    expect(result.success).toBe(false);
  });

  it("refuses a claim named in two conditions", () => {
    const result = federationRuleValidator.safeParse({
      ...form,
      claimConditions: JSON.stringify([
        { claim: "repository_owner_id", value: "123" },
        { claim: "repository_owner_id", value: "456" }
      ])
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["claimConditions"]);
  });

  it("turns the condition rows into a claim map when saved", () => {
    const parsed = federationRuleValidator.parse(form);
    expect(federationRuleFields(parsed).claimConditions).toEqual({
      repository_owner_id: "123"
    });
  });

  it("refuses a lifetime outside 5 to 60 minutes", () => {
    expect(
      federationRuleValidator.safeParse({ ...form, tokenLifetimeMinutes: "90" })
        .success
    ).toBe(false);
  });
});
