// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  CustomFieldSpec,
  MaintenanceDispatchSpec,
  MaintenanceScheduleSpec,
  NoteSpec,
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
    key: "cleanroom-particles",
    name: "Integration bay ESD audit & wipe-down",
    description:
      "Check the ground points and ionizers at the four integration benches with the surface resistance meter; wipe benches with IPA.",
    workCenter: "Integration Bay A",
    frequency: "Daily",
    priority: "Medium",
    estimatedDuration: 30,
    // Today's count is already dispatched.
    nextDueOffset: 1
  },
  {
    key: "cnc-way-lube",
    name: "CNC spindle warm-up & way-lube check",
    description:
      "Run the 20-minute spindle warm-up program, top off way lube and log the air pressure.",
    workCenter: "CNC Mill",
    frequency: "Weekly",
    priority: "Medium",
    estimatedDuration: 45,
    nextDueOffset: 2
  },
  {
    key: "tvac-cryopump",
    name: "Environmental chamber refrigeration service & door seal inspection",
    description:
      "Check refrigerant pressures, inspect and clean the door seal, then run the -40 °C pull-down check.",
    workCenter: "Environmental Chamber 1",
    frequency: "Monthly",
    priority: "High",
    estimatedDuration: 240,
    nextDueOffset: 21,
    takesWorkCenterOffline: true,
    spareParts: [{ item: "CN-THREADLOCK", quantity: 1 }]
  },
  {
    key: "pcb-reflow-profile",
    name: "Reflow oven thermal profile verification",
    description:
      "Run the profiling board through the reflow oven and compare each zone against the IPC J-STD-001 Class 3 profile.",
    workCenter: "Avionics Lab",
    frequency: "Quarterly",
    priority: "Medium",
    estimatedDuration: 120,
    nextDueOffset: 38
  },
  {
    key: "tig-calibration",
    name: "Annual bonding oven calibration",
    description:
      "Third-party temperature uniformity survey of the cure oven per AMS2750.",
    workCenter: "Bonding & Cure Cell",
    frequency: "Annual",
    priority: "High",
    estimatedDuration: 480,
    nextDueOffset: 145,
    takesWorkCenterOffline: true
  },
  {
    key: "flatsat-psu-cal",
    name: "Hover cage power supply calibration check",
    description:
      "Verify the hover cage's 50 V tether supply and electronic load against the lab DMM; log drift and re-trim if over 0.5%.",
    workCenter: "Hover Test Cage",
    frequency: "Quarterly",
    priority: "Medium",
    estimatedDuration: 90,
    nextDueOffset: 27
  }
];

// Shapes the maintenance KPIs and boards read: a failure on a production day,
// back-dated completions, today's scheduled task, a machine down now, one at HQ.
export const MAINTENANCE_DISPATCHES: MaintenanceDispatchSpec[] = [
  {
    key: "potting-needle",
    status: "Open",
    priority: "High",
    severity: "Support Required",
    source: "Reactive",
    oeeImpact: "Impact",
    workCenter: "Potting Station",
    suspectedFailureMode: "Blockage",
    content:
      "Potting meter-mix dispense needle clogging mid-shot — two PDB boards came out with potting voids this morning.",
    created: { offset: -1, time: "08:40:00" },
    plannedStart: { offset: 1, time: "09:00:00" },
    plannedEnd: { offset: 1, time: "11:00:00" }
  },
  {
    key: "tvac-thermocouple",
    status: "Assigned",
    priority: "Critical",
    severity: "OEM Required",
    source: "Non-Conformance",
    oeeImpact: "Down",
    workCenter: "Environmental Chamber 1",
    nonConformance: "ncr:txrx-tvac",
    suspectedFailureMode: "Electrical Fault",
    content:
      "Chamber thermocouple TC-07 read 6 °C high during the radio temperature cycle. Chamber locked out; OEM field service booked to replace the feedthrough.",
    created: { offset: -4, time: "16:20:00" },
    plannedStart: { offset: 3, time: "08:00:00" },
    plannedEnd: { offset: 3, time: "16:00:00" },
    takesWorkCenterOffline: true,
    comments: [
      "Feedthrough part number confirmed with the OEM — ships Tuesday.",
      "Rerun of the radio cycle is on hold until the chamber is re-qualified."
    ]
  },
  {
    key: "qc-cmm-probe",
    status: "In Progress",
    priority: "Low",
    severity: "Operator Performed",
    source: "Reactive",
    oeeImpact: "No Impact",
    workCenter: "QC Bench",
    suspectedFailureMode: "Misalignment",
    content:
      "CMM probe qualification failing on the reference sphere by 4 µm. Re-seating the stylus and re-qualifying before the next first-article.",
    created: { offset: -1, time: "13:50:00" },
    plannedStart: { offset: -1, time: "14:00:00" },
    plannedEnd: { offset: -1, time: "16:00:00" },
    actualStart: { offset: -1, time: "14:10:00" }
  },
  {
    key: "tvac-oring",
    status: "Completed",
    priority: "Medium",
    severity: "Preventive",
    source: "Scheduled",
    oeeImpact: "Planned",
    workCenter: "Environmental Chamber 1",
    schedule: "tvac-cryopump",
    actualFailureMode: "Leak",
    content:
      "Monthly refrigeration service. Door seal was leaking at the hinge side on the pull-down check — cleaned and re-seated.",
    created: { offset: -10, time: "06:00:00" },
    plannedStart: { offset: -9, time: "12:00:00" },
    plannedEnd: { offset: -9, time: "16:00:00" },
    actualStart: { offset: -9, time: "12:15:00" },
    actualEnd: { offset: -9, time: "17:05:00" },
    takesWorkCenterOffline: true,
    // Two pounds instead of the kit's one, which is why the next arm set kit is short of threadlocker.
    spareParts: [{ item: "CN-THREADLOCK", quantity: 2, shelf: "A1-L3" }],
    comments: ["Pull-down to -40 °C in 38 min after re-seat — within spec."]
  },
  {
    key: "cnc-lube-skip",
    status: "Cancelled",
    priority: "Medium",
    severity: "Preventive",
    source: "Scheduled",
    oeeImpact: "Planned",
    workCenter: "CNC Mill",
    schedule: "cnc-way-lube",
    content:
      "Weekly way-lube check. Cancelled — the lube was topped off during the fixture swap the same day.",
    created: { offset: -6, time: "06:00:00" },
    plannedStart: { offset: -5, time: "12:00:00" },
    plannedEnd: { offset: -5, time: "12:45:00" }
  },
  {
    key: "cleanroom-particles-today",
    status: "Assigned",
    priority: "Medium",
    severity: "Preventive",
    source: "Scheduled",
    oeeImpact: "Planned",
    workCenter: "Integration Bay A",
    schedule: "cleanroom-particles",
    content:
      "Daily ESD audit at the four integration benches, then IPA wipe-down of the benches.",
    created: { offset: -1, time: "06:00:00" },
    plannedStart: { offset: 0, time: "14:00:00" },
    plannedEnd: { offset: 0, time: "14:30:00" }
  },
  {
    key: "tig-gas-solenoid",
    status: "In Progress",
    priority: "High",
    severity: "Support Required",
    source: "Reactive",
    oeeImpact: "Down",
    workCenter: "Bonding & Cure Cell",
    suspectedFailureMode: "Electrical Fault",
    content:
      "Cure oven door interlock is sticking open — over-temperature alarm on every cycle start. Cell locked out while the interlock is swapped and the oven re-verified.",
    created: { offset: -1, time: "15:40:00" },
    plannedStart: { offset: -1, time: "16:00:00" },
    plannedEnd: { offset: 1, time: "12:00:00" },
    actualStart: { offset: -1, time: "16:05:00" },
    takesWorkCenterOffline: true,
    comments: ["Replacement interlock pulled from the cell's spares kit."]
  },
  {
    key: "cleanroom-ionizer",
    status: "Completed",
    priority: "Medium",
    severity: "Operator Performed",
    source: "Reactive",
    oeeImpact: "Impact",
    workCenter: "Integration Bay A",
    suspectedFailureMode: "Electrical Fault",
    actualFailureMode: "Electrical Fault",
    content:
      "Ionizer bar over the integration bench threw a balance alarm mid-shift. Emitter pins cleaned and the bar re-balanced to ±15 V.",
    created: { offset: -9, time: "14:20:00" },
    plannedStart: { offset: -9, time: "14:30:00" },
    plannedEnd: { offset: -9, time: "15:30:00" },
    actualStart: { offset: -9, time: "14:35:00" },
    actualEnd: { offset: -9, time: "15:20:00" }
  },
  {
    key: "tvac-cryopump-prior",
    status: "Completed",
    priority: "Medium",
    severity: "Preventive",
    source: "Scheduled",
    oeeImpact: "Planned",
    workCenter: "Environmental Chamber 1",
    schedule: "tvac-cryopump",
    content:
      "Monthly refrigeration service and door seal clean. Pull-down check passed first time.",
    created: { offset: -41, time: "06:00:00" },
    plannedStart: { offset: -40, time: "12:00:00" },
    plannedEnd: { offset: -40, time: "16:00:00" },
    actualStart: { offset: -40, time: "12:10:00" },
    actualEnd: { offset: -40, time: "15:50:00" },
    takesWorkCenterOffline: true,
    spareParts: [{ item: "CN-THREADLOCK", quantity: 1, shelf: "A1-L3" }]
  },
  {
    key: "cnc-drawbar",
    status: "Completed",
    priority: "High",
    severity: "Support Required",
    source: "Reactive",
    oeeImpact: "Down",
    workCenter: "CNC Mill",
    suspectedFailureMode: "Excessive Wear",
    actualFailureMode: "Excessive Wear",
    content:
      "Spindle drawbar lost clamp force — tool pulled out during a roughing pass on a hinge block. Belleville stack replaced and clamp force re-measured.",
    created: { offset: -50, time: "09:15:00" },
    plannedStart: { offset: -50, time: "10:00:00" },
    plannedEnd: { offset: -50, time: "16:00:00" },
    actualStart: { offset: -50, time: "10:20:00" },
    actualEnd: { offset: -49, time: "11:30:00" },
    takesWorkCenterOffline: true
  },
  {
    key: "flatsat-breakout",
    status: "Open",
    priority: "Medium",
    severity: "Operator Performed",
    source: "Reactive",
    oeeImpact: "Impact",
    workCenter: "Hover Test Cage",
    suspectedFailureMode: "Electrical Fault",
    content:
      "Intermittent open on pin 14 of the hover cage harness breakout box — the battery telemetry channel drops out when the cable is flexed.",
    created: { offset: -2, time: "10:30:00" },
    plannedStart: { offset: 2, time: "09:00:00" },
    plannedEnd: { offset: 2, time: "11:00:00" }
  }
];

export const REPLACEMENT_PARTS: ReplacementPartSpec[] = [
  { workCenter: "Environmental Chamber 1", item: "CN-THREADLOCK", quantity: 1 },
  { workCenter: "Bonding & Cure Cell", item: "MTR-4114-G2", quantity: 1 },
  { workCenter: "CNC Mill", item: "ISO-DAMP-M3", quantity: 2 }
];

export const TRAININGS: TrainingSpec[] = [
  {
    name: "ESD Control for Flight Hardware",
    description:
      "ANSI/ESD S20.20 basics for anyone who handles flight electronics.",
    status: "Active",
    frequency: "Once",
    type: "Mandatory",
    estimatedDuration: "45m",
    content: [
      "Every flight board is ESD-sensitive. Inside the EPA you are grounded, the surface is dissipative, and insulators stay out.",
      "Check your wrist strap and heel straps at the tester every time you enter, and log the result."
    ],
    questions: [
      {
        type: "MultipleChoice",
        question:
          "What is the maximum wrist-strap system resistance the check-in tester accepts?",
        options: ["100 kΩ", "1 MΩ", "35 MΩ", "10 GΩ"],
        correct: "35 MΩ"
      },
      {
        type: "TrueFalse",
        question:
          "A grounded wrist strap is enough protection when the board sits on an ordinary, non-dissipative bench.",
        answer: false
      },
      {
        type: "MultipleAnswers",
        question:
          "Which of these belong inside the EPA? Select all that apply.",
        options: [
          "Static-shielding bags",
          "Ionizer",
          "Styrofoam cups",
          "Dissipative bench mat",
          "Standard bubble wrap"
        ],
        correct: ["Static-shielding bags", "Ionizer", "Dissipative bench mat"]
      },
      {
        type: "MatchingPairs",
        question: "Match each control to what it does.",
        pairs: [
          { left: "Wrist strap", right: "Grounds the operator" },
          { left: "Ionizer", right: "Neutralizes charge on insulators" },
          { left: "Static-shielding bag", right: "Protects parts in transit" }
        ]
      },
      {
        type: "Numerical",
        question:
          "How many inches must a process-essential insulator reading over 2,000 V/in be kept from an ESD-sensitive part?",
        answer: 12,
        tolerance: 0
      }
    ],
    assignment: { completedOffset: -12 }
  },
  {
    name: "Lithium Battery Handling & Storage",
    description:
      "Safe handling, storage and shipping of 12S lithium-ion flight packs.",
    status: "Active",
    frequency: "Annual",
    type: "Mandatory",
    estimatedDuration: "30m",
    content: [
      "Store packs at storage charge in the fire cabinet. A swollen or damaged pack goes straight to the sand bin, never back on the shelf."
    ],
    questions: [
      {
        type: "MultipleChoice",
        question: "In which order do you respond to a swollen pack?",
        options: [
          "Isolate, sand bin, report",
          "Report, isolate, sand bin",
          "Sand bin, report, isolate"
        ],
        correct: "Isolate, sand bin, report"
      },
      {
        type: "TrueFalse",
        question:
          "Packs may be stored at full charge on the open stockroom shelf.",
        answer: false
      }
    ],
    assignment: {}
  },
  {
    name: "Flight Test Operator Qualification",
    description:
      "Operator qualification for tethered hover and flight acceptance tests.",
    status: "Draft",
    frequency: "Once",
    type: "Optional",
    estimatedDuration: "90m",
    content: [
      "Draft — pre-flight checklist, tether limits and abort criteria for the hover cage."
    ],
    questions: [
      {
        type: "Numerical",
        question:
          "What is the maximum tethered hover height in the cage, in meters?",
        answer: 2,
        tolerance: 0.5
      }
    ]
  }
];

export const TIMECARDS: TimecardSpec[] = [
  { dayOffset: -5, clockIn: "06:58:00", clockOut: "15:31:00" },
  { dayOffset: -4, clockIn: "07:04:00", clockOut: "15:36:00" },
  {
    dayOffset: -3,
    clockIn: "06:55:00",
    clockOut: "17:12:00",
    note: "Stayed late for the environmental chamber pull-down."
  },
  { dayOffset: -2, clockIn: "07:01:00", clockOut: "15:29:00" },
  { dayOffset: -1, clockIn: "07:02:00", clockOut: "11:30:00" },
  { dayOffset: -1, clockIn: "12:01:00", clockOut: "15:34:00" }
];

// None on today, so the MES schedule opens on every work center, not one station.
export const PEOPLE_ASSIGNMENTS: PeopleAssignmentSpec[] = [
  { dayOffset: -2, workCenter: "CNC Mill", shift: "Day Shift" },
  { dayOffset: -1, workCenter: "Bonding & Cure Cell", shift: "Day Shift" },
  {
    dayOffset: 1,
    workCenter: "Integration Bay A",
    shift: "Day Shift",
    note: "Battery tray layup — cover for the bay lead."
  },
  { dayOffset: 2, workCenter: "CNC Mill", shift: "Day Shift" },
  {
    dayOffset: 3,
    workCenter: "Environmental Chamber 1",
    shift: "Day Shift",
    overtimeHours: 2,
    note: "Stay through the environmental chamber hot-soak handover."
  },
  { dayOffset: 4, workCenter: "Bonding & Cure Cell", shift: "Day Shift" }
];

export const PEOPLE_ABSENCES: PeopleAbsenceSpec[] = [
  {
    dayOffset: 9,
    note: "ITAR export-compliance refresher at the Huntsville office."
  }
];

export const SUGGESTIONS: SuggestionSpec[] = [
  {
    suggestion:
      "Show spare-part cost on the maintenance list so we can see what the environmental chamber costs us each month.",
    emoji: "🔧",
    path: "/x/resources/maintenance",
    tags: ["Maintenance"]
  },
  {
    suggestion:
      "Let us scan a lot barcode straight into the quantities search instead of typing the lot number.",
    emoji: "💡",
    path: "/x/inventory/quantities"
  }
];

export const NOTES: NoteSpec[] = [
  {
    text: "Qualified as flight test operator after the hover cage re-qualification — can run acceptance flights unsupervised."
  },
  {
    text: "Covering the ESD program audit while the quality lead is at the customer's CDR."
  }
];

export const USER_ATTRIBUTE_CATEGORIES: UserAttributeCategorySpec[] = [
  {
    name: "Flight Hardware Qualifications",
    emoji: "🛰️",
    public: true,
    attributes: [
      {
        name: "IPC J-STD-001 Class 3 certificate expires",
        dataType: "Date",
        valueOffset: 142
      },
      {
        name: "Flight test qualification level",
        dataType: "List",
        listOptions: ["Trainee", "Operator", "Instructor", "Test Pilot"],
        value: "Operator",
        canSelfManage: true
      },
      { name: "Qualification records owner", dataType: "User" },
      {
        name: "Cleared for flight-unit handling",
        dataType: "Yes/No",
        value: true
      }
    ]
  }
];

// The export and sourcing fields a defense part master carries (a Costpoint
// part's Export Control subtask has the same shape). Every part fills them
// through items.ts `customFieldValues`.
export const CUSTOM_FIELDS: CustomFieldSpec[] = [
  {
    table: "part",
    name: "Export jurisdiction",
    dataType: "List",
    listOptions: ["ITAR", "EAR", "EAR99"]
  },
  { table: "part", name: "USML / ECCN", dataType: "Text" },
  { table: "part", name: "Country of origin", dataType: "Text" },
  {
    table: "part",
    name: "NDAA §848 compliant",
    dataType: "List",
    listOptions: ["Yes", "No", "Under review"]
  },
  {
    table: "part",
    name: "IUID mark required",
    dataType: "List",
    listOptions: ["Yes", "No"]
  },
  {
    table: "part",
    name: "Magnet origin (DFARS 252.225-7052)",
    dataType: "Text"
  },
  { table: "customer", name: "Program manager", dataType: "User" },
  { table: "job", name: "First article required", dataType: "Yes/No" }
];

export const SERIAL_SEQUENCES: SerialSequenceSpec[] = [
  // Continues the supplier's numbering already on the shelf (…-0054).
  { item: "ESC-80A-NDAA", prefix: "ESC80-SN-", size: 4, next: 54 },
  // The air vehicle serial is the serial in its IUID mark (CAGE + part + serial).
  { item: "ISR4-AV", prefix: "HUS-AV-", size: 4, next: 1 },
  { item: "ISR4-SYS", prefix: "HUS-SYS-", size: 3, next: 1 },
  { item: "FC-NDAA-H7", prefix: "FC7-", size: 5, next: 10231 },
  { item: "MCU-EDGE-16", prefix: "MCE16-", size: 5, next: 4410 },
  { item: "GNSS-CRPA-4", prefix: "CRPA4-", size: 4, next: 318 },
  { item: "GCS-100", prefix: "GCS-", size: 4, next: 27 }
];

export const PRINT_JOBS: PrintJobSpec[] = [
  {
    source: { kind: "Receipt", receipt: "receipt:bare-boards" },
    item: "PCB-BARE-R3",
    status: "completed",
    origin: "auto",
    at: { offset: -1, time: "15:12:00" },
    attempts: 1
  },
  {
    source: { kind: "Job", job: "done-bus" },
    item: "AFR-100",
    status: "completed",
    origin: "manual",
    at: { offset: -2, time: "19:40:00" },
    attempts: 1
  },
  {
    source: { kind: "StorageUnit", shelf: "A1-L1" },
    status: "completed",
    origin: "manual",
    at: { offset: -6, time: "16:20:00" },
    attempts: 1
  },
  {
    source: { kind: "Job", job: "floor-bus" },
    item: "AFR-100",
    status: "failed",
    origin: "auto",
    at: { offset: -1, time: "13:05:00" },
    attempts: 3,
    error: "Printer did not respond after 3 attempts (connection timed out)"
  },
  {
    source: { kind: "Job", job: "floor-bus" },
    item: "AFR-100",
    status: "queued",
    origin: "reprint",
    at: { offset: 0, time: "06:52:00" },
    attempts: 0
  }
];

export const defenseOps: OpsData = {
  userAttributeCategories: USER_ATTRIBUTE_CATEGORIES,
  customFields: CUSTOM_FIELDS,
  serialSequences: SERIAL_SEQUENCES,
  printJobs: PRINT_JOBS,
  maintenanceSchedules: MAINTENANCE_SCHEDULES,
  maintenanceDispatches: MAINTENANCE_DISPATCHES,
  replacementParts: REPLACEMENT_PARTS,
  trainings: TRAININGS,
  timecards: TIMECARDS,
  peopleAssignments: PEOPLE_ASSIGNMENTS,
  peopleAbsences: PEOPLE_ABSENCES,
  suggestions: SUGGESTIONS,
  notes: NOTES
};
