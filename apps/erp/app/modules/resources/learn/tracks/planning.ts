/**
 * Planning track.
 *
 * One file per track so a content change reviews on its own; `curriculum.ts`
 * assembles them and owns the lookup helpers.
 */

import { docsRef } from "../docs";
import type { LearnTrack } from "../types";

export const planning: LearnTrack = {
  slug: "planning",
  title: "Planning",
  description: "Demand, forecast, reorder policy, and what MRP does with them.",
  audience: "Planners, buyers",
  status: "live",
  requiredChallengeSlugs: [
    "planning-set-reorder-policy",
    "planning-run-mrp-and-review"
  ],
  exam: {
    questionCount: 30,
    timeLimitMinutes: 45,
    topics: [
      { topic: "demand", count: 8 },
      { topic: "forecast", count: 7 },
      { topic: "reordering", count: 8 },
      { topic: "mrp", count: 7 }
    ]
  },
  challenges: [
    {
      slug: "planning-set-reorder-policy",
      trackSlug: "planning",
      title: "Give a part a reorder policy",
      brief:
        "Pick a part that is bought and give it a real reorder policy — not the manual default — with the numbers that policy needs.",
      requirements: [
        {
          key: "policy-set",
          label: "A part whose planning you changed since starting"
        },
        {
          key: "policy-not-manual",
          label: "Its reordering policy is no longer Manual Reorder"
        },
        {
          key: "policy-has-numbers",
          label: "The quantities that policy needs are filled in"
        }
      ],
      capstone: false
    },
    {
      slug: "planning-run-mrp-and-review",
      trackSlug: "planning",
      title: "Capstone — plan a part and act on it",
      brief:
        "A part keeps running short. Set its planning up so Carbon asks for more on its own, then get the resulting suggestion onto a purchase order. How you get there is up to you.",
      requirements: [
        {
          key: "policy-set",
          label: "A part whose planning you changed since starting"
        },
        {
          key: "order-for-item",
          label: "A purchase order raised for that part since you started"
        }
      ],
      capstone: true
    }
  ],
  modules: [
    {
      slug: "demand",
      title: "Demand",
      description: "Where the need comes from, before anybody orders anything.",
      badgeSlug: "planning-demand",
      badgeTitle: "Demand reader",
      units: [
        {
          slug: "how-demand-accumulates",
          title: "How demand accumulates",
          objective:
            "Say which documents create demand for a part and over what window Carbon adds them up.",
          estimatedMinutes: 16,
          docs: [docsRef("/docs/reference/planning", "Planning")],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "forecast",
          title: "Forecast",
          objective:
            "Explain how a forecast interacts with real orders rather than adding to them blindly.",
          estimatedMinutes: 14,
          docs: [docsRef("/docs/reference/forecast", "Forecast")],
          assessment: { kind: "quiz", questionCount: 5 }
        }
      ]
    },
    {
      slug: "policy",
      title: "Reorder policy",
      description:
        "The four policies, what each one needs, and what it produces.",
      badgeSlug: "planning-policy",
      badgeTitle: "Policy setter",
      units: [
        {
          slug: "reordering-policies",
          title: "The four policies",
          objective:
            "Choose between Manual, Demand-Based, Fixed Reorder Quantity, and Maximum Quantity for a given part.",
          estimatedMinutes: 16,
          docs: [docsRef("/docs/reference/reordering", "Reordering")],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "order-modifiers",
          title: "Order modifiers",
          objective:
            "Predict the quantity a suggestion lands on once minimum, maximum, and multiple are applied.",
          estimatedMinutes: 14,
          docs: [
            docsRef("/docs/reference/reordering", "Reordering"),
            docsRef("/guides/plan", "Planning the work")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "set-a-reorder-policy",
          title: "Set a reorder policy",
          objective:
            "Give a real part a working reorder policy, verified in Carbon.",
          estimatedMinutes: 12,
          docs: [docsRef("/docs/reference/reordering", "Reordering")],
          assessment: {
            kind: "challenge",
            challengeSlug: "planning-set-reorder-policy"
          }
        }
      ]
    },
    {
      slug: "running-mrp",
      title: "Running MRP",
      description:
        "What the run produces, and what it deliberately does not do.",
      badgeSlug: "planning-mrp",
      badgeTitle: "Planner",
      units: [
        {
          slug: "what-mrp-does",
          title: "What MRP does",
          objective:
            "Say what an MRP run creates, what it leaves alone, and why it is safe to re-run.",
          estimatedMinutes: 16,
          docs: [
            docsRef("/docs/reference/planning", "Planning"),
            docsRef("/guides/plan", "Planning the work")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "capstone-plan-a-part",
          title: "Capstone — plan a part and act on it",
          objective:
            "Set a part up to replenish itself, then get the suggestion onto an order. No instructions.",
          estimatedMinutes: 40,
          docs: [
            docsRef("/docs/reference/planning", "Planning"),
            docsRef("/docs/reference/reordering", "Reordering")
          ],
          assessment: {
            kind: "challenge",
            challengeSlug: "planning-run-mrp-and-review"
          }
        }
      ]
    }
  ]
};
