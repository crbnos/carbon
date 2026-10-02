// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AssemblySpec } from "../../types.ts";

// Animated 3D work instructions over the bundled servo motor model (an original,
// generated model — see assets/ATTRIBUTION.md). Node ids are graph.json keys from
// that exact file; regenerate them whenever the model is re-baked.
//
// Built as a chain: magnets go onto the rotor core, the core goes onto the shaft
// as the rotor assembly; the wound stator and the terminal box are built on their
// own and join the frame in the main build.
export const motorAssembly: AssemblySpec = {
  model: "servo-motor-9000",
  name: "TD-9000 Servo Motor — Build Sequence",
  item: "MTR-9000",
  componentCount: 150,
  // The Assembly operation of the MTR-9000 method.
  operation: 1,
  motionsBakedFor: "2a9c952d13053ed4",
  steps: [
    {
      parent: "sa-stator",
      title: "Stack the lamination packets and slot liners",
      instruction:
        "Stack the five stator lamination packets on the mandrel with their vent spacers, align the slots with the key bar and fit a Nomex liner in every one of the 36 slots.",
      componentNodeIds: [
        "8a876595c26d2457",
        "6125cde4905c55c9",
        "bebd73e53538edb3",
        "3bc4ba6ec0e5574f",
        "f33a71c45ad91de7",
        "1f72082b87e6e9ab",
        "f678dac9b2e5d69e",
        "422c75a5bab0dded",
        "5383f0a08feba5be",
        "83c250a2008fea5c",
        "1ba4cd681bc45f58",
        "aeeb21d05efca94e",
        "7359167f2ef27b55",
        "4ed10054e110e8ec",
        "f326aa2232412ed4",
        "bc979f6dd376c969",
        "ee089b0bb37744c4",
        "02bcd20268b7dc0b",
        "1cc54f17145f9028",
        "95ed344d76b75de5",
        "8c4c65eaadf0279d",
        "7127c3fc473af10d",
        "5b47d32ba473bd6a",
        "cb56a91388b508c1",
        "cb7d577c3d867278",
        "6fb268df507c2bda",
        "1fa5340c9a575a31",
        "f7aad7f9d192cc01",
        "6890cbc55f2fde8b",
        "22a99195fd2fdf86",
        "2c1ec8c941b29863",
        "00c0b509f0dd4e4f",
        "78d59c19f3536ce7",
        "e9c98d1df60fd9f9",
        "6b94b85660d8fec1",
        "f654cbaaa60e48b6",
        "e4ec0ab9e9be2ce6",
        "d6300288035efac2",
        "66dec721f02d301e",
        "7d3de07cc7dd8913",
        "83c79d7b54e46f77"
      ],
      materials: [{ item: "LAM-STK-STA", quantity: 1 }],
      view: [-0.96, -0.17, 0.222]
    },
    {
      parent: "sa-stator",
      title: "Insert the twelve coils",
      instruction:
        "Insert the twelve pre-wound coils in phase order, shaping each end turn clear of the bore. Surge-test each coil as it goes in; a turn-to-turn fault is cheapest to find now.",
      componentNodeIds: [
        "395f78ef89fe5c12",
        "faf532292d2338a9",
        "c0a8fdd73cc7d97b",
        "0480840dd89aa0b1",
        "134e3dd19a7c4214",
        "4268a0e112dc4d7a",
        "96b8bdd3f4c61ad5",
        "5531949af12595c4",
        "7808dd7387771d18",
        "494fca15c08b0faf",
        "3215466564b2d019",
        "52ce8cb33fe4267e"
      ],
      materials: [{ item: "COIL-9000", quantity: 1 }],
      view: [-0.251, 0.934, 0.254],
      blockedBy: ["8a876595c26d2457"]
    },
    {
      parent: "sa-stator",
      title: "Bring out the phase leads and varnish",
      instruction:
        "Connect the phase groups, bring out the U, V and W leads and dip-and-bake the stator in Class H varnish. Megger each phase to the core at 1000 V after the bake.",
      componentNodeIds: [
        "2b1db8c2e9fd1d1a",
        "3a85a9d9f37ec190",
        "c1da3567af4506df"
      ],
      materials: [{ item: "MAT-VARNISH", quantity: 0.25 }],
      view: [-0.251, 0.934, 0.254],
      blockedBy: ["395f78ef89fe5c12", "8a876595c26d2457"]
    },
    {
      key: "sa-stator",
      isSubAssembly: true,
      usedIn: "main-stator",
      title: "Wound Stator",
      instruction:
        "The varnished, tested stator ready to press into the frame.",
      componentNodeIds: []
    },
    {
      parent: "sa-core",
      title: "Stack the rotor lamination packets",
      instruction:
        "Stack the three rotor lamination packets on the core arbor with the pole marks lined up.",
      componentNodeIds: [
        "b97fd66f4a9e86a6",
        "e5047e36ed7e2c04",
        "2e4b040edf11e26c"
      ],
      materials: [{ item: "LAM-STK-ROT", quantity: 1 }],
      view: [-0.251, 0.934, 0.254]
    },
    {
      parent: "sa-core",
      title: "Bond the 24 magnet segments",
      instruction:
        "Bond the NdFeB segments pole by pole with the magnet epoxy, the middle row skewed half a slot. Check every pole's polarity with the gauss probe before the epoxy skins — a reversed magnet cannot be removed later.",
      componentNodeIds: [
        "eca2bdbce853b6eb",
        "659dac36c785bc4f",
        "4768ab59b1c41a36",
        "538e1cc0922e45ef",
        "580a164ae38f2b86",
        "3455b11095aed2e5",
        "7d95e74f097beed4",
        "bb5bcad455eea963",
        "0bf4fa424e2aa98a",
        "c241672c4c19a205",
        "a334d952462ba9f7",
        "300503374896c053",
        "e15ad0a0b9c83831",
        "6918776d5aca3991",
        "27c4d1947a2c1388",
        "ee44fc5fefc23f5e",
        "73323c78d2b463d2",
        "886ff5fa8053cd2c",
        "932afe3fe1bdae64",
        "5807977938288b99",
        "1ed2a61e30eeb836",
        "40fe2c0dde9565a1",
        "cb92d32d07304df9",
        "797c1593da70a77c"
      ],
      materials: [{ item: "MAG-NDFB-45", quantity: 24 }],
      motion: { type: "linear", direction: [-1, 0, 0], distance: 301 },
      view: [-0.251, 0.934, 0.254]
    },
    {
      parent: "sa-core",
      title: "Fit the retaining bands",
      instruction:
        "Shrink the four stainless retaining bands over the magnet rows and let the epoxy cure to the traveler time.",
      componentNodeIds: [
        "ea63d062941c68f7",
        "e19741d98d31e91c",
        "f2159eb6bce443ca",
        "9cc7ebc3b7c2d082"
      ],
      view: [-0.444, -0.854, 0.27],
      blockedBy: ["b97fd66f4a9e86a6", "eca2bdbce853b6eb"]
    },
    {
      key: "sa-core",
      isSubAssembly: true,
      usedIn: "rotor-core",
      title: "Magnet Rotor Core",
      instruction: "The banded magnet rotor core.",
      componentNodeIds: []
    },
    {
      parent: "sa-rotor",
      title: "Prepare the motor shaft",
      instruction:
        "Check the shaft's bearing seats and runout on the V-blocks, then fit the drive-end key.",
      componentNodeIds: ["cfb605a70ba29973", "9f688a49e72e239c"],
      materials: [{ item: "SHF-9000", quantity: 1 }],
      view: [0.409, -0.635, 0.655]
    },
    {
      key: "rotor-core",
      parent: "sa-rotor",
      title: "Press the rotor core onto the shaft",
      instruction:
        "Heat the magnet rotor core and press it onto the shaft against its shoulder. Keep steel tools away from the magnets — they will jump.",
      componentNodeIds: [],
      tools: [{ item: "TL-ARBOR-PRESS", quantity: 1 }],
      motion: { type: "linear", direction: [-1, 0, 0], distance: 535 },
      view: [-0.118, -0.91, 0.399]
    },
    {
      parent: "sa-rotor",
      title: "Fit the first balance ring",
      instruction: "Fit the first balance ring against its shoulder.",
      componentNodeIds: ["0d1d03c7a76ee130"],
      motion: { type: "linear", direction: [1, 0, 0], distance: 17 },
      view: [-0.251, 0.934, 0.254]
    },
    {
      parent: "sa-rotor",
      title: "Fit and balance the second balance ring",
      instruction:
        "Fit the second balance ring, spin the rotor on the balancing mandrel and drill both rings to G2.5. Record the residual unbalance on the traveler.",
      componentNodeIds: ["f43b1ae3dbb8cc3e"],
      tools: [{ item: "TL-BAL-MANDREL", quantity: 1 }],
      motion: { type: "linear", direction: [-1, 0, 0], distance: 17 },
      view: [0.282, 0.899, 0.334]
    },
    {
      parent: "sa-rotor",
      title: "Press on the non-drive-end bearing",
      instruction:
        "Press the non-drive-end 6308 C3 bearing onto its seat through the inner race only and pack it with high-temperature grease.",
      componentNodeIds: ["9c3f91c00a5666e2", "23ecc83537c0220b"],
      materials: [
        { item: "BRG-6308-C3", quantity: 1 },
        { item: "CN-BRG-GREASE", quantity: 0.125 }
      ],
      tools: [{ item: "TL-ARBOR-PRESS", quantity: 1 }],
      motion: { type: "linear", direction: [1, 0, 0], distance: 82 },
      view: [0.086, -0.978, 0.19]
    },
    {
      parent: "sa-rotor",
      title: "Press on the drive-end bearing",
      instruction:
        "Press the drive-end bearing on the same way and pack it with grease.",
      componentNodeIds: ["b6ddca33f5988b87", "3aa7b59161f100dd"],
      materials: [
        { item: "BRG-6308-C3", quantity: 1 },
        { item: "CN-BRG-GREASE", quantity: 0.125 }
      ],
      tools: [{ item: "TL-ARBOR-PRESS", quantity: 1 }],
      view: [0.086, -0.978, 0.19],
      blockedBy: [
        "0d1d03c7a76ee130",
        "9c3f91c00a5666e2",
        "b97fd66f4a9e86a6",
        "cfb605a70ba29973",
        "f43b1ae3dbb8cc3e"
      ]
    },
    {
      key: "sa-rotor",
      isSubAssembly: true,
      usedIn: "main-rotor",
      title: "Rotor Assembly",
      instruction: "The balanced rotor with bearings fitted.",
      componentNodeIds: []
    },
    {
      parent: "sa-terminal",
      title: "Prepare the terminal box base",
      instruction:
        "Deburr the terminal box base and check its gland thread and gasket face.",
      componentNodeIds: ["0e1599a45ea18d27"],
      view: [0.282, 0.899, 0.334]
    },
    {
      parent: "sa-terminal",
      title: "Fit the six-pole terminal block",
      instruction:
        "Mount the terminal block and fit the six studs with their nuts, labelled U1-V1-W1 and W2-U2-V2.",
      componentNodeIds: [
        "6c69c3a00fcb232b",
        "06890d8f6ea90517",
        "16f6e5c865a6a2d1",
        "be7309aaa458c010",
        "e1f29802a3e2bf45",
        "4166c83341fb726f",
        "5307d0d8ac5fcf9d",
        "2327ad0c2ae45b38",
        "6bf9c18cc4b86dcb",
        "1620ac0f259ca9d4",
        "7484f93a0896c451",
        "798a1b7a29fd6682",
        "4c3d819b7f002b12"
      ],
      materials: [{ item: "TRM-BLK-6P", quantity: 1 }],
      motion: { type: "linear", direction: [0, 0, -1], distance: 41 },
      view: [-0.638, -0.059, 0.768]
    },
    {
      parent: "sa-terminal",
      title: "Fit the gland and lid",
      instruction:
        "Fit the cable gland and the lid on its gasket with the six lid screws.",
      componentNodeIds: [
        "3ab5cc15c9341b0d",
        "f900b0449d83051d",
        "26cf32bd4e320db6",
        "c5e226cd73470b69",
        "fcd58aec32f3828a",
        "20f9e619c676bffa",
        "56db0acc57f25a6d",
        "69068744e2786405"
      ],
      materials: [{ item: "FST-M6-SS", quantity: 6 }],
      motion: {
        type: "linear",
        direction: [-0.0537, 0.1383, -0.9889],
        distance: 119
      },
      view: [0.086, -0.978, 0.19]
    },
    {
      key: "sa-terminal",
      isSubAssembly: true,
      usedIn: "main-terminal",
      title: "Terminal Box",
      instruction: "The terminal box ready to mount on the frame.",
      componentNodeIds: []
    },
    {
      title: "Inspect the motor frame",
      instruction:
        "Set the finned frame on its feet and check the stator bore and both spigot fits with the bore gauge. Log the bore diameter at three depths.",
      componentNodeIds: ["3ecf69d64adbe44e"],
      materials: [{ item: "HSG-9000", quantity: 1 }],
      view: [0.987, 0, 0.158]
    },
    {
      key: "main-stator",
      title: "Press the stator into the frame",
      instruction:
        "Heat the frame to 150 °C and press the wound stator in with the leads toward the terminal box pad. Let it cool on its own — never quench.",
      componentNodeIds: [],
      materials: [{ item: "STA-9000", quantity: 1 }],
      tools: [{ item: "TL-ARBOR-PRESS", quantity: 1 }],
      view: [-0.881, 0.364, 0.302],
      blockedBy: ["3ecf69d64adbe44e"]
    },
    {
      title: "Fit the drive-end bell and seal",
      instruction:
        "Fit the drive-end bell and spigot flange, torque the four bell bolts in a cross pattern and fit the V-ring seal on its boss.",
      componentNodeIds: [
        "560c21c516b9cd97",
        "055ba509d98f1287",
        "239ef5fd8561a5b0",
        "3fd39c2e17927b73",
        "dc56ff278626b510",
        "ce68f0a9a22a9da4",
        "27ea34557d5914a4"
      ],
      motion: {
        type: "linear",
        direction: [-0.9977, -0.0257, -0.0621],
        distance: 124.2
      },
      view: [0.282, 0.899, 0.334]
    },
    {
      key: "main-rotor",
      title: "Insert the rotor",
      instruction:
        "Guide the rotor into the stator bore on the insertion fixture from the non-drive end until the drive-end bearing seats in its bell. The magnets pull hard — keep the fixture guiding until the bearing is home.",
      componentNodeIds: [],
      materials: [{ item: "ROT-9000", quantity: 1 }],
      tools: [{ item: "TL-ARBOR-PRESS", quantity: 1 }],
      view: [0.409, -0.635, 0.655],
      blockedBy: ["3ecf69d64adbe44e", "560c21c516b9cd97", "8a876595c26d2457"]
    },
    {
      title: "Fit the non-drive-end bell and seal",
      instruction:
        "Fit the non-drive-end bell over the rear bearing, torque its four bolts and fit the V-ring seal. Turn the shaft by hand: smooth, with the cogging feel of the magnets and nothing else.",
      componentNodeIds: [
        "2b09d49ab6e49414",
        "0092e2984b842723",
        "2cd853f9229a76f5",
        "20e50bfc0d97fdc6",
        "9a8c56cde57aa605",
        "85f72ddd02385caf"
      ],
      materials: [{ item: "SEAL-VR-45", quantity: 2 }],
      view: [-0.444, -0.854, 0.27],
      blockedBy: [
        "3ecf69d64adbe44e",
        "560c21c516b9cd97",
        "8a876595c26d2457",
        "cfb605a70ba29973"
      ]
    },
    {
      title: "Fit the encoder",
      instruction:
        "Mount the 2048-line encoder on the shaft stub and route its cable to the terminal box pad. Align the encoder index to the rotor pole mark.",
      componentNodeIds: ["86dcf0840a65d653", "eaf27d7841a6225d"],
      materials: [{ item: "ENC-INC-2048", quantity: 1 }],
      view: [-0.96, -0.17, 0.222],
      blockedBy: [
        "2b09d49ab6e49414",
        "3ecf69d64adbe44e",
        "560c21c516b9cd97",
        "8a876595c26d2457",
        "cfb605a70ba29973"
      ]
    },
    {
      title: "Fit the cooling fan and cowl",
      instruction:
        "Mount the axial fan in its frame and fit the cowl over the encoder end.",
      componentNodeIds: [
        "8e4b025f65f27784",
        "f02e0e3e5de50b32",
        "2c113210a83eeb40",
        "d65607ce4be56319",
        "10a3a58143e502fe",
        "7b100e3095188a61",
        "410d238fb23d4f75",
        "4745faddc15c2e02",
        "555cd4170b48037f",
        "e4227e707a3d2910"
      ],
      materials: [{ item: "FAN-AX-160", quantity: 1 }],
      view: [-0.444, -0.854, 0.27],
      blockedBy: [
        "2b09d49ab6e49414",
        "3ecf69d64adbe44e",
        "560c21c516b9cd97",
        "86dcf0840a65d653",
        "8a876595c26d2457",
        "cfb605a70ba29973"
      ]
    },
    {
      key: "main-terminal",
      title: "Fit the terminal box",
      instruction:
        "Bolt the terminal box to its pad and land the phase leads on the terminal block in star.",
      componentNodeIds: [],
      materials: [{ item: "TRM-BOX-9000", quantity: 1 }],
      view: [0.282, 0.899, 0.334],
      blockedBy: [
        "3ecf69d64adbe44e",
        "560c21c516b9cd97",
        "86dcf0840a65d653",
        "8a876595c26d2457",
        "cfb605a70ba29973"
      ]
    },
    {
      title: "Fit the nameplate and lifting eye",
      instruction:
        "Rivet the nameplate to the frame and fit the lifting eye. Stamp the serial and rating after the dyno run confirms them.",
      componentNodeIds: [
        "c043e4b48c3fc4dd",
        "86767e163d24a2c0",
        "4aa1178c740e5973",
        "5b8a3d6338e25668",
        "1e3b6495fc118811",
        "84b601003af3f050",
        "9e5f677e02d9df27"
      ],
      materials: [{ item: "NPL-SS-STD", quantity: 1 }],
      motion: { type: "linear", direction: [0, 0, -1], distance: 269 },
      view: [-0.726, 0.665, 0.174]
    },
    {
      key: "dyno",
      title: "Run the dyno test",
      instruction:
        "Run the no-load, loaded and thermal tests on the dyno and record back-EMF, torque constant and winding temperature rise. Within limits signs the MTR-9000 off.",
      componentNodeIds: []
    }
  ],
  componentMappings: [
    // model part "Motor Frame (Finned)"
    {
      geometryHash: "ddc2980e887fec21db0448dbc97a5d183a0f02a1",
      item: "HSG-9000"
    },
    // model part "SHF-9000 Precision Motor Shaft"
    {
      geometryHash: "8351b3343983f3de73cb14c502434f5988f1d3fa",
      item: "SHF-9000"
    },
    // model part "BRG-6308-C3 Bearing DE Body 1"
    {
      geometryHash: "48cd7d55c1d509e16510df020142de7a17f10f15",
      item: "BRG-6308-C3"
    },
    // model part "ENC-INC-2048 Encoder Body"
    {
      geometryHash: "257e5f9381f1094caac6dad4d2e5afd8c488248c",
      item: "ENC-INC-2048"
    },
    // model part "FAN-AX-160 Fan Frame"
    {
      geometryHash: "7b089f1da6ac5ffaabca18181d92a4655697c35b",
      item: "FAN-AX-160"
    },
    // model part "TRM-BLK-6P Terminal Block"
    {
      geometryHash: "81dc01366a870c6b01b5d31a80b6a842cda60476",
      item: "TRM-BLK-6P"
    },
    // model part "NPL-SS-STD Nameplate"
    {
      geometryHash: "ce69ebb83cd8530516701315ebc901e6544e5477",
      item: "NPL-SS-STD"
    },
    // model part "LAM-STK-STA Lamination Packet 1"
    {
      geometryHash: "ea7ca080c0acde057378e8a2fa3546a6f2c1d395",
      item: "LAM-STK-STA"
    },
    // model part "COIL-9000 Coil 1"
    {
      geometryHash: "59bd6a277653a897d04939cb973a3033ef21757f",
      item: "COIL-9000"
    }
  ]
};
