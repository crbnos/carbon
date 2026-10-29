// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AssemblySpec } from "../../types.ts";

// Animated 3D work instructions over the bundled six-axis arm model (an original,
// generated model — see assets/ATTRIBUTION.md). Node ids are graph.json keys from
// that exact file; regenerate them whenever the model is re-baked.
//
// Built from joint modules: the two joint drives, the wrist and the gripper are
// each built on their own bench; the link assembly uses both joint drives; the
// controller cabinet is used by no step, so it joins the main build where it sits.
export const roboticsAssembly: AssemblySpec = {
  model: "robot-arm-6ax",
  name: "Vertex 10 Six-Axis Arm — Final Assembly",
  item: "ROB-2000",
  componentCount: 161,
  // The Assembly operation of the ROB-2000 method.
  operation: 1,
  motionsBakedFor: "838629b8075c8b90",
  steps: [
    {
      parent: "sa-j2",
      title: "Mate the J2 servo motor to its harmonic gear",
      instruction:
        "Grease the wave generator with EP gear grease, then slide the 750 W motor onto the gear input and pull the flange screws down in a star pattern. Turn the output by hand through one full revolution — it must run smooth with no tight spot.",
      componentNodeIds: ["7ea134ddf5dbf439", "b4d26c5a89d7dbcb"],
      tools: [{ item: "TL-TORQUE-M1", quantity: 1 }],
      view: [0.708, -0.059, 0.703]
    },
    {
      parent: "sa-j2",
      title: "Fit the J2 encoder",
      instruction:
        "Fit the 19-bit absolute encoder on the motor tail. Record the encoder serial against this drive on the traveler.",
      componentNodeIds: ["8cdf90f92ee67d72"],
      motion: { type: "linear", direction: [0, 1, 0], distance: 35 },
      view: [0.819, -0.521, 0.238]
    },
    {
      parent: "sa-j2",
      title: "Fit the J2 connectors",
      instruction:
        "Seat both the power and signal connectors until they click.",
      componentNodeIds: ["3c7e0ff12641e764", "8940621372fa1079"],
      view: [0.987, 0, 0.158],
      blockedBy: ["7ea134ddf5dbf439", "8cdf90f92ee67d72"]
    },
    {
      key: "j2-run-in",
      parent: "sa-j2",
      title: "Run in the J2 drive",
      instruction:
        "Run the drive on the test bench for 20 minutes at 50 % speed in both directions. Log current draw and gear temperature; anything over the traveler limit is stripped and re-greased.",
      componentNodeIds: []
    },
    {
      key: "sa-j2",
      isSubAssembly: true,
      usedIn: "link-j2",
      title: "J2 Joint Drive",
      instruction: "The run-in J2 joint drive module.",
      componentNodeIds: []
    },
    {
      parent: "sa-j3",
      title: "Mate the J3 servo motor to its harmonic gear",
      instruction:
        "Grease the wave generator, slide the motor onto the gear input and torque the flange screws in a star pattern. Turn the output by hand and confirm it runs smooth.",
      componentNodeIds: ["fd91967ada9c3291", "8ae4e80d6b896a33"],
      tools: [{ item: "TL-TORQUE-M1", quantity: 1 }],
      view: [0.987, 0, 0.158]
    },
    {
      parent: "sa-j3",
      title: "Fit the J3 encoder",
      instruction:
        "Fit the absolute encoder. Record the encoder serial against this drive on the traveler.",
      componentNodeIds: ["90d5e3983666448d"],
      motion: { type: "linear", direction: [0, -1, 0], distance: 35 },
      view: [0.696, 0.586, 0.415]
    },
    {
      parent: "sa-j3",
      title: "Fit the J3 connectors",
      instruction:
        "Seat both the power and signal connectors until they click.",
      componentNodeIds: ["e113ff98bf7a5754", "c76264e21b872e06"],
      view: [0.987, 0, 0.158],
      blockedBy: ["90d5e3983666448d", "fd91967ada9c3291"]
    },
    {
      key: "j3-run-in",
      parent: "sa-j3",
      title: "Run in the J3 drive",
      instruction:
        "Run the drive on the bench for 20 minutes at 50 % speed in both directions and log current and gear temperature.",
      componentNodeIds: []
    },
    {
      key: "sa-j3",
      isSubAssembly: true,
      usedIn: "link-j3",
      title: "J3 Joint Drive",
      instruction: "The run-in J3 joint drive module.",
      componentNodeIds: []
    },
    {
      parent: "sa-link",
      title: "Prepare the lower arm and J2 bearing",
      instruction:
        "Press the J2 crossed-roller bearing into the lower arm hub and fit the gravity balancer between its pins. Check the bearing preload with the torque gauge before going on.",
      componentNodeIds: [
        "add3fa1eeb21b6b5",
        "a48482a2e8dca9ba",
        "e78acdb3dc307128",
        "e0f5b390189c8633"
      ],
      tools: [{ item: "TL-TORQUE-M1", quantity: 1 }],
      view: [-0.638, -0.059, 0.768]
    },
    {
      key: "link-j2",
      parent: "sa-link",
      title: "Fit the J2 joint drive",
      instruction:
        "Bring the J2 drive in and bolt it to the lower arm hub through the bearing. Torque the output flange screws to the traveler figure and witness-mark each one.",
      componentNodeIds: [],
      materials: [{ item: "DRV-J2-MOD", quantity: 1 }],
      tools: [{ item: "TL-TORQUE-M1", quantity: 1 }],
      motion: {
        type: "linear",
        direction: [-0.0757, 0.9968, -0.0267],
        distance: 263.7
      },
      view: [0.987, 0, 0.158]
    },
    {
      parent: "sa-link",
      title: "Fit the upper arm and J3 bearing",
      instruction:
        "Press the J3 crossed-roller bearing into the elbow and hang the upper arm on it. Support the upper arm on the stand — it must never hang on the bearing alone.",
      componentNodeIds: ["7878bb3b46561e9f", "977bc291ee7ee4ab"],
      motion: { type: "linear", direction: [0, 1, 0], distance: 112.5 },
      view: [-0.638, -0.059, 0.768]
    },
    {
      key: "link-j3",
      parent: "sa-link",
      title: "Fit the J3 joint drive",
      instruction:
        "Bring the J3 drive in and bolt it through the elbow bearing. Torque and witness-mark the output flange screws.",
      componentNodeIds: [],
      materials: [{ item: "DRV-J2-MOD", quantity: 1 }],
      tools: [{ item: "TL-TORQUE-M1", quantity: 1 }],
      motion: {
        type: "linear",
        direction: [-0.0757, -0.9968, 0.0267],
        distance: 263.7
      },
      view: [0.987, 0, 0.158]
    },
    {
      key: "link-backlash",
      parent: "sa-link",
      title: "Check J2 and J3 backlash",
      instruction:
        "Load each joint to ±20 N·m with the backlash jig and read the lost motion. Anything over 1 arc-minute fails the joint.",
      componentNodeIds: [],
      tools: [{ item: "TL-BACKLASH-J1", quantity: 1 }]
    },
    {
      key: "sa-link",
      isSubAssembly: true,
      usedIn: "main-link",
      title: "Link Assembly",
      instruction:
        "Lower and upper arms with both joint drives, backlash-checked.",
      componentNodeIds: []
    },
    {
      parent: "sa-wrist",
      title: "Build the J4 roll axis",
      instruction:
        "Fit the J4 harmonic gear and both crossed-roller bearings into the roll housing, then mount the J4 motor and encoder on the upper arm side. Turn the roll by hand through ±180°.",
      componentNodeIds: [
        "583544d0404951dd",
        "6dcbff3370a61086",
        "19a85c47c1fdade3",
        "4ab86e341a794d0c",
        "c23bce8c6acd4aa6",
        "9961408deb0ab0df"
      ],
      tools: [{ item: "TL-TORQUE-M1", quantity: 1 }],
      view: [0.086, -0.978, 0.19]
    },
    {
      parent: "sa-wrist",
      title: "Build the J5 pitch axis",
      instruction:
        "Fit the pitch housing over the J4 output with its gear and bearings, then mount the J5 motor and encoder. Check the pitch travel reaches both hard stops without rubbing.",
      componentNodeIds: [
        "d8335237bb4e0ba5",
        "0ce6f70ae6833fbe",
        "8816e522ea095a86",
        "068765cc70838886",
        "bb298a1395fedff4",
        "ca004123979ed06e"
      ],
      tools: [{ item: "TL-TORQUE-M1", quantity: 1 }],
      view: [0.987, 0, 0.158],
      blockedBy: ["583544d0404951dd"]
    },
    {
      parent: "sa-wrist",
      title: "Build the J6 flange axis",
      instruction:
        "Fit the J6 gear, bearings and flange housing. Clock the tool flange so its dowel hole points to J5's zero mark.",
      componentNodeIds: [
        "43a5d0f94af5488c",
        "d6f884d4093c1e4e",
        "650b0bcf91c0a49b",
        "953772f35bb3ef20"
      ],
      tools: [{ item: "TL-TORQUE-M1", quantity: 1 }],
      view: [0.9, 0.329, 0.286],
      blockedBy: ["583544d0404951dd", "d8335237bb4e0ba5"]
    },
    {
      parent: "sa-wrist",
      title: "Fit the J6 motor and encoder",
      instruction:
        "Fit the J6 servo motor and its absolute encoder onto the flange axis.",
      componentNodeIds: ["c56ee02b05a01729", "7110536fdfde9aa3"],
      tools: [{ item: "TL-TORQUE-M1", quantity: 1 }],
      motion: { type: "linear", direction: [0, -1, 0], distance: 113 },
      view: [0.987, 0, 0.158]
    },
    {
      key: "wrist-zero",
      parent: "sa-wrist",
      title: "Zero the wrist encoders",
      instruction:
        "Pin all three wrist axes at their calibration marks and write the encoder zero for J4, J5 and J6. Record the three offsets on the traveler.",
      componentNodeIds: []
    },
    {
      key: "sa-wrist",
      isSubAssembly: true,
      usedIn: "main-wrist",
      title: "Three-Axis Wrist",
      instruction: "The calibrated three-axis wrist.",
      componentNodeIds: []
    },
    {
      parent: "sa-gripper",
      title: "Fit the adapter plate and force-torque sensor",
      instruction:
        "Bolt the tool adapter plate to the sensor's tool side and route the sensor lead through its strain relief. Zero the sensor with nothing attached.",
      componentNodeIds: [
        "37d2d1f3fb557cf6",
        "ee17ae174c1051c2",
        "3d4e2b36015aaccd"
      ],
      view: [0.987, 0, 0.158]
    },
    {
      parent: "sa-gripper",
      title: "Fit the gripper body and motor",
      instruction:
        "Mount the gripper body on the sensor and fit its 200 W motor. Cycle the jaw drive by hand through full stroke.",
      componentNodeIds: ["072400f0732cccb3", "c011ef475a0485c8"],
      motion: { type: "linear", direction: [0, 0, 1], distance: 75 },
      view: [0.086, -0.978, 0.19]
    },
    {
      parent: "sa-gripper",
      title: "Fit the jaws and finger pads",
      instruction:
        "Fit both 80 mm jaws on the guide slot and bond a finger pad to each. Close the jaws on the 40 mm gauge block and check the pads meet square.",
      componentNodeIds: [
        "72262cce2c77d7bf",
        "db6f10a32c46e8ef",
        "b187ff355d306ad2",
        "ad63d4c29c04eeff"
      ],
      materials: [{ item: "GRP-JAW-80", quantity: 2 }],
      view: [0.987, 0, 0.158],
      blockedBy: ["072400f0732cccb3", "37d2d1f3fb557cf6"]
    },
    {
      key: "sa-gripper",
      isSubAssembly: true,
      usedIn: "main-gripper",
      title: "Gripper",
      instruction: "The two-finger gripper with its force-torque sensor.",
      componentNodeIds: []
    },
    {
      title: "Anchor the pedestal",
      instruction:
        "Stand the pedestal on the cell floor, level it to 0.1 mm/m and torque the four anchor bolts. The whole arm's accuracy starts from this plate — re-check level after the bolts are tight.",
      componentNodeIds: [
        "928724e211cae869",
        "be5a0eb677b1b7c7",
        "b2ddea99dfc3249a",
        "7b05c76bdca7249b",
        "da34394def176394",
        "f25aee19d51a53e9",
        "210529bbbbf52553",
        "2498c5996a9dac39",
        "2919267ce1439f18",
        "3ea8d823fcbfce91",
        "324a18a620a02fb2"
      ],
      tools: [{ item: "TL-TORQUE-M1", quantity: 1 }],
      view: [0.086, -0.978, 0.19]
    },
    {
      title: "Mount the J1 base and turret",
      instruction:
        "Lift the base onto the pedestal, bolt it down, then fit the J1 harmonic gear, the J1 motor and encoder and the turret casting. Turn J1 through ±170° and check it runs smooth.",
      componentNodeIds: [
        "50512e9b7dcca4e8",
        "b97ec62b909106fc",
        "a816635386c7346e",
        "d637e15706224dc4",
        "b52d5fa1076eb9cf",
        "bceea71ffa8dc660",
        "126f40e9ced2ab26"
      ],
      materials: [{ item: "ARM-BASE-001", quantity: 1 }],
      tools: [{ item: "TL-TORQUE-M1", quantity: 1 }],
      motion: {
        type: "linear",
        direction: [-0.967, 0.0003, -0.2547],
        distance: 612.4
      },
      view: [0.086, -0.978, 0.19]
    },
    {
      key: "main-link",
      title: "Fit the link assembly",
      instruction:
        "Lift the link assembly onto the turret and bolt the J2 drive output to it. Keep the upper arm on its stand until the brake is released under power.",
      componentNodeIds: [],
      materials: [{ item: "ARM-LINK-001", quantity: 1 }],
      tools: [{ item: "TL-TORQUE-M1", quantity: 1 }],
      view: [-0.041, 0.886, 0.463],
      blockedBy: ["50512e9b7dcca4e8", "928724e211cae869"]
    },
    {
      key: "main-wrist",
      title: "Fit the wrist",
      instruction:
        "Fit the wrist to the end of the upper arm and mate its three motor connectors. Check J4 turns freely before the harness goes on.",
      componentNodeIds: [],
      materials: [{ item: "ARM-WRIST-001", quantity: 1 }],
      tools: [{ item: "TL-TORQUE-M1", quantity: 1 }],
      view: [0.086, -0.978, 0.19],
      blockedBy: ["50512e9b7dcca4e8", "928724e211cae869", "add3fa1eeb21b6b5"]
    },
    {
      title: "Route the arm harness",
      instruction:
        "Route the arm harness from the base connectors over the turret, along the lower arm and over the elbow to the wrist, locking it into each clamp. Leave the wrist service loop long enough for full J4 travel.",
      componentNodeIds: [
        "7926870493a08ada",
        "0731d25d48285ecb",
        "4c0d1803eec78cc0",
        "1f14d642d9464862",
        "6b5e432c8ebdd66c",
        "e43d2278128c3e1c"
      ],
      materials: [{ item: "HRN-ARM-001", quantity: 1 }],
      view: [0.086, -0.978, 0.19],
      blockedBy: [
        "50512e9b7dcca4e8",
        "583544d0404951dd",
        "928724e211cae869",
        "add3fa1eeb21b6b5"
      ]
    },
    {
      key: "main-gripper",
      title: "Fit the gripper",
      instruction:
        "Fit the gripper to the J6 flange on its dowel and plug the sensor and motor leads into the wrist.",
      componentNodeIds: [],
      materials: [{ item: "GRP-2F-80", quantity: 1 }],
      tools: [{ item: "TL-TORQUE-M1", quantity: 1 }],
      motion: {
        type: "linear",
        direction: [-0.0446, -0.0902, 0.9949],
        distance: 243.9
      },
      view: [0.987, 0, 0.158]
    },
    {
      title: "Fit the protective covers",
      instruction:
        "Fit the J2 and J3 motor covers, the turret side cover and the lower arm badge. Every cover screw gets thread-lock.",
      componentNodeIds: [
        "06eae009c0732514",
        "cac14c434d3903c9",
        "d3dd339bd02bdda4",
        "9963cdf40772edfc"
      ],
      materials: [{ item: "CN-COVER-KIT", quantity: 1 }],
      view: [-0.96, -0.17, 0.222],
      blockedBy: [
        "50512e9b7dcca4e8",
        "7926870493a08ada",
        "928724e211cae869",
        "add3fa1eeb21b6b5"
      ]
    },
    {
      parent: "sa-controller",
      title: "Build the cabinet shell",
      instruction:
        "Bolt the cabinet to its plinth, fit the mounting backplate and both DIN rails. Check the backplate is bonded to the cabinet earth stud.",
      componentNodeIds: [
        "7bbf962f870c057b",
        "b7acc2e1fc2fc9cf",
        "3441d5b0bd4b383b",
        "b96ec9d853511411",
        "30bdd49fd48b7067"
      ],
      materials: [{ item: "CTRL-100", quantity: 1 }],
      view: [-0.726, 0.665, 0.174]
    },
    {
      parent: "sa-controller",
      title: "Mount the six servo drives",
      instruction:
        "Mount the six EtherCAT servo drives on the upper rail, J1 to J6 left to right, with 10 mm air gaps between them.",
      componentNodeIds: [
        "65ae055bd5a1e2e8",
        "0b6deb0c36406bef",
        "ab127e80514c7477",
        "908971dff52964ea",
        "a8bde3eab444b71a",
        "b816ac14c7e9372d",
        "91fdb191c797d8ce",
        "46f2a4eb298fbbad",
        "b2dc1e93dd5cfa87",
        "6c65bd4b9bad9b9f",
        "1dab19be020418e2",
        "6dae51284fcc4494",
        "55b265edf45b772d",
        "0f3608236adf068e",
        "6fff208092dcf312",
        "5f577b1fa065af0a",
        "af44028b7c7e448c",
        "f37594c0acd45b3f",
        "4c5f41d457c2b5a5",
        "e56ac057bde01d3d",
        "75f6cb47a1d48d6d",
        "7930b4baac530948",
        "b2d3e935b4c8a01b",
        "4b10d2f860ad1e40"
      ],
      materials: [{ item: "DRV-SRV-400", quantity: 6 }],
      motion: { type: "linear", direction: [-1, 0, 0], distance: 107 },
      view: [0.086, -0.978, 0.19]
    },
    {
      parent: "sa-controller",
      title: "Fit the motion control and safety boards",
      instruction:
        "Mount the motion control board and both safety I/O boards on their standoffs and connect the M23 lines. ESD strap on for this whole step.",
      componentNodeIds: [
        "994a30c3206cec49",
        "4f95bc73346839e0",
        "4040f39947da0da4",
        "d9c42135ad793deb",
        "d556a45e7b70984e",
        "66b9dca0b01a7df9",
        "b5e7398ab92c08f0",
        "65d9b110d97b1996",
        "e22af49019bd0e32",
        "b52605bff7b8d66d",
        "5d50c34de7f23e1d",
        "7582b366cbddf9f0",
        "b8e4fdb0151c8e59",
        "32a4a47b0b5bf8bb",
        "6e31c491118c6a56",
        "5f2878fef43029e4",
        "4d8477d12f9dd0dc",
        "260ea21e7785921d",
        "415388c64b2bc010",
        "524ad620cfacd167",
        "f47692ed85a8ffbf",
        "fd662f44c2ba0611",
        "83dbf0d246a0e7e7",
        "61e3de37246cedd1",
        "704e2270a53e1a81",
        "cc8f36005136baa3",
        "ca9b71c86f4348de",
        "d91b7657fc210ecc",
        "6efcac8c71fc8d88",
        "4838d30086760bc6",
        "08afc8b1a8cb44f7",
        "861a56749a8728e8",
        "d769472e56260666"
      ],
      materials: [
        { item: "PCB-CTRL-R1", quantity: 1 },
        { item: "PCB-IO-R1", quantity: 2 }
      ],
      motion: { type: "linear", direction: [-1, 0, 0], distance: 40 },
      view: [0.535, 0.147, 0.832]
    },
    {
      parent: "sa-controller",
      title: "Fit the terminals and glands",
      instruction:
        "Snap the terminal blocks onto the lower rail and fit the three cable glands. Ring out every terminal against the wiring diagram.",
      componentNodeIds: [
        "73a2f9533f2f9f6f",
        "2357e9d5a0f943fa",
        "6f891f019dff9de7",
        "e5f89545cf637fd5",
        "fd890c4c9bcd0909",
        "288177f56ab52c99",
        "05c0915d952bd153",
        "eabd5b951e971083",
        "321b59030f60a83f",
        "5c75908a80e81370",
        "3d44a397194ace94",
        "72cc8a78848fd346",
        "08bed84e17ad48e2",
        "e65bbdf143660169",
        "32fe754e0b2f7b94",
        "e87d237caaf328d7",
        "aa14ad7ef14b6f8f",
        "ba6677dfabb31c4a",
        "a3d50fd410028115"
      ],
      view: [0.987, 0, 0.158],
      blockedBy: ["65ae055bd5a1e2e8", "7bbf962f870c057b", "994a30c3206cec49"]
    },
    {
      parent: "sa-controller",
      title: "Fit the roof fans",
      instruction: "Fit both roof fans and check they blow out of the cabinet.",
      componentNodeIds: ["d8783d3405961e3c", "beb750c41bd66388"],
      motion: { type: "linear", direction: [0, 0, -1], distance: 55 },
      view: [0.987, 0, 0.158]
    },
    {
      parent: "sa-controller",
      title: "Hang the door and fit the controls",
      instruction:
        "Hang the door, then fit the main switch and the emergency stop. Check the E-stop drops both safety channels before the door is closed.",
      componentNodeIds: [
        "d8cefe8dd024b56b",
        "229f36961ed0730f",
        "803503fda47737a7",
        "95031d594b8485b9",
        "8b39dda548bbdd03"
      ],
      view: [0.987, 0, 0.158],
      blockedBy: [
        "65ae055bd5a1e2e8",
        "73a2f9533f2f9f6f",
        "7bbf962f870c057b",
        "994a30c3206cec49"
      ]
    },
    {
      parent: "sa-controller",
      title: "Fit the status lamp",
      instruction:
        "Fit the status lamp on the cabinet roof and check every colour lights.",
      componentNodeIds: ["7ca9f42baa23c434"],
      motion: { type: "linear", direction: [0, 0, -1], distance: 55 },
      view: [0.987, 0, 0.158]
    },
    {
      key: "sa-controller",
      isSubAssembly: true,
      title: "Controller Cabinet",
      instruction:
        "Set the controller cabinet on its mark beside the arm, 600 mm clear of the arm's reach envelope.",
      componentNodeIds: [],
      motion: {
        type: "linear",
        direction: [-0.2743, -0.1248, -0.9535],
        distance: 1312.2
      },
      view: [-0.726, 0.665, 0.174]
    },
    {
      title: "Connect the umbilical cable",
      instruction:
        "Lay the umbilical cable from the base connectors to the cabinet glands in its floor duct and lock both ends. Never run it where the arm can reach it.",
      componentNodeIds: ["56627698a7095c49"],
      view: [0.086, -0.978, 0.19],
      blockedBy: [
        "06eae009c0732514",
        "50512e9b7dcca4e8",
        "7926870493a08ada",
        "7bbf962f870c057b",
        "928724e211cae869",
        "add3fa1eeb21b6b5"
      ]
    },
    {
      key: "burn-in",
      title: "Run the burn-in and repeatability check",
      instruction:
        "Run the 24-hour burn-in program, then measure pose repeatability at five points with the laser tracker. ±0.03 mm or better signs the ROB-2000 off.",
      componentNodeIds: []
    }
  ],
  componentMappings: [
    // model part "J1 Servo Motor 750W"
    {
      geometryHash: "a713f4e4496e064a294fac2f7c2269b863a41493",
      item: "MOT-AC-750W"
    },
    // model part "J2 Servo Motor 750W"
    {
      geometryHash: "2fb6e33b9efe8c5b0080b089c1a30059ca52342f",
      item: "MOT-AC-750W"
    },
    // model part "J4 Servo Motor 200W"
    {
      geometryHash: "7b41bf009b1b5ebb2ab18fb6c4438606302b818b",
      item: "MOT-AC-200W"
    },
    // model part "J2 Harmonic Gear 80"
    {
      geometryHash: "b862d1baf103ee9be1444de5e5ba6c1dadc04786",
      item: "GBX-HD-80"
    },
    // model part "J2 Absolute Encoder"
    {
      geometryHash: "82fb5d15e05919faa93a0b2a00e9c049c39a871f",
      item: "ENC-ABS-19"
    },
    // model part "J2 Crossed Roller Bearing"
    {
      geometryHash: "c58cf830af8c627629b9513f0a08c2ceb0cfc54f",
      item: "BRG-CRB-100"
    },
    // model part "SNS-FT-6AX Force-Torque Sensor"
    {
      geometryHash: "29b2dac46ae4a0682f82f51a183b41aea72e4bdd",
      item: "SNS-FT-6AX"
    },
    // model part "GRP-JAW-80 Jaw A"
    {
      geometryHash: "144cc0ff01abb2f215afdd1987879b60b72d441d",
      item: "GRP-JAW-80"
    },
    // model part "DRV-SRV-400 Servo Drive 1"
    {
      geometryHash: "16bf0cb24991235735a5bb70eee95318f651cf51",
      item: "DRV-SRV-400"
    },
    // model part "PCB-CTRL-R1 Motion Control Board"
    {
      geometryHash: "ef9be97fa15946ee8ee753a8d0121ccd604b1edf",
      item: "PCB-CTRL-R1"
    }
  ]
};
