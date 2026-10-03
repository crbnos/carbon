// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AssemblySpec } from "../../types.ts";

// Animated 3D work instructions over the bundled hydraulic power unit model (an
// original, generated model — see assets/ATTRIBUTION.md). Node ids are graph.json
// keys from that exact file; regenerate them whenever the model is re-baked.
//
// Built deep: the valve stack goes into the manifold, the manifold and the pump
// cartridge go into one module, and the module goes onto the frame. The actuator
// is built on its own and joins at the frame.
export const precisionAssembly: AssemblySpec = {
  model: "hpu-manifold",
  name: "HPU Manifold Assembly — Build Sequence",
  item: "HMA-4000",
  componentCount: 150,
  // The Assembly operation of the HMA-4000 method.
  operation: 1,
  motionsBakedFor: "ca6c2efcac5780bd",
  steps: [
    {
      parent: "sa-valve",
      title: "Prepare the directional valve body",
      instruction:
        "Clamp the valve body in the soft-jawed vise, blow out every gallery and fit both spool bore plugs with new O-rings. Wet every O-ring with system fluid first — a dry seal rolls on assembly.",
      componentNodeIds: [
        "1d1f08bcf9ecd66a",
        "3baf0a113fbc1545",
        "e8bf8f09529ee566"
      ],
      materials: [{ item: "SEAL-ORING-224", quantity: 6 }],
      tools: [{ item: "TL-VISE-6IN", quantity: 1 }],
      view: [0.086, -0.978, 0.19]
    },
    {
      parent: "sa-valve",
      title: "Fit the springs and end cap on side A",
      instruction:
        "Drop two die springs and their guide rods into the side A spring chamber and close it with its stainless end cap. Pull the cap down evenly so the springs load square.",
      componentNodeIds: [
        "66626e2e97a8d1a1",
        "520cf35511954890",
        "06d7132777dd8d1c",
        "33ad2b144aedd898",
        "5c086d032c5eee4c"
      ],
      materials: [
        { item: "SPR-DIE-25", quantity: 2 },
        { item: "MCH-END-CAP", quantity: 1 }
      ],
      motion: { type: "linear", direction: [1, 0, 0], distance: 72.8 },
      view: [0.086, -0.978, 0.19]
    },
    {
      parent: "sa-valve",
      title: "Fit the springs and end cap on side B",
      instruction:
        "Repeat on side B: two die springs and their guide rods, then the end cap, pulled down evenly.",
      componentNodeIds: [
        "84f998fe7c97aa9d",
        "b6bd5e9f4271efc4",
        "806f19dbc026fb78",
        "c76e273843cd43ea",
        "f36fe73b66970cc4"
      ],
      materials: [
        { item: "SPR-DIE-25", quantity: 2 },
        { item: "MCH-END-CAP", quantity: 1 }
      ],
      motion: { type: "linear", direction: [-1, 0, 0], distance: 72.8 },
      view: [0.595, 0.777, 0.206]
    },
    {
      parent: "sa-valve",
      title: "Fit the clevis pins and override lever",
      instruction:
        "Fit the two clevis pins and the manual override lever. Throw the lever through both positions — it must return to centre on its own.",
      componentNodeIds: [
        "b000e4b31a8b1a68",
        "f0f02e8fe0ce3766",
        "d1a7119000c1de2f"
      ],
      materials: [{ item: "PIN-CLEVIS-12", quantity: 2 }],
      motion: {
        type: "linear",
        direction: [-0.9706, 0, -0.2408],
        distance: 336
      },
      view: [0.086, -0.978, 0.19]
    },
    {
      key: "sa-valve",
      isSubAssembly: true,
      usedIn: "mani-valve",
      title: "Valve Cartridge Stack",
      instruction:
        "The spring-centred directional valve, ready to mount on the manifold.",
      componentNodeIds: []
    },
    {
      parent: "sa-pump",
      title: "Set the pump housing in its fixture",
      instruction:
        "Set the pump housing in the housing fixture with the flange face down. Check both bearing bores with the bore gauge and log the readings.",
      componentNodeIds: ["9b32dfbe7e293f04"],
      materials: [{ item: "MCH-HSG-PUMP", quantity: 1 }],
      tools: [{ item: "TL-FIXT-HSG", quantity: 1 }],
      view: [-0.726, 0.665, 0.174]
    },
    {
      parent: "sa-pump",
      title: "Press in the bearings",
      instruction:
        "Press both 6205 ball bearings and both needle bearings into the housing, pushing only on the outer race. A bearing pressed through its inner race is scrap.",
      componentNodeIds: [
        "cb03e7101d7ccf91",
        "8e625fd855c333a6",
        "92cbe62fc4a6c592",
        "54eeb1b30d57d83f"
      ],
      materials: [
        { item: "BRG-DBL-6205", quantity: 2 },
        { item: "BRG-NDL-HK1512", quantity: 2 }
      ],
      tools: [{ item: "TL-FIXT-HSG", quantity: 1 }],
      view: [0.9, 0.329, 0.286],
      blockedBy: ["9b32dfbe7e293f04"]
    },
    {
      parent: "sa-pump",
      title: "Fit the drive shaft, seal and dowels",
      instruction:
        "Slide the drive shaft through the bearings, fit the shaft seal and key, then the two dowel pins and flange bolts. Turn the shaft by hand — smooth, with no end float you can feel.",
      componentNodeIds: [
        "391cd37678e10150",
        "ad4427666628ea86",
        "10d868b1f3e32d41",
        "675d7e34a980b77c",
        "593f1581d7b00083",
        "aedb8c3986488e14",
        "e0f2107c079de64f",
        "52aa299aed721027",
        "f0f0d669f65540e2",
        "ec15cf4f8505b2d6",
        "08c0bf095f4a7d01"
      ],
      materials: [{ item: "MCH-SHAFT-DR", quantity: 1 }],
      view: [0.402, -0.859, 0.318],
      blockedBy: ["9b32dfbe7e293f04", "cb03e7101d7ccf91"]
    },
    {
      key: "sa-pump",
      isSubAssembly: true,
      usedIn: "module-join",
      title: "Pump Cartridge",
      instruction: "The pump housing with bearings and drive shaft.",
      componentNodeIds: []
    },
    {
      parent: "sa-manifold",
      title: "Set the manifold block on its spacers",
      instruction:
        "Stand the manifold block on its four precision spacers and fit the threaded inserts in the +Y ports. Check every insert sits flush.",
      componentNodeIds: [
        "c8f5fd761fd651b7",
        "15f7ab4da0611919",
        "9e59c66f13ce7d17",
        "a6ed6918f10cdc3b",
        "b78ba29046c12710",
        "f35565842772befe",
        "2fb826f294b6a264",
        "47e5781523539c2b"
      ],
      materials: [
        { item: "MCH-MANI-BLK", quantity: 1 },
        { item: "MCH-SPACER-KIT", quantity: 1 }
      ],
      tools: [{ item: "TL-VISE-6IN", quantity: 1 }],
      view: [0.086, -0.978, 0.19]
    },
    {
      parent: "sa-manifold",
      title: "Fit the gauge and relief valve",
      instruction:
        "Fit the pressure gauge and the relief valve cartridge. Set the relief valve fully open for now.",
      componentNodeIds: [
        "2e81fe70b14fd4cb",
        "9a473295139efc59",
        "a7dd7bddd81f57a9"
      ],
      motion: {
        type: "linear",
        direction: [0.8532, 0.1068, 0.5105],
        distance: 217.4
      },
      view: [0.086, -0.978, 0.19]
    },
    {
      parent: "sa-manifold",
      title: "Fit the flanges and plugs",
      instruction:
        "Bolt both mounting flanges to the +X ports and plug the unused ports.",
      componentNodeIds: [
        "960d93fff94936a1",
        "939e9d833fd55e8d",
        "9be49a3db9e099e7",
        "bc6a7304da89cfd5",
        "fdfd9edcd9eeab49",
        "1cc5975543d9b3a4",
        "000ecce869d547e6",
        "f61e0a956b26ec54",
        "3da223e1dbceef1d",
        "1ea1fbb95d73fd23",
        "b26f0871e2c43bb8",
        "19a67ac20589d526"
      ],
      materials: [{ item: "MCH-FLANGE-SS", quantity: 2 }],
      view: [-0.726, 0.665, 0.174],
      blockedBy: ["2e81fe70b14fd4cb", "c8f5fd761fd651b7"]
    },
    {
      key: "mani-valve",
      parent: "sa-manifold",
      title: "Mount the valve cartridge stack",
      instruction:
        "Mount the valve stack on the manifold top face over its four O-rings and torque the mounting bolts in a cross pattern.",
      componentNodeIds: [],
      materials: [{ item: "ASM-VALVE-SUB", quantity: 1 }],
      motion: { type: "linear", direction: [0, 0, -1], distance: 180 },
      view: [0.086, -0.978, 0.19]
    },
    {
      key: "sa-manifold",
      isSubAssembly: true,
      usedIn: "module-join",
      title: "Manifold Assembly",
      instruction: "The manifold with its valve stack, flanges and gauge.",
      componentNodeIds: []
    },
    {
      parent: "sa-module",
      title: "Prepare the module adapter plate",
      instruction:
        "Bolt down the adapter plate and fit its two lifting eyes. Check the plate is flat to 0.05 mm under the manifold footprint.",
      componentNodeIds: [
        "783593e9237c44b4",
        "2d31312a9b19e1ca",
        "69b762e5916be9b6",
        "92792cce19197729",
        "7c7d8ad3ff796dc4",
        "8d4dfc19d1a5dc43",
        "12da37fe70f19805",
        "dccf63513ec08b98",
        "9d1c4786f1c97b15"
      ],
      view: [-0.118, -0.91, 0.399]
    },
    {
      key: "module-join",
      parent: "sa-module",
      title: "Mount the manifold and pump together",
      instruction:
        "Set the manifold assembly on the adapter plate, then offer the pump cartridge up to the manifold's -X face on its dowels and bolt it home. Both come in on this one step — the pump flange locates on the manifold, not the plate.",
      componentNodeIds: [],
      motion: {
        type: "linear",
        direction: [-0.9922, 0.0008, -0.1247],
        distance: 590
      },
      view: [-0.531, 0.756, 0.383]
    },
    {
      key: "module-leak",
      parent: "sa-module",
      title: "Leak-check the module",
      instruction:
        "Plug the ports, pressurise the module to 50 bar with the bench pump and hold for 10 minutes. No drop on the gauge and no weep at any joint.",
      componentNodeIds: []
    },
    {
      key: "sa-module",
      isSubAssembly: true,
      usedIn: "main-module",
      title: "Pump & Manifold Module",
      instruction: "The leak-checked pump and manifold on their adapter plate.",
      componentNodeIds: []
    },
    {
      parent: "sa-actuator",
      title: "Assemble the barrel and piston rod",
      instruction:
        "Slide the chromed piston rod into the barrel and fit both bronze bushings in the gland. Protect the chrome — a scratch on the rod is a leak path.",
      componentNodeIds: [
        "c347cff89b24ab60",
        "cd355d9b528398d3",
        "9c5c1da6f7c4f943",
        "0bb3a3bd3f298764"
      ],
      materials: [
        { item: "MCH-PISTON-ROD", quantity: 1 },
        { item: "BSH-BRZ-2012", quantity: 2 }
      ],
      view: [0.086, -0.978, 0.19]
    },
    {
      parent: "sa-actuator",
      title: "Fit the end blocks and tie rods",
      instruction:
        "Fit the head and cap blocks, run the four tie rods through and tighten the nuts in a cross pattern in three passes. Fit both port adapters.",
      componentNodeIds: [
        "7718b910805ad12c",
        "13ecef8f1cb30ad2",
        "096feda4e14bf922",
        "a0505fc20ac84258",
        "38fb6cb277079106",
        "17f92474c8aed592",
        "6629c8cbaadef56c",
        "9b622164a042b054",
        "cb98effe0797d297",
        "b7e73a58591d96aa",
        "1ed857284199c239",
        "08d219d853a66376",
        "0bb2b75b743bb682",
        "7464cf4f5e3621f5",
        "18be4f5c514950ba",
        "afdcdc00dba6f662"
      ],
      tools: [{ item: "TL-VISE-6IN", quantity: 1 }],
      view: [0.282, 0.899, 0.334],
      blockedBy: ["c347cff89b24ab60"]
    },
    {
      parent: "sa-actuator",
      title: "Fit the rear clevis",
      instruction: "Fit the rear clevis mount to the cap end.",
      componentNodeIds: ["5dac4429fcdddca7"],
      view: [-0.251, 0.934, 0.254],
      blockedBy: ["7718b910805ad12c", "c347cff89b24ab60"]
    },
    {
      parent: "sa-actuator",
      title: "Fit the rod eye",
      instruction:
        "Thread the rod eye onto the piston rod and lock it. Stroke the cylinder by hand end to end.",
      componentNodeIds: ["e05e8f557bed18e4"],
      motion: { type: "linear", direction: [-1, 0, 0], distance: 89 },
      view: [0.086, -0.978, 0.19]
    },
    {
      key: "sa-actuator",
      isSubAssembly: true,
      usedIn: "main-actuator",
      title: "Actuator",
      instruction: "The assembled hydraulic cylinder.",
      componentNodeIds: []
    },
    {
      title: "Level the welded base frame",
      instruction:
        "Set the base frame on its levelling feet and level the drip tray to 1 mm over its length. Check every weld seam on the tray for pinholes with dye penetrant.",
      componentNodeIds: [
        "798ad50ef9b4afce",
        "adc3aee26016e562",
        "024b43a689759644",
        "4e9e56d7ceaaca27",
        "15c2f553d3c5b69a",
        "524839a10043864b",
        "f6044c750688eb43",
        "c7dda79ce0ff749b",
        "501c03b10cbf2e26",
        "9a8c9a70e9e12ffa",
        "72cbb0183e30fc9b",
        "0950f17543d743af",
        "e34888acaac8490e",
        "ceb3faf27373885b",
        "0c5c9a7a7cf1ff92",
        "3594d09ab2e50f43",
        "f19047ac269ff869",
        "18ad2340ca69243f"
      ],
      materials: [{ item: "FAB-BASE-WLD", quantity: 1 }],
      view: [0.819, -0.521, 0.238]
    },
    {
      key: "main-module",
      title: "Fit the pump & manifold module",
      instruction:
        "Lift the module by its two eyes onto the drip tray and bolt it down. Keep the shaft end pointing to the -X end of the frame, where the guard goes.",
      componentNodeIds: [],
      motion: {
        type: "linear",
        direction: [-0.9883, 0.0136, -0.1517],
        distance: 664.9
      },
      view: [-0.118, -0.91, 0.399]
    },
    {
      key: "main-actuator",
      title: "Fit the actuator on its supports",
      instruction:
        "Bolt both cylinder supports to the tray, then lay the actuator in them with the ports up and clamp it.",
      componentNodeIds: [
        "71bd4ec608ade549",
        "1dcec20efa21c22e",
        "1874bbb1df8646e1",
        "8117e6083058d735",
        "6e229c6ec46918cc",
        "0aa55d9c4e23c385",
        "5a60c07ec7101591",
        "5b8ce86f8a8ba7d0",
        "f27c436dd9e07340",
        "21bee4a93f2b8e38"
      ],
      materials: [{ item: "CYL-HYD-40", quantity: 1 }],
      view: [-0.311, 0.744, 0.591],
      blockedBy: ["783593e9237c44b4", "798ad50ef9b4afce"]
    },
    {
      title: "Run the hoses and return line",
      instruction:
        "Run both pressure hoses from the manifold flanges to the cylinder ports and the return line to the tray fitting. No hose may twist or rub on the frame; crimp ends torqued to the chart.",
      componentNodeIds: [
        "ba4e4f246b739ead",
        "1165a7196fec1ab7",
        "ff9e9737f2bad9e2",
        "a1bb4ec084b80adc",
        "85ec65924331ede8",
        "2382097172e565d9",
        "2f04771e9864acc3",
        "9142d018a863aaa0",
        "c36a0bbf552fdfae"
      ],
      view: [0.086, -0.978, 0.19],
      blockedBy: ["71bd4ec608ade549", "783593e9237c44b4", "798ad50ef9b4afce"]
    },
    {
      title: "Fit the enclosure panels and shaft guard",
      instruction:
        "Fit both louvred side panels, both end panels and the yellow shaft guard, and run in every panel screw.",
      componentNodeIds: [
        "4115dc01285dc868",
        "eb2b42c00400f9ab",
        "8895ca8674365f79",
        "246d57905028acb6",
        "231048fa96db5d68",
        "1563983595e1fcb8",
        "b314cec6094d1ea9",
        "7f48682b006607e9",
        "2a63534b8708c8dd",
        "4268358dac0a8ce3",
        "95a79fbe3bbf5b16",
        "1d6561c6521a9cb0",
        "c0add284c6dd7f8b",
        "8c5f969bc9627850",
        "01e56f6f17e2c598",
        "2dc8f30abf60e99b",
        "7458284989801d9b",
        "a57c15d3992d1415",
        "aac5f36083333e76",
        "5169f2749ce35d3e",
        "9d9ad5dcbd4a372a",
        "146218cabfbdec87"
      ],
      materials: [{ item: "FAB-ENCL-PNL", quantity: 1 }],
      view: [0.086, -0.978, 0.19],
      blockedBy: [
        "71bd4ec608ade549",
        "783593e9237c44b4",
        "798ad50ef9b4afce",
        "ba4e4f246b739ead"
      ]
    },
    {
      title: "Proof-test at 1.5× rated pressure",
      instruction:
        "Fit the test-point couplings, fill the system and hold 1.5× rated pressure for 15 minutes. Log the hold, fit the drain valve and nameplate, and sign the HMA-4000 off.",
      componentNodeIds: [
        "201874b44c9b8e1f",
        "d58b30d690557d1c",
        "397c3ace8a2ab116",
        "69abd5e67cd7fefa",
        "d262a42f629517df"
      ],
      view: [0.987, 0, 0.158],
      blockedBy: [
        "4115dc01285dc868",
        "71bd4ec608ade549",
        "783593e9237c44b4",
        "798ad50ef9b4afce",
        "ba4e4f246b739ead"
      ]
    }
  ],
  componentMappings: [
    // model part "Manifold Block 6061"
    {
      geometryHash: "13f90e4a25b094229cc1a3e0c65b31d64c73edd7",
      item: "MCH-MANI-BLK"
    },
    // model part "Pump Housing 6061"
    {
      geometryHash: "99ee082cda9baf5d0c8e498ff607cab5753c088c",
      item: "MCH-HSG-PUMP"
    },
    // model part "MCH-SHAFT-DR Drive Shaft 4140"
    {
      geometryHash: "f3f77a47deb9bbb9693bc1e20aceede6335423c5",
      item: "MCH-SHAFT-DR"
    },
    // model part "MCH-PISTON-ROD Piston Rod Hard Chrome"
    {
      geometryHash: "eff4c2d879216672546c99783861c57433c51c20",
      item: "MCH-PISTON-ROD"
    },
    // model part "BRG-DBL-6205 Ball Bearing 1"
    {
      geometryHash: "ab79d57855e501c662373d311c798604d0320fec",
      item: "BRG-DBL-6205"
    },
    // model part "MCH-END-CAP End Cap A"
    {
      geometryHash: "52bbfae10b6c1fb2b6f940085efaea8c869974d7",
      item: "MCH-END-CAP"
    },
    // model part "MCH-FLANGE-SS Mounting Flange 1"
    {
      geometryHash: "7a0b494d8419b493b74b0007cc68dfa20bd8b43d",
      item: "MCH-FLANGE-SS"
    },
    // model part "Stainless Drip Tray"
    {
      geometryHash: "94198a18be43b4313fbdf3433ffeb148db05341a",
      item: "FAB-BASE-WLD"
    },
    // model part "Side Panel 1"
    {
      geometryHash: "b4aa9414f66c3bf800f51a2afc3a0dfef62b54ff",
      item: "FAB-ENCL-PNL"
    }
  ]
};
