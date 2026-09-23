import type {
  MaintenanceDispatchSpec,
  MaintenanceScheduleSpec,
  NoteSpec,
  OpsData,
  SuggestionSpec,
  TimecardSpec,
  TrainingSpec
} from "../../types.ts";

// One preventive schedule per frequency, spread over the shop's machines.
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
    nextDueOffset: 1,
    weekends: false
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
  }
];

// Exactly one dispatch per status, spanning every severity, priority, source
// and OEE impact.
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
  }
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

// The past working week on the time clock, split around lunch on the last day.
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

export const precisionOps: OpsData = {
  maintenanceSchedules: MAINTENANCE_SCHEDULES,
  maintenanceDispatches: MAINTENANCE_DISPATCHES,
  trainings: TRAININGS,
  timecards: TIMECARDS,
  suggestions: SUGGESTIONS,
  notes: NOTES
};
