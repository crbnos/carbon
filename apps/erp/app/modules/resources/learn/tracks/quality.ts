/**
 * Quality track.
 *
 * One file per track so a content change reviews on its own; `curriculum.ts`
 * assembles them and owns the lookup helpers.
 */

import { docsRef } from "../docs";
import type { LearnTrack } from "../types";

export const quality: LearnTrack = {
  slug: "quality",
  title: "Quality",
  description:
    "Issues, inspections, calibration, and the documents an auditor asks for.",
  audience: "Quality managers, inspectors",
  status: "live",
  requiredChallengeSlugs: [
    "quality-raise-issue",
    "quality-record-inspection",
    "quality-close-an-issue"
  ],
  exam: {
    questionCount: 30,
    timeLimitMinutes: 45,
    topics: [
      { topic: "issues", count: 8 },
      { topic: "inspections", count: 7 },
      { topic: "calibration", count: 5 },
      { topic: "documents", count: 5 },
      { topic: "risk", count: 5 }
    ]
  },
  challenges: [
    {
      slug: "quality-raise-issue",
      trackSlug: "quality",
      title: "Raise a non-conformance",
      brief:
        "Something is wrong with a part. Raise a non-conformance describing it, so there is a record to work from.",
      requirements: [
        {
          key: "issue-exists",
          label: "A non-conformance you raised since starting"
        },
        {
          key: "issue-described",
          label: "It has a name describing the problem"
        }
      ],
      capstone: false
    },
    {
      slug: "quality-record-inspection",
      trackSlug: "quality",
      title: "Record an inspection",
      brief:
        "Inspect something and record the outcome — a real pass or fail, not a half-finished record.",
      requirements: [
        {
          key: "inspection-exists",
          label: "An inspection you created since starting"
        },
        { key: "inspection-resulted", label: "It has a result of Pass or Fail" }
      ],
      capstone: false
    },
    {
      slug: "quality-close-an-issue",
      trackSlug: "quality",
      title: "Capstone — close a non-conformance",
      brief:
        "An open non-conformance needs to be finished properly — investigated, actioned, and closed. Take one all the way. How you get there is up to you.",
      requirements: [
        {
          key: "issue-exists",
          label: "A non-conformance you raised since starting"
        },
        { key: "issue-closed", label: "It has reached Closed" },
        { key: "issue-close-dated", label: "It carries a close date" }
      ],
      capstone: true
    }
  ],
  modules: [
    {
      slug: "when-something-is-wrong",
      title: "When something is wrong",
      description:
        "The non-conformance record, and how it moves from raised to closed.",
      badgeSlug: "quality-issues",
      badgeTitle: "Investigator",
      units: [
        {
          slug: "issues",
          title: "Non-conformances",
          objective:
            "Say what a non-conformance records and what has to happen before it can close.",
          estimatedMinutes: 16,
          docs: [
            docsRef("/docs/reference/issues", "Issues"),
            docsRef("/docs/reference/quality", "Quality")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "raise-an-issue",
          title: "Raise a non-conformance",
          objective: "Raise a real non-conformance, verified in Carbon.",
          estimatedMinutes: 10,
          docs: [docsRef("/docs/reference/issues", "Issues")],
          assessment: {
            kind: "challenge",
            challengeSlug: "quality-raise-issue"
          }
        },
        {
          slug: "risk",
          title: "Risk",
          objective:
            "Explain what the risk register is for and how a risk differs from an issue that has already happened.",
          estimatedMinutes: 12,
          docs: [docsRef("/docs/reference/risks", "Risks")],
          assessment: { kind: "quiz", questionCount: 4 }
        }
      ]
    },
    {
      slug: "checking-the-work",
      title: "Checking the work",
      description:
        "Inspections, sampling, and keeping the gauges you inspect with honest.",
      badgeSlug: "quality-inspection",
      badgeTitle: "Inspector",
      units: [
        {
          slug: "inspections",
          title: "Inspections",
          objective:
            "Say what a sampling plan decides and what a failed inspection does to the parts behind it.",
          estimatedMinutes: 16,
          docs: [
            docsRef("/docs/reference/inspections", "Inspections"),
            docsRef("/guides/ship", "Shipping")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "record-an-inspection",
          title: "Record an inspection",
          objective: "Record a real inspection result, verified in Carbon.",
          estimatedMinutes: 12,
          docs: [docsRef("/docs/reference/inspections", "Inspections")],
          assessment: {
            kind: "challenge",
            challengeSlug: "quality-record-inspection"
          }
        },
        {
          slug: "calibration",
          title: "Calibration",
          objective:
            "Say what an overdue gauge's status does and does not stop, and why that makes it your judgement call.",
          estimatedMinutes: 12,
          docs: [docsRef("/docs/reference/calibration", "Calibration")],
          assessment: { kind: "quiz", questionCount: 4 }
        }
      ]
    },
    {
      slug: "proving-the-system",
      title: "Proving the system",
      description: "The paperwork an auditor asks for, and closing the loop.",
      badgeSlug: "quality-assurance",
      badgeTitle: "Auditor-ready",
      units: [
        {
          slug: "quality-documents",
          title: "Quality documents",
          objective:
            "Say which document proves what, and what a controlled revision changes.",
          estimatedMinutes: 14,
          docs: [
            docsRef("/docs/reference/quality-documents", "Quality documents")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "capstone-close-an-issue",
          title: "Capstone — close a non-conformance",
          objective:
            "Take a non-conformance through to a proper close. No instructions.",
          estimatedMinutes: 35,
          docs: [
            docsRef("/docs/reference/issues", "Issues"),
            docsRef("/docs/reference/quality", "Quality")
          ],
          assessment: {
            kind: "challenge",
            challengeSlug: "quality-close-an-issue"
          }
        }
      ]
    }
  ]
};
