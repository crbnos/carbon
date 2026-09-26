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
    key: "vmc1-chip-coolant",
    name: "VMC chip clean-out & coolant concentration",
    description:
      "Clear the chip auger, skim tramp oil and bring the sump back to 6–8% on the refractometer.",
    workCenter: "VMC Cell 1",
    frequency: "Daily",
    priority: "Medium",
    estimatedDuration: 20,
    nextDueOffset: 1
  },
  {
    key: "edm-filter",
    name: "Wire EDM filter & resin check",
    description:
      "Swap the dielectric filters, read the water conductivity and replace the deionizing resin when it runs over 10 µS/cm.",
    workCenter: "Wire EDM Cell",
    frequency: "Weekly",
    priority: "Medium",
    estimatedDuration: 40,
    nextDueOffset: 2
  },
  {
    key: "turning-sump",
    name: "Lathe coolant sump change",
    description:
      "Pump out and clean the turning cell sump, flush the lines and recharge with fresh semi-synthetic at 7%.",
    workCenter: "Turning Cell",
    frequency: "Monthly",
    priority: "High",
    estimatedDuration: 150,
    nextDueOffset: 19,
    takesWorkCenterOffline: true,
    spareParts: [{ item: "CN-COOLANT-55", quantity: 1 }]
  },
  {
    key: "vmc2-ballbar",
    name: "VMC ballbar test & backlash compensation",
    description:
      "Run the Renishaw ballbar in all three planes and update the backlash comp when circularity drifts past 8 µm.",
    workCenter: "VMC Cell 2",
    frequency: "Quarterly",
    priority: "High",
    estimatedDuration: 180,
    nextDueOffset: 44,
    takesWorkCenterOffline: true
  },
  {
    key: "cmm-cert",
    name: "Annual CMM ISO 10360 re-certification",
    description:
      "Third-party volumetric verification of the CMM with the step gauge and a new calibration certificate.",
    workCenter: "CMM Lab",
    frequency: "Annual",
    priority: "High",
    estimatedDuration: 480,
    nextDueOffset: 140,
    takesWorkCenterOffline: true
  },
  {
    key: "toolroom-grinder",
    name: "Toolroom surface grinder way-lube and wheel dress",
    description:
      "Top off the way-lube reservoir, dress the wheel with the diamond, and check the magnetic chuck for flatness with an indicator sweep.",
    workCenter: "Headquarters Toolroom",
    frequency: "Weekly",
    priority: "Low",
    estimatedDuration: 40,
    nextDueOffset: 3
  }
];

export const MAINTENANCE_DISPATCHES: MaintenanceDispatchSpec[] = [
  {
    key: "edm-wire-break",
    status: "Open",
    priority: "High",
    severity: "Support Required",
    source: "Reactive",
    oeeImpact: "Impact",
    workCenter: "Wire EDM Cell",
    suspectedFailureMode: "Blockage",
    content:
      "Wire breaking every 20 minutes on the die-block job — flush nozzle looks partly plugged. Running at reduced power until it's cleared.",
    created: { offset: -1, time: "10:20:00" },
    plannedStart: { offset: 1, time: "06:30:00" },
    plannedEnd: { offset: 1, time: "08:30:00" }
  },
  {
    key: "vmc2-spindle",
    status: "Assigned",
    priority: "Critical",
    severity: "OEM Required",
    source: "Non-Conformance",
    oeeImpact: "Down",
    workCenter: "VMC Cell 2",
    nonConformance: "ncr:bore",
    suspectedFailureMode: "Bearing Failure",
    content:
      "Bores on the pump housing coming out 12 µm oversize and chattering. Spindle runout measured at 9 µm TIR — machine down; OEM booked for a spindle bearing replacement.",
    created: { offset: -3, time: "14:05:00" },
    plannedStart: { offset: 2, time: "07:00:00" },
    plannedEnd: { offset: 3, time: "15:00:00" },
    takesWorkCenterOffline: true,
    comments: [
      "OEM quoted a rebuilt cartridge — ships overnight.",
      "Pump housing Op-2 moved to VMC Cell 1 until the spindle is back."
    ]
  },
  {
    key: "cmm-probe-requal",
    status: "In Progress",
    priority: "Low",
    severity: "Operator Performed",
    source: "Reactive",
    oeeImpact: "No Impact",
    workCenter: "CMM Lab",
    suspectedFailureMode: "Misalignment",
    content:
      "Star stylus failing qualification on the reference sphere by 3 µm after a crash on the fixture. Re-seating and re-qualifying.",
    created: { offset: -1, time: "12:40:00" },
    plannedStart: { offset: -1, time: "13:00:00" },
    plannedEnd: { offset: -1, time: "14:30:00" },
    actualStart: { offset: -1, time: "13:05:00" }
  },
  {
    key: "turning-sump-change",
    status: "Completed",
    priority: "Medium",
    severity: "Preventive",
    source: "Scheduled",
    oeeImpact: "Planned",
    workCenter: "Turning Cell",
    schedule: "turning-sump",
    actualFailureMode: "Leak",
    content:
      "Monthly sump change. Found the coolant return hose weeping at the clamp — replaced the clamp, flushed and recharged the sump.",
    created: { offset: -9, time: "06:00:00" },
    plannedStart: { offset: -8, time: "12:30:00" },
    plannedEnd: { offset: -8, time: "15:00:00" },
    actualStart: { offset: -8, time: "12:40:00" },
    actualEnd: { offset: -8, time: "15:25:00" },
    takesWorkCenterOffline: true,
    spareParts: [{ item: "CN-COOLANT-55", quantity: 1, shelf: "B3-L1" }],
    comments: ["Concentration after recharge: 7.2% on the refractometer."]
  },
  {
    key: "edm-filter-skip",
    status: "Cancelled",
    priority: "Medium",
    severity: "Preventive",
    source: "Scheduled",
    oeeImpact: "Planned",
    workCenter: "Wire EDM Cell",
    schedule: "edm-filter",
    content:
      "Weekly filter check. Cancelled — filters and resin were replaced by the OEM during the wire-feed service two days earlier.",
    created: { offset: -6, time: "06:00:00" },
    plannedStart: { offset: -5, time: "11:00:00" },
    plannedEnd: { offset: -5, time: "11:40:00" }
  },
  {
    key: "vmc1-chip-today",
    status: "Assigned",
    priority: "Medium",
    severity: "Preventive",
    source: "Scheduled",
    oeeImpact: "Planned",
    workCenter: "VMC Cell 1",
    schedule: "vmc1-chip-coolant",
    content:
      "Daily chip clean-out: clear the auger, skim tramp oil and bring the sump back to 6–8% on the refractometer.",
    created: { offset: -1, time: "06:00:00" },
    plannedStart: { offset: 0, time: "14:00:00" },
    plannedEnd: { offset: 0, time: "14:20:00" }
  },
  {
    key: "edm-dielectric-seal",
    status: "In Progress",
    priority: "High",
    severity: "Support Required",
    source: "Reactive",
    oeeImpact: "Down",
    workCenter: "Wire EDM Cell",
    suspectedFailureMode: "Leak",
    content:
      "Dielectric pump shaft seal weeping into the tank enclosure — machine down while the pump is pulled and the seal kit fitted.",
    created: { offset: -1, time: "15:20:00" },
    plannedStart: { offset: -1, time: "15:30:00" },
    plannedEnd: { offset: 1, time: "12:00:00" },
    actualStart: { offset: -1, time: "15:45:00" },
    takesWorkCenterOffline: true,
    comments: ["Pump is out; O-rings from the cell's spares kit are staged."]
  },
  {
    key: "assembly-arbor-press",
    status: "Completed",
    priority: "Medium",
    severity: "Operator Performed",
    source: "Reactive",
    oeeImpact: "Impact",
    workCenter: "Finish & Assembly Bench",
    suspectedFailureMode: "Lubrication Failure",
    actualFailureMode: "Lubrication Failure",
    content:
      "Arbor press ram sticking on the return stroke while pressing manifold dowels. Ram cleaned and re-oiled; stroke smooth again.",
    created: { offset: -7, time: "14:30:00" },
    plannedStart: { offset: -7, time: "14:40:00" },
    plannedEnd: { offset: -7, time: "15:30:00" },
    actualStart: { offset: -7, time: "14:45:00" },
    actualEnd: { offset: -7, time: "15:15:00" }
  },
  {
    key: "turning-sump-prior",
    status: "Completed",
    priority: "High",
    severity: "Preventive",
    source: "Scheduled",
    oeeImpact: "Planned",
    workCenter: "Turning Cell",
    schedule: "turning-sump",
    content:
      "Monthly sump change on the turning cell: pumped out, lines flushed and recharged at 7%.",
    created: { offset: -45, time: "06:00:00" },
    plannedStart: { offset: -44, time: "11:00:00" },
    plannedEnd: { offset: -44, time: "13:30:00" },
    actualStart: { offset: -44, time: "11:05:00" },
    actualEnd: { offset: -44, time: "13:20:00" },
    takesWorkCenterOffline: true,
    spareParts: [{ item: "CN-COOLANT-55", quantity: 1, shelf: "B3-L1" }]
  },
  {
    key: "vmc1-way-cover",
    status: "Completed",
    priority: "High",
    severity: "Support Required",
    source: "Reactive",
    oeeImpact: "Down",
    workCenter: "VMC Cell 1",
    suspectedFailureMode: "Cracking/Fatigue",
    actualFailureMode: "Cracking/Fatigue",
    content:
      "Y-axis telescoping way cover split at the second section — chips reaching the ways. Cover section replaced and the ways cleaned and inspected.",
    created: { offset: -52, time: "10:00:00" },
    plannedStart: { offset: -52, time: "10:30:00" },
    plannedEnd: { offset: -52, time: "17:00:00" },
    actualStart: { offset: -52, time: "10:40:00" },
    actualEnd: { offset: -51, time: "12:10:00" },
    takesWorkCenterOffline: true
  },
  {
    key: "toolroom-presetter",
    status: "Open",
    priority: "Medium",
    severity: "Operator Performed",
    source: "Reactive",
    oeeImpact: "Impact",
    workCenter: "Headquarters Toolroom",
    suspectedFailureMode: "Misalignment",
    content:
      "Tool presetter camera reads 8 µm long on the reference master — offsets from it can't be trusted until it's re-zeroed.",
    created: { offset: -2, time: "09:30:00" },
    plannedStart: { offset: 1, time: "08:00:00" },
    plannedEnd: { offset: 1, time: "09:30:00" }
  }
];

export const REPLACEMENT_PARTS: ReplacementPartSpec[] = [
  { workCenter: "Wire EDM Cell", item: "SEAL-ORING-224", quantity: 4 },
  { workCenter: "Turning Cell", item: "CN-COOLANT-55", quantity: 1 },
  { workCenter: "VMC Cell 2", item: "SPR-DIE-25", quantity: 2 }
];

export const TRAININGS: TrainingSpec[] = [
  {
    name: "CNC Machine Guarding & Lockout",
    description:
      "OSHA 1910.147 lockout and machine-guarding basics for machinists and setup techs.",
    status: "Active",
    frequency: "Once",
    type: "Mandatory",
    estimatedDuration: "35m",
    content: [
      "Never reach past a door interlock with the spindle turning. Chip clean-out happens with the machine in E-stop, not in feed hold.",
      "Lock out the main disconnect with your own lock before any work inside the enclosure, then try-start to prove zero energy."
    ],
    questions: [
      {
        type: "MultipleChoice",
        question:
          "What state must a VMC be in before you clear chips from the table by hand?",
        options: ["Feed hold", "Single block", "E-stop", "Spindle override 0%"],
        correct: "E-stop"
      },
      {
        type: "TrueFalse",
        question:
          "Gloves are recommended when working near a rotating lathe chuck.",
        answer: false
      },
      {
        type: "MultipleAnswers",
        question:
          "Which of these must be locked out before changing a lathe's coolant pump? Select all that apply.",
        options: [
          "Main electrical disconnect",
          "Hydraulic chuck pressure",
          "Shop air to the bar feeder",
          "The office lights",
          "The CMM"
        ],
        correct: [
          "Main electrical disconnect",
          "Hydraulic chuck pressure",
          "Shop air to the bar feeder"
        ]
      },
      {
        type: "MatchingPairs",
        question: "Match each guard to what it protects against.",
        pairs: [
          { left: "Door interlock", right: "Contact with the moving spindle" },
          { left: "Chip shield", right: "Flying chips and coolant" },
          { left: "Chuck guard", right: "Entanglement on the lathe" }
        ]
      },
      {
        type: "Numerical",
        question:
          "How many seconds must you wait after E-stop for a 12,000 rpm spindle to coast to a full stop before opening the door, per the posted placard?",
        answer: 10,
        tolerance: 2
      }
    ],
    assignment: { completedOffset: -20 }
  },
  {
    name: "First-Article Inspection with the CMM",
    description: "AS9102 first-article flow and CMM report sign-off.",
    status: "Active",
    frequency: "Annual",
    type: "Mandatory",
    estimatedDuration: "50m",
    content: [
      "Every new part number or revision gets a full first article before the lot runs. The CMM report is balloon-for-balloon against the drawing."
    ],
    questions: [
      {
        type: "MultipleChoice",
        question: "When is a new first-article inspection required?",
        options: [
          "Every shift",
          "On a new part number or drawing revision",
          "Only when the customer asks"
        ],
        correct: "On a new part number or drawing revision"
      },
      {
        type: "TrueFalse",
        question:
          "A first article may be signed off with one characteristic still unmeasured if it is non-critical.",
        answer: false
      }
    ],
    assignment: {}
  },
  {
    name: "Wire EDM Setup",
    description:
      "Operator qualification for threading, edge-finding and running the wire EDM.",
    status: "Draft",
    frequency: "Once",
    type: "Optional",
    estimatedDuration: "90m",
    content: [
      "Draft — wire threading, edge-find routine and skim-pass settings for hardened tool steel."
    ],
    questions: [
      {
        type: "Numerical",
        question:
          "What is the maximum dielectric conductivity for a finish skim pass, in µS/cm?",
        answer: 10,
        tolerance: 1
      }
    ]
  }
];

export const TIMECARDS: TimecardSpec[] = [
  { dayOffset: -5, clockIn: "05:58:00", clockOut: "14:32:00" },
  { dayOffset: -4, clockIn: "06:03:00", clockOut: "14:30:00" },
  { dayOffset: -3, clockIn: "06:01:00", clockOut: "14:35:00" },
  {
    dayOffset: -2,
    clockIn: "05:55:00",
    clockOut: "16:48:00",
    note: "Stayed to finish the Cedar Valley first article on the CMM."
  },
  { dayOffset: -1, clockIn: "06:00:00", clockOut: "10:31:00" },
  { dayOffset: -1, clockIn: "11:02:00", clockOut: "14:33:00" }
];

// Clocked in before the first timer on the floor started this morning.
export const OPEN_TIMECARD: OpenTimecardSpec = { clockIn: "05:57:00" };

// None on today itself, so the MES schedule opens on every work center instead of one station.
export const PEOPLE_ASSIGNMENTS: PeopleAssignmentSpec[] = [
  { dayOffset: -2, workCenter: "VMC Cell 1", shift: "First Shift" },
  { dayOffset: -1, workCenter: "Turning Cell", shift: "First Shift" },
  {
    dayOffset: 1,
    workCenter: "VMC Cell 2",
    shift: "First Shift",
    note: "Prove out the new manifold-block fixture."
  },
  { dayOffset: 2, workCenter: "VMC Cell 1", shift: "First Shift" },
  {
    dayOffset: 3,
    workCenter: "CMM Lab",
    shift: "First Shift",
    overtimeHours: 1.5,
    note: "First-article layout for Cedar Valley."
  },
  { dayOffset: 4, workCenter: "Turning Cell", shift: "First Shift" }
];

export const PEOPLE_ABSENCES: PeopleAbsenceSpec[] = [
  {
    dayOffset: 10,
    note: "GD&T refresher at the Rockford technical college."
  }
];

export const SUGGESTIONS: SuggestionSpec[] = [
  {
    suggestion:
      "Track coolant drums used per machine on the maintenance list so we can spot a leaking sump sooner.",
    emoji: "🛢️",
    path: "/x/resources/maintenance",
    tags: ["Maintenance"]
  },
  {
    suggestion:
      "Show each gauge's next calibration date right on the gauge list instead of inside the record.",
    emoji: "📏",
    path: "/x/quality/gauges"
  }
];

export const NOTES: NoteSpec[] = [
  {
    text: "Qualified on the new ballbar routine — can run the quarterly VMC checks without the OEM."
  },
  {
    text: "Covering first-article sign-off on second shift while the quality manager is at the Solstice audit."
  }
];

export const USER_ATTRIBUTE_CATEGORIES: UserAttributeCategorySpec[] = [
  {
    name: "Machinist Credentials",
    emoji: "📐",
    public: true,
    attributes: [
      {
        name: "NIMS Level II credential expires",
        dataType: "Date",
        valueOffset: 210
      },
      {
        name: "Primary machine family",
        dataType: "List",
        listOptions: ["VMC", "HMC", "Lathe", "Swiss", "EDM", "Grinder"],
        value: "VMC",
        canSelfManage: true
      },
      { name: "First-article approver", dataType: "User" },
      { name: "Cleared for CMM programming", dataType: "Yes/No", value: true }
    ]
  }
];

export const CUSTOM_FIELDS: CustomFieldSpec[] = [
  { table: "part", name: "Customer drawing number", dataType: "Text" },
  { table: "customer", name: "Account manager", dataType: "User" },
  { table: "job", name: "First article required", dataType: "Yes/No" }
];

export const SERIAL_SEQUENCES: SerialSequenceSpec[] = [
  // Continues the supplier's numbering already on the shelf (…-0106).
  { item: "CYL-HYD-40", prefix: "CYL40-SN-", size: 4, next: 106 },
  { item: "HMA-4000", prefix: "HMA4000-SN-", size: 4, next: 1 }
];

export const PRINT_JOBS: PrintJobSpec[] = [
  {
    source: { kind: "Receipt", receipt: "receipt:midway-restock" },
    item: "BSH-PTFE-2012",
    status: "completed",
    origin: "auto",
    at: { offset: -2, time: "15:02:00" },
    attempts: 1
  },
  {
    source: { kind: "Job", job: "done-housing" },
    item: "MCH-HSG-PUMP",
    status: "completed",
    origin: "manual",
    at: { offset: -3, time: "20:10:00" },
    attempts: 1
  },
  {
    source: { kind: "StorageUnit", shelf: "B1-L1" },
    status: "completed",
    origin: "manual",
    at: { offset: -7, time: "16:45:00" },
    attempts: 1
  },
  {
    source: { kind: "Job", job: "floor-flange" },
    item: "MCH-FLANGE-SS",
    status: "failed",
    origin: "auto",
    at: { offset: -1, time: "14:15:00" },
    attempts: 3,
    error: "Printer did not respond after 3 attempts (connection timed out)"
  },
  {
    source: { kind: "Job", job: "floor-flange" },
    item: "MCH-FLANGE-SS",
    status: "queued",
    origin: "reprint",
    at: { offset: 0, time: "06:10:00" },
    attempts: 0
  }
];

export const precisionOps: OpsData = {
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
