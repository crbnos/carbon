/**
 * Administration track.
 *
 * One file per track so a content change reviews on its own; `curriculum.ts`
 * assembles them and owns the lookup helpers.
 */

import { docsRef } from "../docs";
import type { LearnTrack } from "../types";

export const admin: LearnTrack = {
  slug: "admin",
  title: "Administration",
  description:
    "Setting Carbon up: company settings, people, custom fields, sequences, and integrations.",
  audience: "System administrators",
  status: "live",
  requiredChallengeSlugs: [
    "admin-create-employee-type",
    "admin-add-custom-field",
    "admin-invite-and-permission"
  ],
  exam: {
    questionCount: 30,
    timeLimitMinutes: 45,
    topics: [
      { topic: "company", count: 6 },
      { topic: "people", count: 7 },
      { topic: "permissions", count: 7 },
      { topic: "customization", count: 5 },
      { topic: "data", count: 5 }
    ]
  },
  challenges: [
    {
      slug: "admin-create-employee-type",
      trackSlug: "admin",
      title: "Define an employee type",
      brief:
        "Create an employee type for a role this company does not have yet, and grant it at least one module permission.",
      requirements: [
        {
          key: "type-exists",
          label: "An employee type created since you started"
        },
        {
          key: "type-has-permission",
          label: "It grants at least one module permission"
        }
      ],
      capstone: false
    },
    {
      slug: "admin-add-custom-field",
      trackSlug: "admin",
      title: "Add a custom field",
      brief:
        "Carbon does not have a field somebody needs. Add a custom field on any table and leave it active.",
      requirements: [
        {
          key: "field-exists",
          label: "A custom field you created since starting"
        },
        { key: "field-active", label: "It is active" }
      ],
      capstone: false
    },
    {
      slug: "admin-invite-and-permission",
      trackSlug: "admin",
      title: "Capstone — onboard a colleague",
      brief:
        "A new person is starting on Monday and needs the right access on day one. Get them invited with permissions that fit the role. How you get there is up to you.",
      requirements: [
        {
          key: "type-exists",
          label: "An employee type created since you started"
        },
        {
          key: "invite-exists",
          label: "An invitation you sent since starting"
        },
        {
          key: "invite-has-permissions",
          label: "The invitation carries permissions"
        }
      ],
      capstone: true
    }
  ],
  modules: [
    {
      slug: "the-company",
      title: "The company",
      description:
        "Company-wide settings, the numbers documents get, and who is in the building.",
      badgeSlug: "admin-company",
      badgeTitle: "Custodian",
      units: [
        {
          slug: "company-settings",
          title: "Company settings",
          objective:
            "Say which decisions are company-wide and what changing one affects retrospectively.",
          estimatedMinutes: 14,
          docs: [
            docsRef("/docs/reference/company-settings", "Company settings")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "sequences",
          title: "Sequences",
          objective:
            "Explain how a document gets its readable id and what happens when a sequence is edited mid-year.",
          estimatedMinutes: 12,
          docs: [docsRef("/docs/reference/sequences", "Sequences")],
          assessment: { kind: "quiz", questionCount: 4 }
        }
      ]
    },
    {
      slug: "people-and-access",
      title: "People and access",
      description:
        "Employees, employee types, and the permissions that follow from them.",
      badgeSlug: "admin-access",
      badgeTitle: "Gatekeeper",
      units: [
        {
          slug: "people",
          title: "People",
          objective:
            "Say how a user, an employee, and a job title relate, and what deactivating somebody does.",
          estimatedMinutes: 14,
          docs: [docsRef("/docs/reference/people", "People")],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "permissions",
          title: "Permissions",
          objective:
            "Predict whether a person can perform an action, and name the lever that changes it.",
          estimatedMinutes: 16,
          docs: [
            docsRef("/docs/reference/permissions", "Permissions and access"),
            docsRef("/docs/reference/api-keys", "API keys")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "create-an-employee-type",
          title: "Define an employee type",
          objective: "Create a permissioned employee type, verified in Carbon.",
          estimatedMinutes: 12,
          docs: [
            docsRef("/docs/reference/permissions", "Permissions and access")
          ],
          assessment: {
            kind: "challenge",
            challengeSlug: "admin-create-employee-type"
          }
        }
      ]
    },
    {
      slug: "shaping-carbon",
      title: "Shaping Carbon",
      description:
        "Custom fields, documents, and getting data in and out in bulk.",
      badgeSlug: "admin-customization",
      badgeTitle: "Configurator",
      units: [
        {
          slug: "custom-fields",
          title: "Custom fields",
          objective:
            "Say where a custom field appears once created and what it cannot be used for.",
          estimatedMinutes: 12,
          docs: [docsRef("/docs/reference/custom-fields", "Custom fields")],
          assessment: { kind: "quiz", questionCount: 4 }
        },
        {
          slug: "add-a-custom-field",
          title: "Add a custom field",
          objective: "Create a real custom field, verified in Carbon.",
          estimatedMinutes: 10,
          docs: [docsRef("/docs/reference/custom-fields", "Custom fields")],
          assessment: {
            kind: "challenge",
            challengeSlug: "admin-add-custom-field"
          }
        },
        {
          slug: "import-and-documents",
          title: "Bulk data and documents",
          objective:
            "Choose between an import and hand entry, and say where an attached document actually lives.",
          estimatedMinutes: 14,
          docs: [
            docsRef("/docs/reference/import-export", "Import and export"),
            docsRef("/docs/reference/documents", "Documents")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "capstone-invite-and-permission",
          title: "Capstone — onboard a colleague",
          objective:
            "Get a new person invited with the access their role needs. No instructions.",
          estimatedMinutes: 30,
          docs: [
            docsRef("/docs/reference/people", "People"),
            docsRef("/docs/reference/permissions", "Permissions and access")
          ],
          assessment: {
            kind: "challenge",
            challengeSlug: "admin-invite-and-permission"
          }
        }
      ]
    }
  ]
};
