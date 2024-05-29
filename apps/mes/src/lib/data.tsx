import type { Job } from "~/types";

export const jobs = [
  {
    id: "item0",
    workCenterId: "4",
    workCenterTypeId: "grinder",
    readableId: "1503",
    part: "F011432",
    description: "Grind",
    customerId: "ca2f11f8-1464-4753-9690-00107f141f3a",
    dueDate: "2024-05-28",
    duration: 30 * 60 * 1000,
    deadlineType: "HARD_DEADLINE",
    progress: 5 * 60 * 1000,
    status: "IN_PROGRESS",
  },
  {
    id: "item1",
    workCenterId: "3",
    workCenterTypeId: "saw",
    readableId: "1032",
    part: "F011432",
    description: "Cut",
    dueDate: "2024-05-30",
    duration: 2 * 60 * 60 * 1000,
    deadlineType: "SOFT_DEADLINE",
    status: "PAUSED",
    progress: 1.3 * 60 * 60 * 1000,
  },
  {
    id: "item2",
    workCenterId: "3",
    workCenterTypeId: "saw",
    readableId: "1023",
    part: "F011432",
    description: "Cut",
    dueDate: "2024-05-20",
    duration: 2 * 60 * 60 * 1000,
    deadlineType: "ASAP",
    customerId: "ca2f11f8-1464-4753-9690-00107f141f3a",
    status: "READY",
  },
  {
    id: "item3",
    workCenterId: "3",
    workCenterTypeId: "saw",
    readableId: "1022",
    part: "F011432",
    description: "Cut",
    duration: 10 * 60 * 1000,
    deadlineType: "NO_DEADLINE",
    status: "READY",
  },
  {
    id: "item6",
    workCenterId: "assembly1",
    workCenterTypeId: "assembly",
    readableId: "1013",
    part: "F011432",
    description: "Assemble",
    deadlineType: "NO_DEADLINE",
    duration: 2 * 60 * 60 * 1000,
    employeeIds: ["52cdefed-f4b7-45b1-9ec8-701473671fb7"],
    status: "IN_PROGRESS",
    progress: 35 * 60 * 1000,
  },
  {
    id: "item4",
    workCenterId: "assembly1",
    workCenterTypeId: "assembly",
    readableId: "1492",
    part: "F011432",
    description: "Assemble",
    duration: 4 * 60 * 60 * 1000,
    deadlineType: "NO_DEADLINE",
    status: "WAITING",
  },
  {
    id: "item5",
    workCenterId: "assembly2",
    workCenterTypeId: "assembly",
    readableId: "1109",
    part: "F011432",
    description: "Assemble",
    dueDate: "2024-05-20",
    duration: 4 * 60 * 60 * 1000,
    deadlineType: "SOFT_DEADLINE",
    status: "WAITING",
  },

  {
    id: "item7",
    workCenterId: "assembly2",
    workCenterTypeId: "assembly",
    readableId: "1014",
    part: "F011432",
    description: "Assemble",
    dueDate: "2024-06-20",
    duration: 20 * 60 * 1000,
    deadlineType: "HARD_DEADLINE",
    customerId: "bcbe0bca-6516-4a6c-bb8a-b3942f1a9a33",
    status: "TODO",
  },
  {
    id: "item8",
    workCenterId: "assembly2",
    workCenterTypeId: "assembly",
    readableId: "1032",
    part: "F011432",
    description: "Assemble",
    dueDate: "2024-05-24",
    duration: 2 * 60 * 60 * 1000,
    deadlineType: "SOFT_DEADLINE",
    customerId: "ca2f11f8-1464-4753-9690-00107f141f3a",
    status: "TODO",
  },
  {
    id: "item9",
    workCenterId: "assembly2",
    workCenterTypeId: "assembly",
    readableId: "1010",
    part: "F011432",
    description: "Assemble",
    dueDate: "2024-05-20",
    duration: 32 * 1000,
    deadlineType: "ASAP",
    status: "TODO",
  },
  {
    id: "item10",
    workCenterId: "assembly1",
    workCenterTypeId: "assembly",
    readableId: "1403",
    part: "F011432",
    description: "Assemble",
    dueDate: "2024-05-20",
    duration: 6 * 60 * 60 * 1000,
    deadlineType: "NO_DEADLINE",
    customerId: "bcbe0bca-6516-4a6c-bb8a-b3942f1a9a33",
    status: "TODO",
  },
] satisfies Job[];

export const workCells = [
  {
    id: "assembly1",
    type: "assembly",
    title: "Assembly Station 1",
  },
  {
    id: "assembly2",
    type: "assembly",
    title: "Assembly Station 2",
  },
  {
    id: "3",
    type: "saw",
    title: "Band Saw",
  },
  {
    id: "4",
    type: "grinder",
    title: "Bench Grinder",
  },
  {
    id: "5",
    title: "CNC Mill 1",
    type: "cnc",
  },
];

export type WorkCell = (typeof workCells)[number];

export const scrapReasons = [
  {
    id: "1",
    name: "Wrong material picked",
  },
  {
    id: "2",
    name: "Incorrect drawings",
  },
  {
    id: "3",
    name: "Human Error",
  },
  {
    id: "4",
    name: "Issue with equipment",
  },
  {
    id: "5",
    name: "Wrong tooling",
  },
  {
    id: "6",
    name: "Wrong program",
  },
  {
    id: "7",
    name: "Machine malfunction",
  },
  {
    id: "7",
    name: "Other",
  },
];

export type ScrapReason = (typeof scrapReasons)[number];

export const notes = [
  {
    id: "1",
    content: "Hey How are you today?",
    createdAt: "2022-01-01",
    createdBy: "2e7dbae5-712d-4809-a29e-25cff4b90a36",
    createdByName: "Brad Barbin",
  },
  {
    id: "2",
    content:
      "Lorem ipsum dolor sit amet, consectetur adipisicing elit. Vel ipsa commodi illum saepe numquam maxime asperiores voluptate sit, minima perspiciatis.",
    createdAt: "2022-01-02",
    createdBy: "tom",
    createdByName: "Tom Smith",
  },
  {
    id: "3",
    content: "I'm ok what about you?",
    createdAt: "2022-01-03",
    createdBy: "2e7dbae5-712d-4809-a29e-25cff4b90a36",
    createdByName: "Brad Barbin",
  },
  {
    id: "4",
    content: "Lorem ipsum dolor sit, amet consectetur adipisicing. ?",
    createdAt: "2022-01-04",
    createdBy: "tom",
    createdByName: "Tom Smith",
  },
  {
    id: "5",
    content: "Lorem ipsum dolor sit amet !",
    createdAt: "2022-01-05",
    createdBy: "2e7dbae5-712d-4809-a29e-25cff4b90a36",
    createdByName: "Brad Barbin",
  },
  {
    id: "6",
    content: "Lorem ipsum dolor sit, amet consectetur adipisicing. ?",
    createdAt: "2022-01-06",
    createdBy: "tom",
    createdByName: "Tom Smith",
  },
  {
    id: "7",
    content:
      "Lorem ipsum dolor sit amet consectetur adipisicing elit. Perspiciatis, in.",
    createdAt: "2022-01-07",
    createdBy: "2e7dbae5-712d-4809-a29e-25cff4b90a36",
    createdByName: "Brad Barbin",
  },
];

export const workInstructions = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: {
        level: 2,
      },
      content: [
        {
          type: "text",
          text: "Work Instruction",
        },
      ],
    },
    {
      type: "heading",
      attrs: {
        level: 3,
      },
      content: [
        {
          type: "text",
          text: "Setup ",
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          marks: [
            {
              type: "textStyle",
              attrs: {
                color: "rgb(4, 4, 2)",
              },
            },
          ],
          text: "I'm baby letterpress franzen palo santo offal. XOXO lumbersexual farm-to-table mustache neutra selfies chillwave aesthetic green juice blue bottle letterpress fanny pack try-hard gorpcore. Selvage marfa butcher kale chips craft beer fashion axe lumbersexual mlkshk truffaut etsy same salvia activated charcoal kogi woke. Hoodie green juice put a bird on it, echo park swag disrupt ugh air plant vaporware vice hammock.",
        },
      ],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: {
            checked: false,
          },
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",

                  text: "Slow-carb fam same vexillologist bitters.",
                },
              ],
            },
          ],
        },
        {
          type: "taskItem",
          attrs: {
            checked: false,
          },
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",

                  text: "Roof party franzen slow-carb heirloom viral small batch. ",
                },
              ],
            },
          ],
        },
        {
          type: "taskItem",
          attrs: {
            checked: false,
          },
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",

                  text: "Bitters next level listicle, +1 same godard 90's big mood heirloom shabby chic hella.",
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "heading",
      attrs: {
        level: 3,
      },
      content: [
        {
          type: "text",
          text: "Run",
        },
      ],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: {
            checked: false,
          },
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",

                  text: "DIY enamel pin viral ramps banjo DSA chartreuse.",
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "paragraph",
    },
  ],
};
