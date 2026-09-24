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
    key: "winding-tension",
    name: "Winding line wire-tensioner & nozzle check",
    description:
      "Verify the tensioner setpoint with the gauge, inspect the needle nozzles for enamel scrape and clear the wire guides.",
    workCenter: "Winding Line 1",
    frequency: "Daily",
    priority: "Medium",
    estimatedDuration: 20,
    nextDueOffset: 1
  },
  {
    key: "oven-profile",
    name: "Impregnation oven zone temperature check",
    description:
      "Log each zone against the varnish cure profile with the reference thermocouple and clean the exhaust filter.",
    workCenter: "Impregnation Oven",
    frequency: "Weekly",
    priority: "Medium",
    estimatedDuration: 45,
    nextDueOffset: 2
  },
  {
    key: "balancer-spindle",
    name: "Balancing machine spindle bearing re-grease",
    description:
      "Re-grease the balancer's drive-end bearings and run the reference rotor to confirm the unbalance reading.",
    workCenter: "Balancing Cell",
    frequency: "Monthly",
    priority: "High",
    estimatedDuration: 60,
    nextDueOffset: 17,
    takesWorkCenterOffline: true,
    spareParts: [{ item: "CN-BRG-GREASE", quantity: 1 }]
  },
  {
    key: "press-die",
    name: "Lamination press die sharpen & shim",
    description:
      "Measure burr height on the stator laminations and send the die out for sharpening when it passes 25 µm.",
    workCenter: "Lamination Press",
    frequency: "Quarterly",
    priority: "High",
    estimatedDuration: 240,
    nextDueOffset: 39,
    takesWorkCenterOffline: true
  },
  {
    key: "dyno-cert",
    name: "Annual dynamometer torque-cell calibration",
    description:
      "Third-party calibration of the dyno torque transducer and speed encoder against traceable standards.",
    workCenter: "Dyno Test Cell",
    frequency: "Annual",
    priority: "High",
    estimatedDuration: 420,
    nextDueOffset: 155,
    takesWorkCenterOffline: true
  },
  {
    key: "proto-winder-cal",
    name: "Prototype winder tension calibration",
    description:
      "Check the lab winder's tensioner against the reference spring gauge at three setpoints and log the correction.",
    workCenter: "Prototype Winding Lab",
    frequency: "Monthly",
    priority: "Medium",
    estimatedDuration: 45,
    nextDueOffset: 9
  }
];

// Shapes the maintenance KPIs and boards read: a failure on a production day,
// back-dated completions, today's scheduled task, a machine down now, one at HQ.
export const MAINTENANCE_DISPATCHES: MaintenanceDispatchSpec[] = [
  {
    key: "winding-nozzle",
    status: "Open",
    priority: "High",
    severity: "Support Required",
    source: "Reactive",
    oeeImpact: "Impact",
    workCenter: "Winding Line 1",
    suspectedFailureMode: "Excessive Wear",
    content:
      "Needle nozzle on head 2 scraping enamel — two stators failed the surge test on the first shift. Running head 1 only until it's swapped.",
    created: { offset: -1, time: "08:15:00" },
    plannedStart: { offset: 1, time: "06:00:00" },
    plannedEnd: { offset: 1, time: "08:00:00" }
  },
  {
    key: "balancer-vibration",
    status: "Assigned",
    priority: "Critical",
    severity: "OEM Required",
    source: "Non-Conformance",
    oeeImpact: "Down",
    workCenter: "Balancing Cell",
    nonConformance: "ncr:fan-noise",
    suspectedFailureMode: "Excessive Vibration",
    content:
      "Balancer reading 40% high on the reference rotor after the fan-noise escapes. Cell locked out; OEM field service booked to check the sensor and drive belt.",
    created: { offset: -5, time: "15:10:00" },
    plannedStart: { offset: 2, time: "08:00:00" },
    plannedEnd: { offset: 2, time: "14:00:00" },
    takesWorkCenterOffline: true,
    comments: [
      "OEM confirmed a replacement velocity sensor is on the truck.",
      "Rotors are balanced on the backup machine at half rate until then."
    ]
  },
  {
    key: "cmm-temp-comp",
    status: "In Progress",
    priority: "Low",
    severity: "Operator Performed",
    source: "Reactive",
    oeeImpact: "No Impact",
    workCenter: "CMM Inspection Bench",
    suspectedFailureMode: "Misalignment",
    content:
      "Shaft journal readings drifting 3 µm between morning and afternoon. Re-running the temperature compensation and re-qualifying the probe.",
    created: { offset: -1, time: "12:50:00" },
    plannedStart: { offset: -1, time: "13:00:00" },
    plannedEnd: { offset: -1, time: "14:00:00" },
    actualStart: { offset: -1, time: "13:10:00" }
  },
  {
    key: "balancer-regrease",
    status: "Completed",
    priority: "Medium",
    severity: "Preventive",
    source: "Scheduled",
    oeeImpact: "Planned",
    workCenter: "Balancing Cell",
    schedule: "balancer-spindle",
    actualFailureMode: "Overheating",
    content:
      "Monthly spindle re-grease. Drive-end bearing housing was running hot at 68 °C — purged the old grease, re-packed and re-ran the reference rotor.",
    created: { offset: -11, time: "06:00:00" },
    plannedStart: { offset: -10, time: "12:00:00" },
    plannedEnd: { offset: -10, time: "13:00:00" },
    actualStart: { offset: -10, time: "12:05:00" },
    actualEnd: { offset: -10, time: "13:40:00" },
    takesWorkCenterOffline: true,
    // Deliberately more than the kit's one pound.
    spareParts: [{ item: "CN-BRG-GREASE", quantity: 2, shelf: "A2-L2" }],
    comments: ["Bearing housing after re-pack: 41 °C at full speed."]
  },
  {
    key: "oven-profile-skip",
    status: "Cancelled",
    priority: "Medium",
    severity: "Preventive",
    source: "Scheduled",
    oeeImpact: "Planned",
    workCenter: "Impregnation Oven",
    schedule: "oven-profile",
    content:
      "Weekly zone check. Cancelled — the oven was profiled the day before during the varnish-lot changeover.",
    created: { offset: -7, time: "06:00:00" },
    plannedStart: { offset: -6, time: "10:00:00" },
    plannedEnd: { offset: -6, time: "10:45:00" }
  },
  {
    key: "winding-tension-today",
    status: "Assigned",
    priority: "Medium",
    severity: "Preventive",
    source: "Scheduled",
    oeeImpact: "Planned",
    workCenter: "Winding Line 1",
    schedule: "winding-tension",
    content:
      "Daily tensioner and nozzle check: verify the setpoint with the gauge, inspect the needle nozzles for enamel scrape, clear the wire guides.",
    created: { offset: -1, time: "06:00:00" },
    plannedStart: { offset: 0, time: "14:00:00" },
    plannedEnd: { offset: 0, time: "14:20:00" }
  },
  {
    key: "press-lube-pump",
    status: "In Progress",
    priority: "High",
    severity: "Support Required",
    source: "Reactive",
    oeeImpact: "Down",
    workCenter: "Lamination Press",
    suspectedFailureMode: "Lubrication Failure",
    content:
      "Die lubrication pump lost prime — the press faulted on low lube pressure mid-run. Press locked out while the pump is primed and the check valve replaced.",
    created: { offset: -1, time: "15:10:00" },
    plannedStart: { offset: -1, time: "15:30:00" },
    plannedEnd: { offset: 1, time: "10:00:00" },
    actualStart: { offset: -1, time: "15:35:00" },
    takesWorkCenterOffline: true,
    comments: [
      "Check valve on order; die clamp bolts re-torqued while the press is open."
    ]
  },
  {
    key: "assembly-bearing-heater",
    status: "Completed",
    priority: "Medium",
    severity: "Operator Performed",
    source: "Reactive",
    oeeImpact: "Impact",
    workCenter: "Motor Assembly Bench",
    suspectedFailureMode: "Electrical Fault",
    actualFailureMode: "Electrical Fault",
    content:
      "Induction bearing heater stopped at 60 °C mid-cycle — thermocouple lead broken at the magnetic probe. Lead replaced; heater reaching 110 °C again.",
    created: { offset: -9, time: "14:15:00" },
    plannedStart: { offset: -9, time: "14:20:00" },
    plannedEnd: { offset: -9, time: "15:00:00" },
    actualStart: { offset: -9, time: "14:25:00" },
    actualEnd: { offset: -9, time: "14:55:00" }
  },
  {
    key: "balancer-regrease-prior",
    status: "Completed",
    priority: "High",
    severity: "Preventive",
    source: "Scheduled",
    oeeImpact: "Planned",
    workCenter: "Balancing Cell",
    schedule: "balancer-spindle",
    content:
      "Monthly balancer spindle re-grease; reference rotor read 0.4 g·mm after the run-in.",
    created: { offset: -44, time: "06:00:00" },
    plannedStart: { offset: -43, time: "10:00:00" },
    plannedEnd: { offset: -43, time: "11:00:00" },
    actualStart: { offset: -43, time: "10:05:00" },
    actualEnd: { offset: -43, time: "10:55:00" },
    takesWorkCenterOffline: true,
    spareParts: [{ item: "CN-BRG-GREASE", quantity: 1, shelf: "A2-L2" }]
  },
  {
    key: "oven-door-seal",
    status: "Completed",
    priority: "High",
    severity: "Support Required",
    source: "Reactive",
    oeeImpact: "Down",
    workCenter: "Impregnation Oven",
    suspectedFailureMode: "Leak",
    actualFailureMode: "Leak",
    content:
      "Oven door gasket split along the hinge side — zone 2 could not hold 160 °C for the cure. Gasket replaced and the zone re-profiled before releasing the oven.",
    created: { offset: -53, time: "08:30:00" },
    plannedStart: { offset: -53, time: "09:00:00" },
    plannedEnd: { offset: -53, time: "15:00:00" },
    actualStart: { offset: -53, time: "09:10:00" },
    actualEnd: { offset: -52, time: "09:40:00" },
    takesWorkCenterOffline: true
  },
  {
    key: "proto-winder-encoder",
    status: "Open",
    priority: "Medium",
    severity: "Operator Performed",
    source: "Reactive",
    oeeImpact: "Impact",
    workCenter: "Prototype Winding Lab",
    suspectedFailureMode: "Electrical Fault",
    content:
      "The lab winder's turn counter skips counts above 600 rpm — encoder cable shield looks chafed at the drag chain.",
    created: { offset: -2, time: "13:00:00" },
    plannedStart: { offset: 2, time: "09:00:00" },
    plannedEnd: { offset: 2, time: "10:30:00" }
  }
];

export const REPLACEMENT_PARTS: ReplacementPartSpec[] = [
  { workCenter: "Balancing Cell", item: "BRG-6206-C3", quantity: 2 },
  { workCenter: "Impregnation Oven", item: "FAN-AX-160", quantity: 1 },
  { workCenter: "Lamination Press", item: "FST-M10-SS", quantity: 8 }
];

export const TRAININGS: TrainingSpec[] = [
  {
    name: "Rare-Earth Magnet Handling",
    description: "Safe handling, storage and bonding of NdFeB rotor magnets.",
    status: "Active",
    frequency: "Once",
    type: "Mandatory",
    estimatedDuration: "30m",
    content: [
      "Rotor magnets pinch hard and chip easily. Keep them in their spacers until they go into the rotor, and never let two free magnets meet.",
      "Magnetized rotors stay away from the CMM and anyone with an implanted medical device."
    ],
    questions: [
      {
        type: "MultipleChoice",
        question:
          "How are loose magnets moved between the bench and the rotor?",
        options: [
          "In a pocket",
          "In their non-magnetic spacers",
          "Stacked together",
          "On a steel tray"
        ],
        correct: "In their non-magnetic spacers"
      },
      {
        type: "TrueFalse",
        question:
          "A chipped magnet may still be bonded if the chip is on the inner face.",
        answer: false
      },
      {
        type: "MultipleAnswers",
        question:
          "Which of these must stay clear of a magnetized rotor? Select all that apply.",
        options: [
          "Pacemakers",
          "Steel hand tools",
          "The CMM probe",
          "Nitrile gloves",
          "Magnetic ID badges"
        ],
        correct: [
          "Pacemakers",
          "Steel hand tools",
          "The CMM probe",
          "Magnetic ID badges"
        ]
      },
      {
        type: "MatchingPairs",
        question: "Match each step to its purpose.",
        pairs: [
          { left: "Spacer", right: "Keeps magnets from snapping together" },
          {
            left: "Bonding epoxy",
            right: "Holds the magnet to the rotor core"
          },
          { left: "Magnetizer", right: "Charges the finished rotor" }
        ]
      },
      {
        type: "Numerical",
        question:
          "What is the minimum epoxy cure time before a bonded rotor can be balanced, in hours?",
        answer: 24,
        tolerance: 0
      }
    ],
    assignment: { completedOffset: -18 }
  },
  {
    name: "Winding & Surge Test Basics",
    description:
      "Coil winding, enamel care and the surge test acceptance limits.",
    status: "Active",
    frequency: "Annual",
    type: "Mandatory",
    estimatedDuration: "40m",
    content: [
      "Every stator gets a surge test before impregnation. A scraped enamel turn shows up as a waveform mismatch — scrap it, never re-varnish over it."
    ],
    questions: [
      {
        type: "MultipleChoice",
        question: "When does a stator get its surge test?",
        options: [
          "After impregnation",
          "Before impregnation",
          "Only on customer request"
        ],
        correct: "Before impregnation"
      },
      {
        type: "TrueFalse",
        question:
          "A stator with a failed surge test can be re-varnished and shipped.",
        answer: false
      }
    ],
    assignment: {}
  },
  {
    name: "Dynamometer Test Cell Operation",
    description:
      "Operator qualification for running motor performance curves on the dyno.",
    status: "Draft",
    frequency: "Once",
    type: "Optional",
    estimatedDuration: "60m",
    content: [
      "Draft — mounting, coupling alignment and the torque-speed sweep for production motors."
    ],
    questions: [
      {
        type: "Numerical",
        question:
          "What is the maximum coupling misalignment allowed on the dyno, in mm?",
        answer: 0.05,
        tolerance: 0.01
      }
    ]
  }
];

export const TIMECARDS: TimecardSpec[] = [
  { dayOffset: -5, clockIn: "06:30:00", clockOut: "15:02:00" },
  { dayOffset: -4, clockIn: "06:28:00", clockOut: "15:05:00" },
  { dayOffset: -3, clockIn: "06:33:00", clockOut: "15:00:00" },
  {
    dayOffset: -2,
    clockIn: "06:25:00",
    clockOut: "17:40:00",
    note: "Stayed to run the Halcyon actuator motors through the dyno."
  },
  { dayOffset: -1, clockIn: "06:31:00", clockOut: "11:00:00" },
  { dayOffset: -1, clockIn: "11:30:00", clockOut: "15:03:00" }
];

// Clocked in before the first timer on the floor started this morning.
export const OPEN_TIMECARD: OpenTimecardSpec = { clockIn: "06:29:00" };

// None on today, so the MES schedule opens on every work center, not one station.
export const PEOPLE_ASSIGNMENTS: PeopleAssignmentSpec[] = [
  { dayOffset: -2, workCenter: "Winding Line 1", shift: "A Shift" },
  { dayOffset: -1, workCenter: "Motor Assembly Bench", shift: "A Shift" },
  {
    dayOffset: 1,
    workCenter: "CNC Turning Cell",
    shift: "A Shift",
    note: "Cover shaft turning while the setter is on leave."
  },
  { dayOffset: 2, workCenter: "Winding Line 1", shift: "A Shift" },
  {
    dayOffset: 3,
    workCenter: "Dyno Test Cell",
    shift: "A Shift",
    overtimeHours: 2,
    note: "Witness the Halcyon actuator dyno run."
  },
  { dayOffset: 4, workCenter: "Motor Assembly Bench", shift: "A Shift" }
];

export const PEOPLE_ABSENCES: PeopleAbsenceSpec[] = [
  {
    dayOffset: 9,
    note: "NFPA 70E arc-flash safety training."
  }
];

export const SUGGESTIONS: SuggestionSpec[] = [
  {
    suggestion:
      "Warn on the maintenance list when a dispatch takes the balancing cell offline while rotor jobs are queued for it.",
    emoji: "⚙️",
    path: "/x/resources/maintenance",
    tags: ["Maintenance"]
  },
  {
    suggestion:
      "Let planners see magnet lot shelf life on the purchasing planning screen.",
    emoji: "🧲",
    path: "/x/purchasing/planning"
  }
];

export const NOTES: NoteSpec[] = [
  {
    text: "Qualified on the new surge tester — can release stators to impregnation on second shift."
  },
  {
    text: "Point of contact for the balancer OEM visit while the maintenance lead is out."
  }
];

export const USER_ATTRIBUTE_CATEGORIES: UserAttributeCategorySpec[] = [
  {
    name: "Winding & Electrical Safety",
    emoji: "⚡",
    public: true,
    attributes: [
      {
        name: "NFPA 70E arc-flash training expires",
        dataType: "Date",
        valueOffset: 61
      },
      {
        name: "Hipot tester authorization",
        dataType: "List",
        listOptions: ["None", "Supervised", "Independent"],
        value: "Independent"
      },
      { name: "Electrical work permit signer", dataType: "User" },
      {
        name: "Qualified electrical worker",
        dataType: "Yes/No",
        value: true,
        canSelfManage: true
      }
    ]
  }
];

export const CUSTOM_FIELDS: CustomFieldSpec[] = [
  { table: "part", name: "NEMA frame", dataType: "Text" },
  { table: "customer", name: "Application engineer", dataType: "User" },
  { table: "job", name: "Hipot witness required", dataType: "Yes/No" }
];

export const SERIAL_SEQUENCES: SerialSequenceSpec[] = [
  // Continues the supplier's numbering already on the shelf (…-0036).
  { item: "ENC-INC-2048", prefix: "ENC2048-SN-", size: 4, next: 36 },
  { item: "MTR-9000", prefix: "MTR9000-SN-", size: 4, next: 1 },
  { item: "MTR-4500", prefix: "MTR4500-SN-", size: 4, next: 0 }
];

export const PRINT_JOBS: PrintJobSpec[] = [
  {
    source: { kind: "Receipt", receipt: "receipt:copperline-restock" },
    item: "TRM-BLK-6P",
    status: "completed",
    origin: "auto",
    at: { offset: -2, time: "15:26:00" },
    attempts: 1
  },
  {
    source: { kind: "Job", job: "done-rotor" },
    item: "ROT-9000",
    status: "completed",
    origin: "manual",
    at: { offset: -3, time: "19:55:00" },
    attempts: 1
  },
  {
    source: { kind: "StorageUnit", shelf: "A1-L1" },
    status: "completed",
    origin: "manual",
    at: { offset: -6, time: "16:30:00" },
    attempts: 1
  },
  {
    source: { kind: "Job", job: "floor-stator" },
    item: "STA-4500",
    status: "failed",
    origin: "auto",
    at: { offset: -1, time: "13:50:00" },
    attempts: 3,
    error: "Printer did not respond after 3 attempts (connection timed out)"
  },
  {
    source: { kind: "Job", job: "floor-stator" },
    item: "STA-4500",
    status: "queued",
    origin: "reprint",
    at: { offset: 0, time: "06:48:00" },
    attempts: 0
  }
];

export const motorOps: OpsData = {
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
