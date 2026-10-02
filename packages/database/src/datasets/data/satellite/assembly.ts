// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AssemblySpec } from "../../types.ts";

// Animated 3D work instructions over the bundled smallsat model (an original,
// generated model — see assets/ATTRIBUTION.md). Node ids are graph.json keys from
// that exact file; regenerate them whenever the model is re-baked.
//
// The build is three sub-assemblies made on their own benches (wings, reaction
// wheel pack, propulsion module), two parent sub-assemblies that use them (power
// subsystem uses the wings, avionics stack uses the wheel pack), and the main
// integration that brings everything into the finished SAT-1000. Members sit
// directly before their header; `usedIn` names the step that fits the finished unit.
export const satelliteAssembly: AssemblySpec = {
  model: "smallsat",
  name: "ESPA Smallsat — Integration Sequence",
  item: "SAT-1000",
  componentCount: 266,
  // The Assembly operation of the SAT-1000 method.
  operation: 1,
  motionsBakedFor: "3f7f48a0eeda4931",
  steps: [
    {
      parent: "sa-wings",
      title: "Lay up the six wing panels",
      instruction:
        "Set the six carbon honeycomb substrates face-up on the flat bench, three per wing, in their serialized order. Check each for core crush and edge delamination under raking light before anything is bonded to it.",
      componentNodeIds: [
        "ee01ec193ce225d7",
        "73bf72b82518f7a2",
        "05652600560cd7d8",
        "40382813c8872f60",
        "5ae7d178535ced8f",
        "a749ecc02f43dfd5"
      ],
      view: [0.595, 0.777, 0.206]
    },
    {
      parent: "sa-wings",
      title: "Bond the cell blankets and interconnects",
      instruction:
        "Bond one GaAs cell blanket to each substrate with the vacuum bag at the traveler's cure schedule, then lay the silver interconnect grid over the cell gaps. Photograph every panel under electroluminescence and log any cracked cell by row and column.",
      componentNodeIds: [
        "49f5f40d21662ed0",
        "3f0252ae8e2af550",
        "1f85849c570039a1",
        "56bb37fae44f0123",
        "2a57b6ad77300852",
        "0ca98cfeda51adf9",
        "383044f9f9231c57",
        "15ac4e6303dd116b",
        "646619f8e660eebb",
        "455d2a0b6744acf0",
        "0691f9ad59a8de6c",
        "a7b2ea3bdd4cb174"
      ],
      motion: { type: "linear", direction: [0, 0, -1], distance: 6.6 },
      view: [0.987, 0, 0.158]
    },
    {
      parent: "sa-wings",
      title: "Fit panel hinges and hold-downs",
      instruction:
        "Fit the two spring hinges at each panel joint and the hold-down cup on the back of every panel. Cycle each hinge through its full travel by hand; any hinge that needs force to latch comes back off.",
      componentNodeIds: [
        "791730c2ba6d5a1c",
        "a0dbac901fc48f71",
        "e8c12e8850ff079b",
        "6a9876356bdaa807",
        "12ebc2752d60b5cf",
        "3bdde3224fc7574a",
        "4ee9e549fba486ac",
        "b146c29f98e8986e",
        "2db1bbf3c8d903ff",
        "7029ec9de3c52448",
        "23c99e147c0cfa78",
        "497a5b2e34c538a3",
        "1f0733afff17327a",
        "8480c2ffa46b80d2",
        "c8980bb8854b438d",
        "1c1a3ea847b79406",
        "8db0fec40d8d3d23",
        "78946c6d13d4f9b9"
      ],
      motion: {
        type: "L",
        segments: [
          { direction: [0, 1, 0], distance: 3743 },
          { direction: [0, 0, 1], distance: 5630.9 }
        ]
      },
      view: [0.9, 0.329, 0.286]
    },
    {
      parent: "sa-wings",
      title: "Fit the yokes and root fittings",
      instruction:
        "Pin each yoke to its inboard panel hinges and bolt the titanium root fitting to the yoke apex. Hang both wings on the zero-g rig and deploy them once; record the deployment time per wing.",
      componentNodeIds: [
        "79f3cd7541fc8cbc",
        "5c01ab3885023bed",
        "8bedd493e3de491a",
        "130f550d7443a811"
      ],
      tools: [{ item: "TL-TORQUE-J1", quantity: 1 }],
      view: [0.987, 0, 0.158],
      blockedBy: ["49f5f40d21662ed0", "791730c2ba6d5a1c", "ee01ec193ce225d7"]
    },
    {
      key: "sa-wings",
      isSubAssembly: true,
      usedIn: "eps-wings",
      title: "Solar Array Wings",
      instruction:
        "Both wings, deployed and tested, ready to fit to the solar array drives.",
      componentNodeIds: []
    },
    {
      parent: "sa-adcs",
      title: "Mount the base plate and pyramid bracket",
      instruction:
        "Bolt the pyramid bracket to the ADCS base plate with the alignment pins fitted first. Measure the four face angles with the optical cube and record them — the wheel axes are only as good as these faces.",
      componentNodeIds: ["1168e3a3989c40f3", "f4e8922cfef5b476"],
      view: [-0.574, -0.445, 0.687]
    },
    {
      parent: "sa-adcs",
      title: "Fit the four reaction wheels",
      instruction:
        "Fit one RW-010 to each pyramid face with the connector pointing down-slope. Torque the flange screws in a star pattern in two passes and witness-mark every screw.",
      componentNodeIds: [
        "4b822f523330c01e",
        "919c84b5e47c4362",
        "3044df20a1a42904",
        "5bf9da2e97d7377d",
        "ca619ef2d0ba20af",
        "f54ab4299c067490",
        "6a119714ef036bb3",
        "fc449f163f02ea7b",
        "5dd6e8e90579d91e",
        "8b122f95d781bf8f",
        "fc39152ec70fa63e",
        "2d9bc7d49fd3ab37",
        "18f760e5583cba01",
        "08bf20676620d3bc",
        "7d3740173cee495d",
        "c6b65b24deb91b66"
      ],
      tools: [{ item: "TL-TORQUE-J1", quantity: 1 }],
      view: [0.987, 0, 0.158],
      blockedBy: ["1168e3a3989c40f3"]
    },
    {
      parent: "sa-adcs",
      title: "Fit the ADCS board and magnetorquers",
      instruction:
        "Mount the PCB-ADCS-R1 board on its standoffs, then clamp the three magnetorquer rods on their orthogonal axes. Keep every magnetic tool at least 30 cm away from the magnetometer once the board is in.",
      componentNodeIds: [
        "ab653f1d58be3a99",
        "cf3a7eca29021530",
        "d3869b541a3c5d8a",
        "df27a851fc143b99",
        "c0fe17609089b711",
        "085c649a9dda6b93",
        "2792a57f5dc0b0ba",
        "e659afe57282ab07",
        "1d8e77f9ed5e959b",
        "c2d9486a3f385558",
        "28a105fee28d5558",
        "3a1803ad9206639e",
        "f1c2b842b6adb9df",
        "7dd3e0164dd65ad1",
        "145187aeded7b226",
        "7b4f21a720c05464",
        "2ae1e47bf2c2057e",
        "dc68ece26f0bef9e",
        "be94bffcbc7cf950",
        "4930715519289684",
        "0da6fb5630a02b3c",
        "7db60bc9eaa09414",
        "13e9d8e9f4faf6f5",
        "a38f8f0ddcdfb1e3"
      ],
      motion: { type: "linear", direction: [0, 0, -1], distance: 127 },
      view: [0.987, 0, 0.158]
    },
    {
      parent: "sa-adcs",
      title: "Fit the first star tracker",
      instruction:
        "Fit star tracker 1 on its bracket with the baffle pointing out through the +X panel line. Leave the lens cap on until final close-out and log its boresight against the alignment cube.",
      componentNodeIds: [
        "15159fe79ba60bf7",
        "b7a5d14b95f70669",
        "cd60e7c94e5f1070",
        "68ac498431fe92d8",
        "598ed2c000ae49dc"
      ],
      motion: {
        type: "linear",
        direction: [-0.8525, -0.0181, -0.5223],
        distance: 229.4
      },
      view: [0.9, 0.329, 0.286]
    },
    {
      parent: "sa-adcs",
      title: "Fit the second star tracker",
      instruction:
        "Fit star tracker 2 the same way, baffle out through the +X panel line, lens cap on. Log its boresight against the alignment cube.",
      componentNodeIds: [
        "9d8ae0582b1ae5da",
        "fc43945a99fd9a90",
        "071029ac9cca8cfe",
        "3e6b7247d7a3f953",
        "2168dc5ab93e530f"
      ],
      view: [0.987, 0, 0.158],
      blockedBy: [
        "1168e3a3989c40f3",
        "15159fe79ba60bf7",
        "4b822f523330c01e",
        "ab653f1d58be3a99"
      ]
    },
    {
      key: "adcs-spin-test",
      parent: "sa-adcs",
      title: "Spin-test the reaction wheels",
      instruction:
        "Power the pack from the bench supply and run each wheel to ±6000 rpm and back. Record run-up time, current and vibration per wheel; a wheel outside the band on the traveler is swapped before the pack leaves the bench.",
      componentNodeIds: []
    },
    {
      key: "sa-adcs",
      isSubAssembly: true,
      usedIn: "av-adcs",
      title: "Reaction Wheel Pack",
      instruction:
        "The reaction wheel pack with star trackers and ADCS board, spin-tested.",
      componentNodeIds: []
    },
    {
      parent: "sa-prop",
      title: "Cradle the propellant tank",
      instruction:
        "Set the TANK-TI-4L on its two saddles with the outlet boss facing -Y, then close the straps over it. Tension both straps to the traveler figure and check the tank cannot rotate in the cradle.",
      componentNodeIds: [
        "b83463843b398739",
        "b5ff91b10a2b31ca",
        "fba1ab3e19801415",
        "10d176b3d2ad0372",
        "6d080fe986a252cb",
        "c635ad612e12d7da",
        "785248afc59ed9f2",
        "3a874f85804eb56f"
      ],
      view: [-0.531, 0.756, 0.383]
    },
    {
      parent: "sa-prop",
      title: "Fit the valves, filter and transducer",
      instruction:
        "Mount the four solenoid valves as two series pairs, one pair per thruster, then the filter and the pressure transducer. Cap every open port the moment its protective plug comes out.",
      componentNodeIds: [
        "cb6723c5eb3ccdaf",
        "116b678fbfe321b7",
        "216f80809d31ce5f",
        "5aec5d38dcff0ad9",
        "be64e1faabfa3b07",
        "0fb928f60a4eda75",
        "adb3bb1e4f697c81",
        "a04092491765763b",
        "4fd6d452e0eb827b",
        "94fc99c8be47c0f6"
      ],
      motion: { type: "linear", direction: [0, 0, -1], distance: 63 },
      view: [0.417, 0.729, 0.543]
    },
    {
      parent: "sa-prop",
      title: "Plumb the feed lines to thruster A",
      instruction:
        "Fit the feed lines from the tank outlet through the filter and the A valves to thruster A, plus the branch line to the B side. Start every B-nut by hand before tightening any, and torque-stripe each fitting as it is closed.",
      componentNodeIds: [
        "bbfb8c806d1d4dce",
        "8b2bbb51f9b5894e",
        "24b4eb8b8a0e6c39",
        "2444b159dc78075c",
        "3d328a2294acc3c2",
        "bc3574bf2c6fd6c1"
      ],
      tools: [{ item: "TL-TORQUE-J1", quantity: 1 }],
      view: [0.086, -0.978, 0.19],
      blockedBy: ["b83463843b398739", "cb6723c5eb3ccdaf"]
    },
    {
      parent: "sa-prop",
      title: "Plumb the feed lines to thruster B",
      instruction:
        "Fit the B valves line and the thruster B line onto the branch. Start every B-nut by hand, then torque and torque-stripe each fitting.",
      componentNodeIds: ["62130979531caeda", "408777e8ea354f73"],
      tools: [{ item: "TL-TORQUE-J1", quantity: 1 }],
      motion: { type: "linear", direction: [0, 0, -1], distance: 21 },
      view: [0.987, 0, 0.158]
    },
    {
      parent: "sa-prop",
      title: "Fit the two thrusters",
      instruction:
        "Fit both THR-HYDRA-1N thrusters through the deck with their nozzles pointing aft and the heater bands clear of the lines. Check nozzle alignment against the thrust-axis template.",
      componentNodeIds: [
        "21241cd27e344956",
        "f8a0a14dd55df056",
        "3de578b13994acbc",
        "6f1e1cd56913b0f7",
        "d1b3531265a8888e",
        "6c38b62cc494dc22",
        "0683064c0ea33b21",
        "6413be572dd40b2c",
        "f0946162c65bd3fd",
        "914b799e5548732d"
      ],
      view: [0.987, 0, 0.158],
      blockedBy: [
        "62130979531caeda",
        "b83463843b398739",
        "bbfb8c806d1d4dce",
        "cb6723c5eb3ccdaf"
      ]
    },
    {
      parent: "sa-prop",
      title: "Fit fill-drain valves and leak-check",
      instruction:
        "Fit both fill-drain valves with their red caps, then pressurize the system with helium to proof and sniff every joint. Log the decay over 30 minutes; any measurable leak fails the module.",
      componentNodeIds: [
        "390996990d378d9f",
        "9868878aa2e79e8e",
        "e597761bc41994b9",
        "ad5fc1c36c9c7472"
      ],
      motion: { type: "linear", direction: [0, 0, -1], distance: 41 },
      view: [-0.726, 0.665, 0.174]
    },
    {
      key: "sa-prop",
      isSubAssembly: true,
      usedIn: "main-prop",
      title: "Propulsion Module",
      instruction:
        "The leak-checked propulsion module on its deck, ready to drop onto the bottom deck.",
      componentNodeIds: []
    },
    {
      parent: "sa-eps",
      title: "Mount the power tray and battery",
      instruction:
        "Bolt the power tray down, then set the BAT-LIION-48V pack on it with the terminals facing +Y. Check the battery is at storage charge and both terminals are covered before anything else goes near it.",
      componentNodeIds: [
        "13bd964ec5bcb9a5",
        "dc0d65fd2d2e069c",
        "47c1f72d63eb9dff",
        "64b828eb5ff36127",
        "3cd1bcf4f1de85d6",
        "914703f72c905f86",
        "9e8a45a018ece034"
      ],
      view: [-0.472, 0.242, 0.848]
    },
    {
      parent: "sa-eps",
      title: "Fit the EPS board and distribution unit",
      instruction:
        "Mount the PCB-EPS-R1 board on its standoffs and the power distribution unit beside it. Verify the fuse block is fitted and every connector is keyed to its harness label.",
      componentNodeIds: [
        "d06c325b8af5b68a",
        "6e593e280fe51dc2",
        "074ee0f28fe1b6af",
        "2998eefc6ac92474",
        "8e4ad1c040b8a58f",
        "a506aa995ff99a4a",
        "191a7f0d23139157",
        "b6d9f108b8be4c73",
        "013b6218a13a5d60",
        "4e06d313074873e8",
        "ae5cb5e767ef7f6b",
        "a1e038da2f985297",
        "40ed5fee00ae2afe",
        "d21f47da9a09db8f",
        "1d2650666020b9cf",
        "d6c4c4427ca83f10",
        "41d8909005e2ceb0",
        "142f5c4e58093118",
        "fe5e420e0f5ae507",
        "39e949dd55e7ca8a",
        "4d2e6d773f832473",
        "a17b32365e5435f6",
        "bda9227a0cf444a5",
        "ac85b7b1fce4a1dd",
        "84943876fafb6a7f",
        "e9988eee9a8903fe",
        "841ccd9042ba2edb",
        "ef4c7f4c0ab50504"
      ],
      motion: {
        type: "linear",
        direction: [0.0355, -0.122, -0.9919],
        distance: 103.1
      },
      view: [0.003, -0.677, 0.736]
    },
    {
      key: "eps-wings",
      parent: "sa-eps",
      title: "Fit the array drives and the solar wings",
      instruction:
        "Bolt both drive pylons to the tray and fit a solar array drive to each. Bring in the solar array wings and pin each root fitting to its drive shaft; turn each drive through ±90° and confirm the wing follows without binding.",
      componentNodeIds: [
        "35f10fc15ac68b3d",
        "7ec80bc827d1a21d",
        "92aed2b4f9795c34",
        "61a027a1369d2e7e",
        "5b15df61f2fb42d0",
        "2bc11e14158472f2",
        "d036e99005222c16",
        "dbc41bfe5f309699"
      ],
      tools: [{ item: "TL-TORQUE-J1", quantity: 1 }],
      view: [0.126, 0.73, 0.671],
      blockedBy: ["13bd964ec5bcb9a5"]
    },
    {
      parent: "sa-eps",
      title: "Route pigtails and run the insulation test",
      instruction:
        "Route the battery, board and drive pigtails to the distribution unit and tie them down every 10 cm. Megger every power line to chassis at 500 V; anything under 100 MΩ is found and fixed now.",
      componentNodeIds: [
        "bf579fe490e58a65",
        "0c905f71f978959d",
        "9988d5d910bd70a4",
        "a1f5c8d95d3eaf70"
      ],
      view: [0.692, 0.364, 0.623],
      blockedBy: ["13bd964ec5bcb9a5", "35f10fc15ac68b3d", "d06c325b8af5b68a"]
    },
    {
      key: "sa-eps",
      isSubAssembly: true,
      usedIn: "main-eps",
      title: "Power Subsystem",
      instruction:
        "The power tray with battery, EPS electronics, drives and both wings.",
      componentNodeIds: []
    },
    {
      parent: "sa-avionics",
      title: "Mount the avionics deck and card cage",
      instruction:
        "Bolt the card cage to the avionics deck, then slide in the five cards in slot order: flight computer, payload interface, mass memory, power conditioning, telemetry. Seat each card fully in its guides before the next.",
      componentNodeIds: [
        "33dc34f3d2f441a4",
        "363d3ff8b926dbb2",
        "e28a836ed373ea12",
        "bdd9504f1360af4d",
        "ce32d038e25bdece",
        "79df2714f8e46c73",
        "385fb787b63ad070",
        "a58fd3e5d70bc566",
        "dbbb440a124dee50",
        "af981ec364d6efea",
        "cff38df0ea0961fe",
        "25523f3ce5b8c9d1",
        "1953113e4ed934fc",
        "c1189de316ff6b91",
        "8f4f4838c0600027",
        "911a756b844eec2f",
        "9c79d673a648d41a",
        "9254f51e8acaf365",
        "2e5af145e683b514",
        "b2707b26bfa6b9b9",
        "8bad5f7a560d60ed",
        "0af2379e51661eed"
      ],
      view: [-0.472, 0.51, 0.719]
    },
    {
      key: "av-adcs",
      parent: "sa-avionics",
      title: "Integrate the reaction wheel pack",
      instruction:
        "Lower the reaction wheel pack onto the deck over its dowels and bolt it down. Re-measure the alignment cube; if the pack shifted from its bench reading, shim before going on.",
      componentNodeIds: [],
      materials: [{ item: "ADCS-001", quantity: 1 }],
      tools: [{ item: "TL-TORQUE-J1", quantity: 1 }],
      motion: { type: "linear", direction: [0, 0, -1], distance: 148.7 },
      view: [0.175, -0.472, 0.864]
    },
    {
      parent: "sa-avionics",
      title: "Fit the S-band transceiver",
      instruction:
        "Fit the TXRX-SBAND transceiver on top of the card cage with the SMA ports facing +X. Fit 50 Ω loads on all three ports — never power the transmitter into an open port.",
      componentNodeIds: [
        "7b28fb28fd21c28c",
        "9c10988ac90f5eb5",
        "ee2dbd5169aac799",
        "92d603f426f0f4de"
      ],
      materials: [{ item: "COMMS-001", quantity: 1 }],
      motion: {
        type: "linear",
        direction: [0.9911, 0.0004, -0.1331],
        distance: 151.9
      },
      view: [0.282, 0.899, 0.334]
    },
    {
      parent: "sa-avionics",
      title: "Route the wiring harness",
      instruction:
        "Route the five harness runs from the card cage to the wheels, trackers, transceiver and the power trunk, securing them in the tie-down brackets. Keep 25 mm from any moving part and dress the bend radii to the harness drawing.",
      componentNodeIds: [
        "dc351e5b914a5c2e",
        "92e13ab7a825fd46",
        "623e007d288a4460",
        "dd0cb87c5759eb01",
        "631a00772e0d6561",
        "ad4fec7d2d2da685",
        "9dbdc2e0e728297f",
        "84fd00297de09f3e",
        "e2a3b1776abb8001",
        "73c071846e7e1a68",
        "f7549c4bdce5ca7d",
        "aa4af332a469908b"
      ],
      materials: [{ item: "HARNESS-001", quantity: 1 }],
      view: [-0.638, -0.059, 0.768],
      blockedBy: ["1168e3a3989c40f3", "33dc34f3d2f441a4", "7b28fb28fd21c28c"]
    },
    {
      key: "av-continuity",
      parent: "sa-avionics",
      title: "Check continuity end to end",
      instruction:
        "Ring out every harness pin against the wiring list and log the resistance of each power pair. A single open or cross-wire stops the stack here — it will not be reachable once it is inside the bus.",
      componentNodeIds: []
    },
    {
      key: "sa-avionics",
      isSubAssembly: true,
      usedIn: "main-avionics",
      title: "Avionics Stack",
      instruction:
        "The avionics deck with card cage, transceiver, wiring harness and reaction wheel pack.",
      componentNodeIds: []
    },
    {
      title: "Set the adapter ring and bottom deck in the stand",
      instruction:
        "Mount the launch adapter ring in the integration stand and bolt the bottom deck to it. Check the ring's interface flatness at eight points before the deck goes on; the whole spacecraft builds up from this face.",
      componentNodeIds: ["164d11fea159085a", "7125d0306320e9b6"],
      materials: [{ item: "BUS-STR-001", quantity: 1 }],
      tools: [{ item: "TL-TORQUE-J1", quantity: 1 }],
      view: [-0.79, -0.252, 0.559]
    },
    {
      key: "main-prop",
      title: "Integrate the propulsion module",
      instruction:
        "Lower the propulsion module onto the bottom deck, guiding both thruster nozzles through their cut-outs. Bolt the module down and re-check the nozzle alignment from below.",
      componentNodeIds: [],
      materials: [{ item: "PROP-001", quantity: 1 }],
      tools: [{ item: "TL-TORQUE-J1", quantity: 1 }],
      motion: { type: "linear", direction: [0, 0, -1], distance: 341 },
      view: [-0.881, 0.364, 0.302]
    },
    {
      title: "Erect the lower longerons and mid deck",
      instruction:
        "Stand the four lower longerons on their corner brackets and close them with the mid deck. Measure the deck diagonals; they must agree within 0.5 mm before any fastener is torqued.",
      componentNodeIds: [
        "67a5f82269d8581d",
        "4c9222fbaf307298",
        "bc030908e250718b",
        "eadf99ebc527da2b",
        "9f8bae0c5fecb290",
        "0cb0d9baebf59eda",
        "002f76ff49d82c9e",
        "1e53c0347e3e8939",
        "17dfae82317baa0f"
      ],
      tools: [{ item: "TL-TORQUE-J1", quantity: 1 }],
      motion: { type: "linear", direction: [0, 0, -1], distance: 385 },
      view: [-0.472, 0.242, 0.848]
    },
    {
      key: "main-eps",
      title: "Integrate the power subsystem",
      instruction:
        "Bring the power subsystem in with both wings supported on the zero-g rig and set the tray on the -X half of the mid deck. Keep the wings on the rig until the side panels are on.",
      componentNodeIds: [],
      materials: [{ item: "EPS-001", quantity: 1 }],
      tools: [{ item: "TL-TORQUE-J1", quantity: 1 }],
      motion: { type: "linear", direction: [0, 0, -1], distance: 243 },
      view: [0.443, 0.489, 0.752]
    },
    {
      key: "main-avionics",
      title: "Integrate the avionics stack",
      instruction:
        "Set the avionics stack on the +X half of the mid deck and mate the power trunk connector to the distribution unit. Run the first powered-on functional test from the ground support equipment before closing the bus.",
      componentNodeIds: [],
      tools: [{ item: "TL-TORQUE-J1", quantity: 1 }],
      motion: {
        type: "L",
        segments: [
          { direction: [-1, 0, 0], distance: 364.6 },
          { direction: [-0.1712, -0.9831, -0.0646], distance: 205.9 }
        ]
      },
      view: [-0.472, 0.242, 0.848]
    },
    {
      title: "Fit the radiator panels",
      instruction:
        "Fit the +X and -X radiator panels and torque their fasteners in sequence.",
      componentNodeIds: ["ab29696d0216bad7", "bbb339f2235a9709"],
      tools: [{ item: "TL-TORQUE-J1", quantity: 1 }],
      motion: { type: "linear", direction: [0, 0, 1], distance: 335 },
      view: [0.987, 0, 0.158]
    },
    {
      title: "Close out the structure",
      instruction:
        "Fit the upper longerons, then the four side panels — the +X panel over the star tracker baffles and the ±Y panels over the drive shafts — then the top deck with its lifting points. Torque every panel fastener in sequence.",
      componentNodeIds: [
        "19590abf8e429ed2",
        "b0ff644dd7f8b02b",
        "cf710dd012f41034",
        "56726a922c46aa0d",
        "d601479304fed1a0",
        "28eeb516437c7b8a",
        "9ed599506efb83ba",
        "a6309e339c684cef",
        "8faf423c5d0c5803",
        "ac4193e35f417b9a",
        "1fca19defe1f035c",
        "bc21d67d2d92f7ae",
        "c2491962ba32fcbe",
        "a0fb8606a5496575",
        "a01d3c0e02567ff5",
        "879f47745bd7020a",
        "763d1964dc30924a"
      ],
      tools: [{ item: "TL-TORQUE-J1", quantity: 1 }],
      view: [0.987, 0, 0.158],
      blockedBy: [
        "13bd964ec5bcb9a5",
        "164d11fea159085a",
        "33dc34f3d2f441a4",
        "67a5f82269d8581d",
        "ab29696d0216bad7",
        "b83463843b398739"
      ]
    },
    {
      title: "Fit the antennas",
      instruction:
        "Fit both S-band patch antennas and the GPS antenna on the top deck. Sweep each patch with the network analyzer and record return loss at the downlink frequency.",
      componentNodeIds: [
        "5f87215ab0f7a2fc",
        "84122a54b1a0f0e2",
        "015a9b65be1e1188",
        "a471c6617433eb6d",
        "be89f7cc98dbab6f",
        "6e4135874c74c939"
      ],
      tools: [{ item: "TL-PROBE-VNA", quantity: 1 }],
      motion: { type: "linear", direction: [0, 0, -1], distance: 47 },
      view: [0.987, 0, 0.158]
    },
    {
      title: "Fit the MLI blankets",
      instruction:
        "Dress the MLI blankets over the side panels and the aft face, clearing the tracker baffles, drive shafts and thruster nozzles. Ground every blanket to structure and check each ground strap under 10 Ω.",
      componentNodeIds: [
        "c0904b3cb71c8b9d",
        "76768394b697a8a7",
        "5302dcb239a3b734",
        "43ad45874e5d05c8",
        "61762158da474aec"
      ],
      materials: [{ item: "CN-MLI-001", quantity: 1 }],
      view: [-0.726, 0.665, 0.174],
      blockedBy: [
        "13bd964ec5bcb9a5",
        "164d11fea159085a",
        "19590abf8e429ed2",
        "33dc34f3d2f441a4",
        "5f87215ab0f7a2fc",
        "67a5f82269d8581d",
        "ab29696d0216bad7",
        "b83463843b398739"
      ]
    },
    {
      title: "Fit the sun sensors and inspect the finished satellite",
      instruction:
        "Fit the four coarse sun sensors on the top deck edges. Walk the whole spacecraft against the close-out checklist — every fastener witness-marked, every cap and cover logged — and sign the SAT-1000 off.",
      componentNodeIds: [
        "530dfea6e9a57f17",
        "ef8d6f4f7f258570",
        "8f33f9e544d9e9c4",
        "02537541a09a68fc",
        "fa1e07efbc991034",
        "514e149b323864e4",
        "9b0de975af4447d8",
        "ec8c3d8336112dfc"
      ],
      view: [0.987, 0, 0.158],
      blockedBy: [
        "13bd964ec5bcb9a5",
        "164d11fea159085a",
        "19590abf8e429ed2",
        "33dc34f3d2f441a4",
        "5f87215ab0f7a2fc",
        "67a5f82269d8581d",
        "ab29696d0216bad7",
        "c0904b3cb71c8b9d"
      ]
    }
  ],
  componentMappings: [
    // model part "Launch Adapter Ring"
    {
      geometryHash: "31e87a7955fb8829a0368c0b3880f01b3d5d3f40",
      item: "BUS-STR-001"
    },
    // model part "Wing +Y Panel 1 Substrate"
    {
      geometryHash: "d2b48e59c3b8f0aa614477e1db8679e7ea3329b1",
      item: "SAW-001"
    },
    // model part "BAT-LIION-48V Battery Case"
    {
      geometryHash: "46a242cb273279d6a4390a1d8ac02d22f6f73c47",
      item: "BAT-LIION-48V"
    },
    // model part "PCB-EPS-R1 Board"
    {
      geometryHash: "bb383bfaf86608d6f5f7aa9d8bee64b26d191855",
      item: "PCB-EPS-R1"
    },
    // model part "RW1 Housing"
    {
      geometryHash: "b67a6d234668899ed5b0404be4092c9c0d7a5d61",
      item: "RW-010"
    },
    // model part "ST1 Camera Body"
    {
      geometryHash: "cf00e7875c2ac0eff37dc38cc0694bf532a72cd3",
      item: "ST-050"
    },
    // model part "PCB-ADCS-R1 Board"
    {
      geometryHash: "272c3402f2d4e05c0ef620889438fcd7a4028d27",
      item: "PCB-ADCS-R1"
    },
    // model part "TXRX-SBAND Transceiver"
    {
      geometryHash: "c0f8da421d65864174fee1d07bb903057807f26d",
      item: "TXRX-SBAND"
    },
    // model part "Patch 1 Radome"
    {
      geometryHash: "1d545abec1264a8cb026def981ee309cd5eaeab0",
      item: "ANT-PATCH-01"
    },
    // model part "TANK-TI-4L Propellant Tank"
    {
      geometryHash: "a6a914acccd5e72d96fad0013da958d20e849af5",
      item: "TANK-TI-4L"
    },
    // model part "Thruster A Nozzle"
    {
      geometryHash: "f416c054cf546816f2208daa088cc5772268f6bc",
      item: "THR-HYDRA-1N"
    },
    // model part "VLV-SOLENOID-LP Valve 1 Coil"
    {
      geometryHash: "508d4ae23ff0910909346e5fbfbb8fa7ea80a151",
      item: "VLV-SOLENOID-LP"
    },
    // model part "MLI Blanket +Y"
    {
      geometryHash: "fbcd9a2e15c067f7c73f1cb2191b6a37cb79d22b",
      item: "CN-MLI-001"
    }
  ]
};
