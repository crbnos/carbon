import type {
  MaintenanceDispatchSpec,
  MaintenanceScheduleSpec,
  NoteSpec,
  OpsData,
  SuggestionSpec,
  TimecardSpec,
  TrainingSpec
} from "../../types.ts";

// One preventive schedule per frequency, spread over the shop's work centers.
export const MAINTENANCE_SCHEDULES: MaintenanceScheduleSpec[] = [
  {
    key: "cleanroom-particles",
    name: "Clean room particle count & wipe-down",
    description:
      "Handheld particle counter at the four ISO 7 sample points; wipe benches and glove ports with IPA.",
    workCenter: "Clean Room Bay A",
    frequency: "Daily",
    priority: "Medium",
    estimatedDuration: 30,
    nextDueOffset: 1,
    weekends: false
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
    name: "TVAC cryopump regeneration & door O-ring inspection",
    description:
      "Regenerate the cryopump, inspect and re-grease the door O-ring with Krytox, then leak-check to 1e-6 Torr.",
    workCenter: "TVAC Chamber 1",
    frequency: "Monthly",
    priority: "High",
    estimatedDuration: 240,
    nextDueOffset: 21,
    takesWorkCenterOffline: true,
    spareParts: [{ item: "CN-GREASE-001", quantity: 1 }]
  },
  {
    key: "pcb-reflow-profile",
    name: "Reflow oven thermal profile verification",
    description:
      "Run the profiling board through the reflow oven and compare each zone against the IPC J-STD-001 space addendum profile.",
    workCenter: "PCB Lab",
    frequency: "Quarterly",
    priority: "Medium",
    estimatedDuration: 120,
    nextDueOffset: 38
  },
  {
    key: "tig-calibration",
    name: "Annual TIG welder calibration",
    description:
      "Third-party amperage and gas-flow calibration of the TIG power supply per AWS D17.1 requirements.",
    workCenter: "TIG Welder Cell",
    frequency: "Annual",
    priority: "High",
    estimatedDuration: 480,
    nextDueOffset: 145,
    takesWorkCenterOffline: true
  }
];

// Exactly one dispatch per status, spanning every severity, priority, source
// and OEE impact.
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
      "Sylgard meter-mix dispense needle clogging mid-shot — two EPS boards came out with potting voids this morning.",
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
    workCenter: "TVAC Chamber 1",
    nonConformance: "ncr:txrx-tvac",
    suspectedFailureMode: "Electrical Fault",
    content:
      "Shroud thermocouple TC-07 read 6 °C high during the transceiver thermal cycle. Chamber locked out; OEM field service booked to replace the feedthrough.",
    created: { offset: -4, time: "16:20:00" },
    plannedStart: { offset: 3, time: "08:00:00" },
    plannedEnd: { offset: 3, time: "16:00:00" },
    takesWorkCenterOffline: true,
    comments: [
      "Feedthrough part number confirmed with the OEM — ships Tuesday.",
      "Rerun of the transceiver cycle is on hold until the chamber is re-qualified."
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
    workCenter: "TVAC Chamber 1",
    schedule: "tvac-cryopump",
    actualFailureMode: "Leak",
    content:
      "Monthly cryopump regeneration. Door O-ring was weeping at the hinge side on the leak check — cleaned, re-greased and re-seated.",
    created: { offset: -10, time: "06:00:00" },
    plannedStart: { offset: -9, time: "12:00:00" },
    plannedEnd: { offset: -9, time: "16:00:00" },
    actualStart: { offset: -9, time: "12:15:00" },
    actualEnd: { offset: -9, time: "17:05:00" },
    takesWorkCenterOffline: true,
    // Two pounds instead of the kit's one — the leak took a full re-grease,
    // which is why the next satellite kit is short of Krytox.
    spareParts: [{ item: "CN-GREASE-001", quantity: 2, shelf: "A1-L3" }],
    comments: ["Leak rate after re-seat: 2e-7 Torr·L/s — within spec."]
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
  }
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
    name: "Clean Room Gowning & Contamination Control",
    description:
      "ISO 7 gowning order, allowed materials and particle discipline.",
    status: "Active",
    frequency: "Annual",
    type: "Mandatory",
    estimatedDuration: "30m",
    content: [
      "Gown top-down: hood, coverall, then boots. Nothing from the gray area crosses the bench line."
    ],
    questions: [
      {
        type: "MultipleChoice",
        question: "In which order are clean room garments put on?",
        options: [
          "Hood, coverall, boots",
          "Boots, coverall, hood",
          "Coverall, hood, boots"
        ],
        correct: "Hood, coverall, boots"
      },
      {
        type: "TrueFalse",
        question: "Pencils and cosmetics are allowed inside the ISO 7 bay.",
        answer: false
      }
    ],
    assignment: {}
  },
  {
    name: "TVAC Chamber Operation",
    description:
      "Operator qualification for running flight-unit thermal vacuum cycles.",
    status: "Draft",
    frequency: "Once",
    type: "Optional",
    estimatedDuration: "90m",
    content: [
      "Draft — pump-down, bake-out and thermal ramp limits for the chamber."
    ],
    questions: [
      {
        type: "Numerical",
        question:
          "What is the maximum shroud ramp rate for flight units, in °C per minute?",
        answer: 2,
        tolerance: 0.5
      }
    ]
  }
];

// The past working week on the time clock, split around lunch on the last day.
export const TIMECARDS: TimecardSpec[] = [
  { dayOffset: -5, clockIn: "06:58:00", clockOut: "15:31:00" },
  { dayOffset: -4, clockIn: "07:04:00", clockOut: "15:36:00" },
  {
    dayOffset: -3,
    clockIn: "06:55:00",
    clockOut: "17:12:00",
    note: "Stayed late for the TVAC pump-down."
  },
  { dayOffset: -2, clockIn: "07:01:00", clockOut: "15:29:00" },
  { dayOffset: -1, clockIn: "07:02:00", clockOut: "11:30:00" },
  { dayOffset: -1, clockIn: "12:01:00", clockOut: "15:34:00" }
];

export const SUGGESTIONS: SuggestionSpec[] = [
  {
    suggestion:
      "Show spare-part cost on the maintenance list so we can see what the TVAC chamber costs us each month.",
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
    text: "Qualified as TVAC operator after the chamber re-qualification — can run flight-unit cycles unsupervised."
  },
  {
    text: "Covering the ESD program audit while the quality lead is at the customer's CDR."
  }
];

export const satelliteOps: OpsData = {
  maintenanceSchedules: MAINTENANCE_SCHEDULES,
  maintenanceDispatches: MAINTENANCE_DISPATCHES,
  trainings: TRAININGS,
  timecards: TIMECARDS,
  suggestions: SUGGESTIONS,
  notes: NOTES
};
