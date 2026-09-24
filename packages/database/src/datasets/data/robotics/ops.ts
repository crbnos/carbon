import type {
  CustomFieldSpec,
  MaintenanceDispatchSpec,
  MaintenanceScheduleSpec,
  NoteSpec,
  OpenTimecardSpec,
  OpsData,
  PeopleAbsenceSpec,
  PeopleAssignmentSpec,
  PrintJobSpec,
  ReplacementPartSpec,
  SerialSequenceSpec,
  SuggestionSpec,
  TimecardSpec,
  TrainingSpec,
  UserAttributeCategorySpec
} from "../../types.ts";

export const MAINTENANCE_SCHEDULES: MaintenanceScheduleSpec[] = [
  {
    key: "smt-nozzle-clean",
    name: "SMT pick-and-place nozzle & feeder clean",
    description:
      "Ultrasonic-clean the placement nozzles, blow out the feeder tracks and check vacuum at each head.",
    workCenter: "SMT Line",
    frequency: "Daily",
    priority: "Medium",
    estimatedDuration: 25,
    nextDueOffset: 1
  },
  {
    key: "cnc-coolant-check",
    name: "CNC coolant concentration & chip-conveyor check",
    description:
      "Refractometer reading on the sump, top off to 7%, and clear the chip conveyor before the Monday gearbox-housing run.",
    workCenter: "CNC Mill Cell",
    frequency: "Weekly",
    priority: "Medium",
    estimatedDuration: 30,
    nextDueOffset: 3
  },
  {
    key: "gearbox-press-regrease",
    name: "Gearbox bench press re-grease & backlash fixture check",
    description:
      "Re-grease the harmonic-drive press ram, then verify the J1 backlash fixture against the master gearset.",
    workCenter: "Gearbox Bench",
    frequency: "Monthly",
    priority: "High",
    estimatedDuration: 90,
    nextDueOffset: 18,
    takesWorkCenterOffline: true,
    spareParts: [{ item: "CN-GREASE-EP", quantity: 1 }]
  },
  {
    key: "integration-fence",
    name: "Integration cell safety-fence & light-curtain test",
    description:
      "Walk every interlocked gate, break each light-curtain beam and confirm the arm stops within the rated distance.",
    workCenter: "Integration Cell 1",
    frequency: "Quarterly",
    priority: "High",
    estimatedDuration: 120,
    nextDueOffset: 41,
    takesWorkCenterOffline: true
  },
  {
    key: "burn-in-psu",
    name: "Annual burn-in rack power-supply calibration",
    description:
      "Calibrate the programmable supplies and the thermal chamber controller that drive the 48-hour drive burn-in.",
    workCenter: "Burn-In Rack",
    frequency: "Annual",
    priority: "Medium",
    estimatedDuration: 360,
    nextDueOffset: 150,
    takesWorkCenterOffline: true
  },
  {
    key: "demo-cell-scanner",
    name: "Demo cell safety scanner functional test",
    description:
      "Walk-test every protective and warning field of the demo cell's laser scanner and log the stop times against the risk assessment.",
    workCenter: "Customer Demo Cell",
    frequency: "Monthly",
    priority: "High",
    estimatedDuration: 45,
    nextDueOffset: 12
  }
];

// Shapes the maintenance KPIs and boards read: a failure on a production day,
// back-dated completions, today's scheduled task, a machine down now, one at HQ.
export const MAINTENANCE_DISPATCHES: MaintenanceDispatchSpec[] = [
  {
    key: "smt-feeder-jam",
    status: "Open",
    priority: "High",
    severity: "Support Required",
    source: "Reactive",
    oeeImpact: "Impact",
    workCenter: "SMT Line",
    suspectedFailureMode: "Blockage",
    content:
      "Feeder 14 mis-picking 0402 caps — three encoder boards came off the line with missing decoupling caps this morning.",
    created: { offset: -1, time: "09:10:00" },
    plannedStart: { offset: 1, time: "07:30:00" },
    plannedEnd: { offset: 1, time: "09:30:00" }
  },
  {
    key: "integration-servo-fault",
    status: "Assigned",
    priority: "Critical",
    severity: "OEM Required",
    source: "Non-Conformance",
    oeeImpact: "Down",
    workCenter: "Integration Cell 1",
    nonConformance: "ncr:drive-fault",
    suspectedFailureMode: "Electrical Fault",
    content:
      "Cell's reference arm tripping an over-current fault on J3 during the drive test. Cell locked out; servo-amp OEM booked to swap the amplifier.",
    created: { offset: -4, time: "15:45:00" },
    plannedStart: { offset: 2, time: "08:00:00" },
    plannedEnd: { offset: 2, time: "15:00:00" },
    takesWorkCenterOffline: true,
    comments: [
      "Replacement amplifier confirmed in stock at the OEM — arrives Thursday.",
      "Final drive tests are routed to the spare cell until this one is back."
    ]
  },
  {
    key: "inspection-vision-cal",
    status: "In Progress",
    priority: "Low",
    severity: "Operator Performed",
    source: "Reactive",
    oeeImpact: "No Impact",
    workCenter: "Inspection Bench",
    suspectedFailureMode: "Misalignment",
    content:
      "Vision gauge reading the end-effector bolt circle 0.02 mm off the master. Re-calibrating against the dot grid before the next first-article.",
    created: { offset: -1, time: "13:30:00" },
    plannedStart: { offset: -1, time: "13:45:00" },
    plannedEnd: { offset: -1, time: "15:30:00" },
    actualStart: { offset: -1, time: "13:55:00" }
  },
  {
    key: "gearbox-regrease",
    status: "Completed",
    priority: "Medium",
    severity: "Preventive",
    source: "Scheduled",
    oeeImpact: "Planned",
    workCenter: "Gearbox Bench",
    schedule: "gearbox-press-regrease",
    actualFailureMode: "Lubrication Failure",
    content:
      "Monthly press re-grease. The ram guide was running dry and scoring — cleaned, re-greased and the backlash fixture re-verified.",
    created: { offset: -12, time: "06:00:00" },
    plannedStart: { offset: -11, time: "13:00:00" },
    plannedEnd: { offset: -11, time: "14:30:00" },
    actualStart: { offset: -11, time: "13:10:00" },
    actualEnd: { offset: -11, time: "15:05:00" },
    takesWorkCenterOffline: true,
    // Deliberately more than the kit's one pound.
    spareParts: [{ item: "CN-GREASE-EP", quantity: 2, shelf: "A1-L2" }],
    comments: ["Backlash on the master gearset after re-grease: 0.8 arcmin."]
  },
  {
    key: "cnc-coolant-skip",
    status: "Cancelled",
    priority: "Medium",
    severity: "Preventive",
    source: "Scheduled",
    oeeImpact: "Planned",
    workCenter: "CNC Mill Cell",
    schedule: "cnc-coolant-check",
    content:
      "Weekly coolant check. Cancelled — the sump was drained and recharged during the spindle rebuild the same day.",
    created: { offset: -7, time: "06:00:00" },
    plannedStart: { offset: -6, time: "12:00:00" },
    plannedEnd: { offset: -6, time: "12:30:00" }
  },
  {
    key: "smt-nozzle-today",
    status: "Assigned",
    priority: "Medium",
    severity: "Preventive",
    source: "Scheduled",
    oeeImpact: "Planned",
    workCenter: "SMT Line",
    schedule: "smt-nozzle-clean",
    content:
      "Daily nozzle and feeder clean: ultrasonic bath for the nozzles, blow out the feeder tracks, vacuum check at each head.",
    created: { offset: -1, time: "06:00:00" },
    plannedStart: { offset: 0, time: "14:00:00" },
    plannedEnd: { offset: 0, time: "14:25:00" }
  },
  {
    key: "harness-tester-down",
    status: "In Progress",
    priority: "High",
    severity: "Support Required",
    source: "Reactive",
    oeeImpact: "Down",
    workCenter: "Harness Bench",
    suspectedFailureMode: "Electrical Fault",
    content:
      "The cable continuity tester fails its self-test on the 37-pin fixture — every harness reads open on J12. Bench locked out until the fixture relay board is replaced.",
    created: { offset: -1, time: "15:30:00" },
    plannedStart: { offset: -1, time: "15:45:00" },
    plannedEnd: { offset: 1, time: "11:00:00" },
    actualStart: { offset: -1, time: "15:50:00" },
    takesWorkCenterOffline: true,
    comments: ["Relay board ordered from the tester OEM; ships overnight."]
  },
  {
    key: "integration-light-curtain",
    status: "Completed",
    priority: "Medium",
    severity: "Operator Performed",
    source: "Reactive",
    oeeImpact: "Impact",
    workCenter: "Integration Cell 1",
    suspectedFailureMode: "Misalignment",
    actualFailureMode: "Misalignment",
    content:
      "Light curtain on the cell door kept tripping with the door closed. Receiver bracket had been knocked out of line by a pallet; re-aligned and the muting test re-run.",
    created: { offset: -9, time: "14:10:00" },
    plannedStart: { offset: -9, time: "14:15:00" },
    plannedEnd: { offset: -9, time: "15:00:00" },
    actualStart: { offset: -9, time: "14:20:00" },
    actualEnd: { offset: -9, time: "14:55:00" }
  },
  {
    key: "gearbox-regrease-prior",
    status: "Completed",
    priority: "Medium",
    severity: "Preventive",
    source: "Scheduled",
    oeeImpact: "Planned",
    workCenter: "Gearbox Bench",
    schedule: "gearbox-press-regrease",
    content:
      "Monthly re-grease of the gear-press guides and ball screw. Nothing out of the ordinary.",
    created: { offset: -43, time: "06:00:00" },
    plannedStart: { offset: -42, time: "12:00:00" },
    plannedEnd: { offset: -42, time: "15:00:00" },
    actualStart: { offset: -42, time: "12:05:00" },
    actualEnd: { offset: -42, time: "14:40:00" },
    takesWorkCenterOffline: true,
    spareParts: [{ item: "CN-GREASE-EP", quantity: 1, shelf: "A1-L2" }]
  },
  {
    key: "cnc-spindle-chiller",
    status: "Completed",
    priority: "High",
    severity: "Support Required",
    source: "Reactive",
    oeeImpact: "Down",
    workCenter: "CNC Mill Cell",
    suspectedFailureMode: "Overheating",
    actualFailureMode: "Overheating",
    content:
      "Spindle chiller tripped on high refrigerant pressure mid-cycle — condenser coil packed with chips and mist. Coil cleaned, filter replaced, spindle warm-up re-run.",
    created: { offset: -48, time: "08:40:00" },
    plannedStart: { offset: -48, time: "09:00:00" },
    plannedEnd: { offset: -48, time: "15:00:00" },
    actualStart: { offset: -48, time: "09:10:00" },
    actualEnd: { offset: -47, time: "10:30:00" },
    takesWorkCenterOffline: true
  },
  {
    key: "demo-arm-brake",
    status: "Open",
    priority: "Medium",
    severity: "Operator Performed",
    source: "Reactive",
    oeeImpact: "Impact",
    workCenter: "Customer Demo Cell",
    suspectedFailureMode: "Excessive Wear",
    content:
      "The demo arm's J3 brake chatters when it re-engages after an e-stop recovery. Customer visit on Thursday — needs a look before then.",
    created: { offset: -2, time: "11:00:00" },
    plannedStart: { offset: 3, time: "09:00:00" },
    plannedEnd: { offset: 3, time: "11:00:00" }
  }
];

export const REPLACEMENT_PARTS: ReplacementPartSpec[] = [
  { workCenter: "Gearbox Bench", item: "CN-GREASE-EP", quantity: 2 },
  { workCenter: "Gearbox Bench", item: "BRG-CRB-100", quantity: 1 },
  { workCenter: "Integration Cell 1", item: "DRV-SRV-400", quantity: 1 }
];

export const TRAININGS: TrainingSpec[] = [
  {
    name: "Robot Cell Safety & Lockout/Tagout",
    description:
      "ISO 10218 / RIA R15.06 basics for anyone entering a robot cell.",
    status: "Active",
    frequency: "Once",
    type: "Mandatory",
    estimatedDuration: "40m",
    content: [
      "No one enters a cell while the arm is in automatic. Collaborative mode is not a license to stand in the work envelope.",
      "Lock out the cell's disconnect with your own lock and tag before reaching past the fence, and try-start to verify zero energy."
    ],
    questions: [
      {
        type: "MultipleChoice",
        question:
          "Which step comes right after applying your lock and tag to the cell disconnect?",
        options: [
          "Enter the cell",
          "Try-start to verify zero energy",
          "Call the supervisor",
          "Reset the light curtain"
        ],
        correct: "Try-start to verify zero energy"
      },
      {
        type: "TrueFalse",
        question:
          "A teach pendant in reduced-speed mode makes it safe to stand inside the arm's work envelope without an enabling device.",
        answer: false
      },
      {
        type: "MultipleAnswers",
        question:
          "Which of these are hazardous energy sources in a robot cell?",
        options: [
          "Servo power",
          "Compressed air to the gripper",
          "Gravity on a raised axis",
          "The cell's floor paint",
          "Stored charge in the drive capacitors"
        ],
        correct: [
          "Servo power",
          "Compressed air to the gripper",
          "Gravity on a raised axis",
          "Stored charge in the drive capacitors"
        ]
      },
      {
        type: "MatchingPairs",
        question: "Match each safeguard to what it does.",
        pairs: [
          { left: "Light curtain", right: "Stops the arm when a beam breaks" },
          { left: "Enabling device", right: "Allows motion only while held" },
          { left: "Gate interlock", right: "Drops servo power when opened" }
        ]
      },
      {
        type: "Numerical",
        question:
          "What is the maximum reduced-speed teach mode velocity at the tool center point, in mm/s?",
        answer: 250,
        tolerance: 0
      }
    ],
    assignment: { completedOffset: -15 }
  },
  {
    name: "ESD Handling for Drive Electronics",
    description:
      "Wrist straps, dissipative mats and shielded bags on the SMT line.",
    status: "Active",
    frequency: "Annual",
    type: "Mandatory",
    estimatedDuration: "25m",
    content: [
      "Every servo drive and encoder board is ESD-sensitive. Test your strap at the station before touching one."
    ],
    questions: [
      {
        type: "MultipleChoice",
        question: "Where are finished drive boards stored between operations?",
        options: [
          "Static-shielding bags",
          "Open plastic trays",
          "Cardboard boxes"
        ],
        correct: "Static-shielding bags"
      },
      {
        type: "TrueFalse",
        question: "Sleeves rolled up are enough to replace a wrist strap.",
        answer: false
      }
    ],
    assignment: {}
  },
  {
    name: "Harmonic Drive Assembly",
    description:
      "Operator qualification for building and grease-packing strain-wave gearboxes.",
    status: "Draft",
    frequency: "Once",
    type: "Optional",
    estimatedDuration: "75m",
    content: [
      "Draft — flexspline seating, wave-generator grease fill and lost-motion acceptance limits."
    ],
    questions: [
      {
        type: "Numerical",
        question:
          "What is the maximum lost motion accepted on a J1 gearbox, in arcmin?",
        answer: 1,
        tolerance: 0.2
      }
    ]
  }
];

export const TIMECARDS: TimecardSpec[] = [
  { dayOffset: -5, clockIn: "07:02:00", clockOut: "15:34:00" },
  {
    dayOffset: -4,
    clockIn: "06:57:00",
    clockOut: "17:20:00",
    note: "Stayed for the cell integration FAT with Lakeshore."
  },
  { dayOffset: -3, clockIn: "07:05:00", clockOut: "15:31:00" },
  { dayOffset: -2, clockIn: "06:59:00", clockOut: "15:28:00" },
  { dayOffset: -1, clockIn: "07:01:00", clockOut: "11:32:00" },
  { dayOffset: -1, clockIn: "12:02:00", clockOut: "15:36:00" }
];

// Clocked in before the first timer on the floor started this morning.
export const OPEN_TIMECARD: OpenTimecardSpec = { clockIn: "06:33:00" };

// None on today, so the MES schedule opens on every work center, not one station.
export const PEOPLE_ASSIGNMENTS: PeopleAssignmentSpec[] = [
  { dayOffset: -2, workCenter: "CNC Mill Cell", shift: "First Shift" },
  { dayOffset: -1, workCenter: "Gearbox Bench", shift: "First Shift" },
  {
    dayOffset: 1,
    workCenter: "Integration Cell 1",
    shift: "First Shift",
    note: "ROB-2000 arm-to-controller integration for Lakeshore."
  },
  { dayOffset: 2, workCenter: "Gearbox Bench", shift: "First Shift" },
  {
    dayOffset: 3,
    workCenter: "Integration Cell 1",
    shift: "First Shift",
    overtimeHours: 2,
    note: "Stay for the FAT dry run."
  },
  { dayOffset: 4, workCenter: "CNC Mill Cell", shift: "First Shift" }
];

export const PEOPLE_ABSENCES: PeopleAbsenceSpec[] = [
  {
    dayOffset: 8,
    note: "Robot safety (ISO 10218) recertification course."
  }
];

export const SUGGESTIONS: SuggestionSpec[] = [
  {
    suggestion:
      "Let the integration cell's maintenance downtime show on the production schedule so planners stop loading it.",
    emoji: "🤖",
    path: "/x/resources/maintenance",
    tags: ["Maintenance"]
  },
  {
    suggestion:
      "Show each job's serial numbers on the job list so we can find an arm without opening every job.",
    emoji: "💡",
    path: "/x/production/jobs"
  }
];

export const NOTES: NoteSpec[] = [
  {
    text: "Signed off on robot cell LOTO — can lock out Integration Cell 1 for the servo-amp swap."
  },
  {
    text: "Owns the harmonic drive assembly course until it leaves Draft."
  }
];

export const USER_ATTRIBUTE_CATEGORIES: UserAttributeCategorySpec[] = [
  {
    name: "Robot Cell Safety",
    emoji: "🤖",
    public: true,
    attributes: [
      {
        name: "R15.06 safeguarding training expires",
        dataType: "Date",
        valueOffset: 96
      },
      {
        name: "Teach-pendant access level",
        dataType: "List",
        listOptions: ["Operator", "Programmer", "Integrator"],
        value: "Programmer"
      },
      { name: "LOTO authorizer", dataType: "User" },
      {
        name: "Collaborative-mode sign-off",
        dataType: "Yes/No",
        value: true,
        canSelfManage: true
      }
    ]
  }
];

export const CUSTOM_FIELDS: CustomFieldSpec[] = [
  { table: "part", name: "CE declaration reference", dataType: "Text" },
  { table: "customer", name: "Applications engineer", dataType: "User" },
  { table: "job", name: "Customer witness test", dataType: "Yes/No" }
];

export const SERIAL_SEQUENCES: SerialSequenceSpec[] = [
  // Continues the supplier's numbering already on the shelf (…-0054).
  { item: "MOT-AC-750W", prefix: "MOT750-SN-", size: 4, next: 54 },
  { item: "ROB-2000", prefix: "ROB2000-SN-", size: 4, next: 1 }
];

export const PRINT_JOBS: PrintJobSpec[] = [
  {
    source: { kind: "Receipt", receipt: "receipt:bare-boards" },
    item: "PCB-BARE-4L",
    status: "completed",
    origin: "auto",
    at: { offset: -1, time: "15:18:00" },
    attempts: 1
  },
  {
    source: { kind: "Job", job: "done-base" },
    item: "ARM-BASE-001",
    status: "completed",
    origin: "manual",
    at: { offset: -2, time: "19:25:00" },
    attempts: 1
  },
  {
    source: { kind: "StorageUnit", shelf: "A1-L1" },
    status: "completed",
    origin: "manual",
    at: { offset: -6, time: "16:05:00" },
    attempts: 1
  },
  {
    source: { kind: "Job", job: "floor-drive" },
    item: "DRV-J2-MOD",
    status: "failed",
    origin: "auto",
    at: { offset: -1, time: "13:40:00" },
    attempts: 3,
    error: "Printer did not respond after 3 attempts (connection timed out)"
  },
  {
    source: { kind: "Job", job: "floor-drive" },
    item: "DRV-J2-MOD",
    status: "queued",
    origin: "reprint",
    at: { offset: 0, time: "06:54:00" },
    attempts: 0
  }
];

export const roboticsOps: OpsData = {
  userAttributeCategories: USER_ATTRIBUTE_CATEGORIES,
  customFields: CUSTOM_FIELDS,
  serialSequences: SERIAL_SEQUENCES,
  printJobs: PRINT_JOBS,
  maintenanceSchedules: MAINTENANCE_SCHEDULES,
  maintenanceDispatches: MAINTENANCE_DISPATCHES,
  replacementParts: REPLACEMENT_PARTS,
  trainings: TRAININGS,
  timecards: TIMECARDS,
  openTimecard: OPEN_TIMECARD,
  peopleAssignments: PEOPLE_ASSIGNMENTS,
  peopleAbsences: PEOPLE_ABSENCES,
  suggestions: SUGGESTIONS,
  notes: NOTES
};
