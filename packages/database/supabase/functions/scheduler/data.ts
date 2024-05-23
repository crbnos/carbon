export const jobs = [
  {
    id: "10323",
    deadlineDate: "2024-05-20",
    deadlineType: "SOFT_DEADLINE",
    operations: [
      {
        id: "operation0",
        duration: 6 * 60 * 60 * 1000,
        status: "DONE",
        workCenterType: "cnc",
      },
      {
        id: "operation1",
        duration: 2 * 60 * 60 * 1000,
        status: "IN_PROGRESS",
        workCenterType: "assembly",
        timecards: [
          {
            start: "2024-05-20T08:00:00",
            end: "2024-05-20T9:00:00",
            machine: "assembly1",
          },
        ],
      },
      {
        id: "operation2",
        duration: 4 * 60 * 60 * 1000,
        status: "TODO",
        workCenterType: "inspection",
      },
    ],
  },
  {
    id: "10324",
    deadlineDate: "2024-06-20",
    deadlineType: "HARD_DEADLINE",
    operations: [
      {
        id: "operation3",
        duration: 20 * 60 * 1000,
        status: "WAITING",
        workCenterType: "assembly",
      },
      {
        id: "operation4",
        duration: 10 * 60 * 1000,
        status: "TODO",
        workCenterType: "inspection",
      },
    ],
  },
  {
    id: "10325",
    deadlineDate: "2024-07-20",
    deadlineType: "SOFT_DEADLINE",
    operations: [
      {
        id: "operation5",
        duration: 8 * 60 * 60 * 1000,
        status: "PAUSED",
        workCenterType: "cnc",
        timecards: [
          {
            start: "2024-07-20T08:00:00",
            end: "2024-07-20T10:00:00",
            machine: "cnc1",
          },
        ],
      },
      {
        id: "operation6",
        duration: 3 * 60 * 60 * 1000,
        status: "TODO",
        workCenterType: "saw",
      },
      {
        id: "operation7",
        duration: 5 * 60 * 60 * 1000,
        status: "TODO",
        workCenterType: "assembly",
      },
    ],
  },
  {
    id: "10326",
    deadlineDate: "2024-08-20",
    deadlineType: "HARD_DEADLINE",
    operations: [
      {
        id: "operation8",
        duration: 15 * 60 * 1000,
        status: "TODO",
        workCenterType: "saw",
      },
      {
        id: "operation9",
        duration: 12 * 60 * 1000,
        status: "TODO",
        workCenterType: "inspection",
      },
    ],
  },
  {
    id: "10327",
    deadlineDate: "2024-09-20",
    deadlineType: "SOFT_DEADLINE",
    operations: [
      {
        id: "operation10",
        duration: 10 * 60 * 60 * 1000,
        status: "TODO",
        workCenterType: "cnc",
      },
      {
        id: "operation11",
        duration: 4 * 60 * 60 * 1000,
        status: "TODO",
        workCenterType: "assembly",
      },
      {
        id: "operation12",
        duration: 6 * 60 * 60 * 1000,
        status: "TODO",
        workCenterType: "inspection",
      },
    ],
  },
];

export const workCenters = [
  {
    id: "cnc1",
    name: "CNC 1",
    workCenterType: "cnc",
  },
  {
    id: "cnc2",
    name: "CNC 2",
    workCenterType: "cnc",
  },
  {
    id: "saw1",
    name: "Saw 1",
    workCenterType: "saw",
  },
  {
    id: "saw2",
    name: "Saw 2",
    workCenterType: "saw",
  },
  {
    id: "assembly1",
    name: "Assembly 1",
    workCenterType: "assembly",
  },
  {
    id: "assembly2",
    name: "Assembly 2",
    workCenterType: "assembly",
  },
  {
    id: "inspection1",
    name: "Inspection 1",
    workCenterType: "inspection",
  },
];
