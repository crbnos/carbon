/**
 * Carbon Fundamentals track.
 *
 * One file per track so a content change reviews on its own; `curriculum.ts`
 * assembles them and owns the lookup helpers.
 */

import { docsRef } from "../docs";
import type { LearnTrack } from "../types";

export const fundamentals: LearnTrack = {
  slug: "fundamentals",
  title: "Carbon Fundamentals",
  description:
    "How Carbon is put together: items and methods, the company you work in, and who can do what.",
  audience: "Everyone — start here before a role track",
  status: "live",
  requiredChallengeSlugs: ["fundamentals-create-item"],
  exam: {
    questionCount: 20,
    timeLimitMinutes: 30,
    topics: [
      { topic: "overview", count: 4 },
      { topic: "items", count: 5 },
      { topic: "people", count: 4 },
      { topic: "permissions", count: 4 },
      { topic: "glossary", count: 3 }
    ]
  },
  challenges: [
    {
      slug: "fundamentals-create-item",
      trackSlug: "fundamentals",
      title: "Create your first part",
      brief:
        "Create a Part in this company and give it a name you would recognise on a shelf. We will look for a part you created after you started this challenge.",
      requirements: [
        {
          key: "item-exists",
          label: "An item you created since starting this challenge"
        },
        { key: "item-is-part", label: "Its type is Part" },
        { key: "item-named", label: "It has a name" }
      ],
      capstone: false
    }
  ],
  modules: [
    {
      slug: "orientation",
      title: "Orientation",
      description:
        "What Carbon is, what an item is, and how to find your way around.",
      badgeSlug: "fundamentals-orientation",
      badgeTitle: "Oriented",
      units: [
        {
          slug: "what-carbon-is",
          title: "What Carbon is",
          objective:
            "Explain what the ERP and the MES each cover, and which one a given job belongs in.",
          estimatedMinutes: 8,
          docs: [
            docsRef("/docs", "Overview"),
            docsRef("/guides/order", "Start with the order")
          ],
          assessment: { kind: "quiz", questionCount: 4 }
        },
        {
          slug: "items-and-methods",
          title: "Items and methods",
          objective:
            "Tell an item apart from its method, and predict what changes when a method type changes.",
          estimatedMinutes: 12,
          docs: [
            docsRef("/docs/reference/items", "Items"),
            docsRef("/docs/reference/methods", "Methods & sourcing")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "navigating-carbon",
          title: "Finding your way around",
          objective:
            "Use your account settings, and read Carbon's vocabulary without guessing.",
          estimatedMinutes: 8,
          docs: [
            docsRef("/docs/reference/account", "Your account"),
            docsRef("/docs/glossary", "Glossary")
          ],
          assessment: { kind: "quiz", questionCount: 4 }
        }
      ]
    },
    {
      slug: "your-company",
      title: "Your company",
      description:
        "The company record, the people in it, and what they are allowed to do.",
      badgeSlug: "fundamentals-company",
      badgeTitle: "House rules",
      units: [
        {
          slug: "company-and-people",
          title: "The company and its people",
          objective:
            "Say where a company-wide default lives and how an employee record relates to a user.",
          estimatedMinutes: 12,
          docs: [
            docsRef("/docs/reference/company-settings", "Company settings"),
            docsRef("/docs/reference/people", "People")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "permissions",
          title: "Permissions",
          objective:
            "Predict whether a given person can perform a given action, and say which lever changes it.",
          estimatedMinutes: 10,
          docs: [
            docsRef("/docs/reference/permissions", "Permissions and access")
          ],
          assessment: { kind: "quiz", questionCount: 4 }
        },
        {
          slug: "create-an-item",
          title: "Create a part",
          objective: "Create a real Part in Carbon and have it verified.",
          estimatedMinutes: 10,
          docs: [docsRef("/docs/reference/items", "Items")],
          assessment: {
            kind: "challenge",
            challengeSlug: "fundamentals-create-item"
          }
        }
      ]
    }
  ]
};
