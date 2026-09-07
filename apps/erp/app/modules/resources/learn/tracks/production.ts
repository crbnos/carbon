/**
 * Production track.
 *
 * One file per track so a content change reviews on its own; `curriculum.ts`
 * assembles them and owns the lookup helpers.
 */

import { docsRef } from "../docs";
import type { LearnTrack } from "../types";

export const production: LearnTrack = {
  slug: "production",
  title: "Production",
  description: "Jobs, routings, scheduling, and the shop floor reporting back.",
  audience: "Production planners, supervisors",
  status: "live",
  requiredChallengeSlugs: [
    "production-create-job",
    "production-release-job",
    "production-complete-job"
  ],
  exam: {
    questionCount: 30,
    timeLimitMinutes: 45,
    topics: [
      { topic: "jobs", count: 7 },
      { topic: "routings", count: 6 },
      { topic: "scheduling", count: 6 },
      { topic: "shop-floor", count: 6 },
      { topic: "kanban", count: 5 }
    ]
  },
  challenges: [
    {
      slug: "production-create-job",
      trackSlug: "production",
      title: "Raise a job with a method",
      brief:
        "Create a job for a part that is made, and make sure it pulled in a method — operations to run and materials to consume.",
      requirements: [
        { key: "job-exists", label: "A job you created since starting" },
        { key: "job-has-operation", label: "It has at least one operation" },
        { key: "job-has-material", label: "It has at least one material" }
      ],
      capstone: false
    },
    {
      slug: "production-release-job",
      trackSlug: "production",
      title: "Release the job",
      brief:
        "Get one of your jobs onto the floor: release it so an operator can start the first operation.",
      requirements: [
        { key: "job-exists", label: "A job you created since starting" },
        {
          key: "job-released",
          label: "It is Ready or already In Progress — it has left Draft"
        }
      ],
      capstone: false
    },
    {
      slug: "production-complete-job",
      trackSlug: "production",
      title: "Capstone — finish a job",
      brief:
        "A job needs to be finished and the parts booked into stock. Take one all the way through. How you get there is up to you.",
      requirements: [
        { key: "job-exists", label: "A job you created since starting" },
        {
          key: "job-produced",
          label: "It has a completed quantity above zero"
        },
        { key: "job-completed", label: "The job is Completed or Closed" }
      ],
      capstone: true
    }
  ],
  modules: [
    {
      slug: "the-job",
      title: "The job",
      description:
        "What a job is, where its method comes from, and what freezes when it is created.",
      badgeSlug: "production-jobs",
      badgeTitle: "Job writer",
      units: [
        {
          slug: "job-anatomy",
          title: "Anatomy of a job",
          objective:
            "Read a job and say what it will consume, what it will produce, and what its status allows.",
          estimatedMinutes: 16,
          docs: [
            docsRef("/docs/reference/jobs", "Jobs"),
            docsRef("/guides/build", "Building it")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "routings",
          title: "Routings and operations",
          objective:
            "Explain what an operation carries and how setup, labour, and machine time differ.",
          estimatedMinutes: 14,
          docs: [
            docsRef("/docs/reference/routings", "Routings"),
            docsRef("/docs/reference/work-centers", "Work centers")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "create-a-job",
          title: "Raise a job",
          objective:
            "Create a job that pulled in a real method, verified in Carbon.",
          estimatedMinutes: 14,
          docs: [docsRef("/docs/reference/jobs", "Jobs")],
          assessment: {
            kind: "challenge",
            challengeSlug: "production-create-job"
          }
        }
      ]
    },
    {
      slug: "planning-the-work",
      title: "Planning the work",
      description:
        "Getting jobs onto machines: finite scheduling, work centers, and kanban.",
      badgeSlug: "production-scheduling",
      badgeTitle: "Scheduler",
      units: [
        {
          slug: "scheduling",
          title: "Scheduling",
          objective:
            "Predict where the scheduler will place an operation, and say what makes it refuse.",
          estimatedMinutes: 16,
          docs: [
            docsRef("/docs/reference/scheduling", "Scheduling"),
            docsRef("/docs/reference/work-centers", "Work centers")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "kanban",
          title: "Kanban",
          objective:
            "Say what a kanban card replenishes and when it is the right tool instead of a job.",
          estimatedMinutes: 12,
          docs: [docsRef("/docs/reference/kanban", "Kanban")],
          assessment: { kind: "quiz", questionCount: 4 }
        },
        {
          slug: "release-a-job",
          title: "Release a job",
          objective: "Release your job to the floor, verified in Carbon.",
          estimatedMinutes: 10,
          docs: [docsRef("/docs/reference/jobs", "Jobs")],
          assessment: {
            kind: "challenge",
            challengeSlug: "production-release-job"
          }
        }
      ]
    },
    {
      slug: "the-floor",
      title: "The floor",
      description:
        "What operators report, and what finishing a job does to stock and cost.",
      badgeSlug: "production-floor",
      badgeTitle: "Finisher",
      units: [
        {
          slug: "shop-floor",
          title: "Reporting from the floor",
          objective:
            "Say what an operator's start, pause, and complete each record against an operation.",
          estimatedMinutes: 16,
          docs: [
            docsRef("/docs/reference/mes", "MES"),
            docsRef("/guides/floor", "On the floor")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "finishing-a-job",
          title: "Finishing a job",
          objective:
            "Explain what completing and then closing a job each change, and why the order matters.",
          estimatedMinutes: 14,
          docs: [
            docsRef("/guides/job-finish-close", "Finishing and closing a job")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "capstone-complete-a-job",
          title: "Capstone — finish a job",
          objective:
            "Take a job from raised to completed with parts produced. No instructions.",
          estimatedMinutes: 45,
          docs: [
            docsRef("/guides/build", "Building it"),
            docsRef("/guides/job-finish-close", "Finishing and closing a job")
          ],
          assessment: {
            kind: "challenge",
            challengeSlug: "production-complete-job"
          }
        }
      ]
    }
  ]
};
