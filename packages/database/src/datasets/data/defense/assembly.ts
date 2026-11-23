// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AssemblySpec } from "../../types.ts";

// Animated 3D work instructions over the bundled ISR-4 model (an original,
// generated model — see assets/ATTRIBUTION.md). Node ids are graph.json keys from
// that exact file, written by plans/quad-model/gen_assembly.py; regenerate them
// whenever the model is re-baked.
//
// The build is four sub-assemblies made on their own benches (propulsion pods,
// avionics bay, EO/IR gimbal, landing gear), one parent sub-assembly that uses
// the pods (the arm set), and the main integration that brings everything into
// the finished ISR4-AV. Members sit directly before their header; `usedIn`
// names the step that fits the finished unit. No motion is baked: the player
// synthesizes each insert path.
export const defenseAssembly: AssemblySpec = {
  model: "isr4-quad",
  name: "ISR-4 Air Vehicle — Integration Sequence",
  item: "ISR4-AV",
  componentCount: 139,
  // The Assembly operation of the ISR4-AV method.
  operation: 1,
  steps: [
    {
      parent: "sa-pods",
      title: "Seat the four motor stator bases",
      instruction:
        "Seat a stator base on each motor mount pad and torque the four M3 screws in a cross pattern. Witness-mark every screw head.",
      componentNodeIds: [
        "9d24866f2eec73ab",
        "00b5eb11876c6cf2",
        "ad0fa8835846de1f",
        "06f644c352ddd14f"
      ],
      tools: [
        {
          item: "TL-TORQUE-J1",
          quantity: 1
        }
      ]
    },
    {
      parent: "sa-pods",
      title: "Fit the motor bells",
      instruction:
        "Slide each bell over its stator and check it spins free by hand with no rub. Fit CW bells on the front-left and rear-right pods, CCW on the other two.",
      componentNodeIds: [
        "084a716b97b44ee2",
        "a6b6e1daa4279883",
        "1bfc7a6d29abf506",
        "5eec153a16c79da9"
      ]
    },
    {
      parent: "sa-pods",
      title: "Fit the motor caps",
      instruction:
        "Press a cap onto each bell and set its retaining screw with medium-strength threadlocker.",
      componentNodeIds: [
        "4e36e22ffbdcb1a2",
        "d02158c5b204ac9d",
        "61561bfb43af1347",
        "36912de215bbf24d"
      ],
      materials: [
        {
          item: "CN-THREADLOCK",
          quantity: 0.25
        }
      ]
    },
    {
      key: "pods-runin",
      parent: "sa-pods",
      title: "Run in the motors",
      instruction:
        "Run each motor on the test stand at 30%, 60% and 90% throttle for two minutes each. Record current and vibration per motor; a motor outside the band on the traveler is replaced before the pods leave the bench.",
      componentNodeIds: []
    },
    {
      key: "sa-pods",
      isSubAssembly: true,
      usedIn: "arms-pods",
      title: "Propulsion Pods",
      instruction:
        "Four motor pods, run in and logged, ready to fit to the arms.",
      componentNodeIds: []
    },
    {
      parent: "sa-arms",
      title: "Fit the fold hinges and pins",
      instruction:
        "Bolt a hinge block to each frame-plate lobe and drive the hinge pin home. Fold each arm through its full travel once and check the detent clicks at both ends.",
      componentNodeIds: [
        "ff7b2844cdf8bf08",
        "7c3d1aa1260f15f8",
        "bbbaee8d3728da02",
        "7aaabd3cfdafa817",
        "d1a80d01cbab42ac",
        "d7a8af6753d25988",
        "4eb1c135e85c86b2",
        "9d79575b24cfbeaa"
      ],
      tools: [
        {
          item: "TL-TORQUE-J1",
          quantity: 1
        }
      ]
    },
    {
      parent: "sa-arms",
      title: "Fit the carbon arms",
      instruction:
        "Slide each carbon arm into its hinge socket to the depth mark and bond it with the arm adhesive. Keep the arms clamped flat on the fixture until the cure time on the traveler.",
      componentNodeIds: [
        "8c692dfe6be60ca9",
        "110b2f03330e6a1d",
        "bcde3e78cd84c812",
        "e821e45bcb8ccec7"
      ]
    },
    {
      parent: "sa-arms",
      title: "Fit the motor mounts and navigation lights",
      instruction:
        "Clamp a motor mount on each arm tip and fit its navigation light: red front-left, green front-right, white on both rear arms.",
      componentNodeIds: [
        "01f48d325ed18484",
        "c70562dc46307629",
        "0b83fbe663a1cd39",
        "f7ed85bdf9da41f1",
        "9dd679a0110b879b",
        "0be57b0c39dd47c5",
        "3baa87bc6a406cf2",
        "d147d144c02cedc1"
      ],
      tools: [
        {
          item: "TL-TORQUE-J1",
          quantity: 1
        }
      ]
    },
    {
      key: "arms-pods",
      parent: "sa-arms",
      title: "Fit the propulsion pods and lock knobs",
      instruction:
        "Seat a propulsion pod on each motor mount and connect its three phase leads. Fit the coyote lock knobs and confirm each arm locks open.",
      componentNodeIds: [
        "06ce1bfb030e4030",
        "b9f2d74bff8b0dbb",
        "8b4daa5fd27b7765",
        "cd2bef0924be88a6"
      ]
    },
    {
      key: "sa-arms",
      isSubAssembly: true,
      usedIn: "main-arms",
      title: "Arm Set",
      instruction:
        "Four folding arms with motors, locked and continuity-checked, ready to fit to the frame.",
      componentNodeIds: []
    },
    {
      parent: "sa-avionics",
      title: "Mount the power distribution board",
      instruction:
        "Fit the four standoffs and mount the power distribution board. Check the board serial against the traveler before the first screw goes in.",
      componentNodeIds: [
        "73dd1c5328319a2e",
        "4afd47c49654effb",
        "c3834573ad492048",
        "2781e096de901e36",
        "28f4d825ec371f57",
        "3d5b7f4888faedd1",
        "a109ed2c44b47153",
        "6d28d29fe98e8c7b"
      ]
    },
    {
      parent: "sa-avionics",
      title: "Fit the four motor controllers",
      instruction:
        "Fit one motor controller on each diagonal, connector facing outboard. Record each controller serial against its arm position (FL, FR, RL, RR).",
      componentNodeIds: [
        "3db767e1494f03d7",
        "c7a7f7cd1b4a1859",
        "cae8abf7c9f152c0",
        "2740c647a5e160bc"
      ]
    },
    {
      parent: "sa-avionics",
      title: "Fit the flight controller and mission computer",
      instruction:
        "Mount the flight controller on its isolators with the arrow pointing forward. Fit the mission computer behind it and connect the Ethernet and UART links.",
      componentNodeIds: ["cdeae58513e5f8b1", "ac3e66c4cfaf59ba"]
    },
    {
      parent: "sa-avionics",
      title: "Fit the datalink and C2 radios",
      instruction:
        "Fit the mesh datalink radio and the C2 telemetry radio. Torque the SMA connectors to the value on the traveler and cap any unused port.",
      componentNodeIds: [
        "0d1be8d8833b54d0",
        "e51ed4254eba56b5",
        "05efe9b102c56bcb",
        "a48dc5c6f01c473c"
      ]
    },
    {
      key: "av-test",
      parent: "sa-avionics",
      title: "Bench-test the avionics bay",
      instruction:
        "Power the bay from the bench supply and run the hardware-in-the-loop script. Load the released firmware and record its version and checksum on the traveler.",
      componentNodeIds: []
    },
    {
      key: "sa-avionics",
      isSubAssembly: true,
      usedIn: "main-avionics",
      title: "Avionics Bay",
      instruction:
        "The avionics bay, tested in the loop with released firmware, ready to integrate.",
      componentNodeIds: []
    },
    {
      parent: "sa-gimbal",
      title: "Fit the dovetail slide and dampers",
      instruction:
        "Fit the four vibration dampers between the dovetail slide and the damper plate. Check each damper seats fully in its cup.",
      componentNodeIds: [
        "3d604815b7adcfa2",
        "c14e0fdfc444102c",
        "cb66a20eec793e9c",
        "fd203937314690b2",
        "0a2bc9c1c2f5dff4",
        "8f396f2f302e4ba5"
      ]
    },
    {
      parent: "sa-gimbal",
      title: "Fit the pan motor, yoke and tilt motors",
      instruction:
        "Bolt the pan motor to the damper plate, hang the yoke and fit both tilt motors. Rotate the yoke through its full pan travel with no cable snag.",
      componentNodeIds: [
        "4b19151c65fed3f2",
        "ffaf1e10cc21fb81",
        "dcd9367c8c1f32b3",
        "eb6f5b6095d3362a"
      ]
    },
    {
      parent: "sa-gimbal",
      title: "Fit the sensor ball and lenses",
      instruction:
        "Seat the sensor ball in the yoke and fit the EO zoom lens, thermal lens and laser rangefinder window. Leave the lens covers on.",
      componentNodeIds: [
        "70a237f540d271b4",
        "567c540465041689",
        "9bcd265ba4076771",
        "fcd28dac79440ee6",
        "df7e9a0d62b609a0",
        "c199f0cda221b63b",
        "a4b37e031c8b7b2a"
      ]
    },
    {
      key: "gim-boresight",
      parent: "sa-gimbal",
      title: "Boresight the payload",
      instruction:
        "Mount the gimbal on the boresight fixture and align the EO, thermal and laser axes to the target board. Record the residual offsets on the traveler.",
      componentNodeIds: []
    },
    {
      key: "sa-gimbal",
      isSubAssembly: true,
      usedIn: "main-gimbal",
      title: "EO/IR Gimbal",
      instruction:
        "The EO/IR gimbal on its quick-release slide, boresighted, ready to fit.",
      componentNodeIds: []
    },
    {
      parent: "sa-gear",
      title: "Fit the strut brackets and struts",
      instruction:
        "Bolt the four strut brackets to the gear fixture and bond a carbon strut into each.",
      componentNodeIds: [
        "70c067aea0a6df77",
        "f341f7a0959f9660",
        "b5f055e3bdca5151",
        "75fed46eb7aa91d4",
        "072607dfd4fcd28e",
        "160eb210bc889350",
        "b9d1b9783564bd8a",
        "e9c98937b92ba3b2"
      ]
    },
    {
      parent: "sa-gear",
      title: "Fit the skids and end caps",
      instruction:
        "Fit both skid tubes to the struts and press the rubber caps onto the skid ends.",
      componentNodeIds: [
        "a298524a22ea1b2c",
        "ce400a18d5bd0ca8",
        "8211d7a9093fbee2",
        "0fab067886d65256",
        "e07e261dee31319e",
        "b3e30222147ccd68"
      ]
    },
    {
      key: "sa-gear",
      isSubAssembly: true,
      usedIn: "main-gear",
      title: "Landing Gear",
      instruction:
        "The landing gear, squared on the fixture, ready to fit under the frame plate.",
      componentNodeIds: []
    },
    {
      title: "Set the frame plate in the build stand",
      instruction:
        "Clamp the frame plate in the build stand, nose toward the operator. Confirm the airframe serial against the traveler.",
      componentNodeIds: ["a3ec1e7cf048c219"]
    },
    {
      key: "main-arms",
      title: "Fit the arm set",
      instruction:
        "Bolt the arm set hinge blocks to the frame plate lobes and torque the fasteners in a cross pattern.",
      componentNodeIds: [],
      tools: [
        {
          item: "TL-TORQUE-J1",
          quantity: 1
        }
      ]
    },
    {
      key: "main-avionics",
      title: "Integrate the avionics bay",
      instruction:
        "Lower the avionics bay onto the frame plate isolators and route the four motor leads to their controllers.",
      componentNodeIds: []
    },
    {
      title: "Fit the GPS-denied navigation kit",
      instruction:
        "Fit the optical-flow camera and the lidar altimeter under the rear of the frame plate, windows facing down. Keep the lens covers on.",
      componentNodeIds: [
        "8bd70ffcd0a18efe",
        "71e326cd96da614e",
        "59d241dc80957eb9",
        "fb05f946566388af",
        "b4c601a033e5edfb"
      ]
    },
    {
      title: "Fit the lower hull, data plate and data module",
      instruction:
        "Fit the lower hull. Rivet the IUID data plate on the left side and fit the encrypted data module on the right side. Record the data plate serial against the air vehicle serial.",
      componentNodeIds: [
        "c22b5f7ba5044562",
        "fb82c9545d9bdd9d",
        "8911fb53b462b0db",
        "afa11775897c6326"
      ]
    },
    {
      title: "Fit the upper canopy and nose sensors",
      instruction:
        "Seat the upper canopy on the hull gasket and fit the nose sensor bezel with the two obstacle cameras.",
      componentNodeIds: [
        "20cd874f0236de42",
        "031f08ebb941b714",
        "d03f5cc932ff910f",
        "190a691a90faf58d"
      ],
      materials: [
        {
          item: "CN-SEAL-KIT",
          quantity: 1
        }
      ]
    },
    {
      title: "Fit the battery dock",
      instruction:
        "Bolt the battery dock rails to the canopy top. Slide a dummy pack along both rails to check the latch engages.",
      componentNodeIds: ["9c3aac5c2f0b0e4b"]
    },
    {
      title: "Fit the antennas",
      instruction:
        "Fit the GNSS mast and the CRPA anti-jam antenna, arrow forward. Fit both MANET blade antennas and the C2 whip, then torque every RF connector.",
      componentNodeIds: [
        "d2d060977731499c",
        "45daa941f0f8f976",
        "0bf843c92f3a3f8a",
        "80a70f678bf10248",
        "066ebc969b64c8c9",
        "835d1d667bcb624f",
        "8ff9fd264673fcf9",
        "e24969bf95ef42db",
        "f5eee4568b7dc91e",
        "463883321cd53fe7",
        "d2ff3229be1046e4",
        "6ef64862ddd4a750"
      ],
      materials: [
        {
          item: "MAT-KAPTON",
          quantity: 0.5
        }
      ]
    },
    {
      title: "Fit the IR strobes and arming switch",
      instruction:
        "Fit the top and bottom IR anti-collision strobes and the red arming switch. Leave the arming switch in SAFE.",
      componentNodeIds: [
        "ac2b636f95c8e9b3",
        "6e6b58aa45c74cd7",
        "1b7201d70b94d52f",
        "e3f7ed0a2bb68116",
        "10ecb79817f59575",
        "04b323472a3e6381"
      ]
    },
    {
      key: "main-gear",
      title: "Fit the landing gear",
      instruction:
        "Bolt the landing gear brackets under the frame plate and square the skids to the airframe centerline.",
      componentNodeIds: [],
      tools: [
        {
          item: "TL-TORQUE-J1",
          quantity: 1
        }
      ]
    },
    {
      key: "main-gimbal",
      title: "Fit the quick-release receiver and the gimbal",
      instruction:
        "Fit the quick-release receiver and its power/data connector under the nose. Slide the gimbal onto the dovetail until the release lever locks.",
      componentNodeIds: [
        "6665174201ba8926",
        "3e46273aebef997c",
        "ce7c8dc42c0d0932"
      ]
    },
    {
      title: "Fit the propellers",
      instruction:
        "Fit each propeller to the matching motor (CW or CCW) and torque its spinner nut. Check blade tracking with the gauge.",
      componentNodeIds: [
        "7b808ca8b7284766",
        "37dc1b0a4f0dd84e",
        "97b0a779163bcacc",
        "9acd9379ccbd423c",
        "494bde942259261d",
        "0a4d801588dd72a5",
        "c180513659d129ac",
        "5c8510e2056d68ca"
      ],
      tools: [
        {
          item: "TL-TORQUE-J1",
          quantity: 1
        }
      ]
    },
    {
      title: "Fit the battery packs",
      instruction:
        "Fit both smart battery packs until the latches click. Record each pack's lot code on the traveler.",
      componentNodeIds: [
        "ec56a2276c2c0fbc",
        "77a3017f4747d7e1",
        "8e7720f29a6ff31e",
        "f7658a4800d194bc",
        "555dbce499cf9610",
        "6829aa1664eaf590",
        "f31c008f0aaf1cf4",
        "433e5c2969a2b307",
        "99130b6d3b36cfa2",
        "167f577a2b7334bc"
      ]
    },
    {
      key: "final",
      title: "Calibrate, inspect and hover-test",
      instruction:
        "Calibrate the compass and IMU on the fixture, then fly the tethered hover card. Final inspection signs the traveler and the air vehicle moves to finished goods.",
      componentNodeIds: [],
      tools: [
        {
          item: "TL-COMPASS-FIX",
          quantity: 1
        }
      ]
    }
  ],
  componentMappings: [
    // model part "AFR-101 Frame Plate"
    {
      geometryHash: "df7597914fb11b663f9dbb85b3c12750ac95ccb5",
      item: "AFR-100"
    },
    // model part "BAT-710A Smart Battery 11Ah A"
    {
      geometryHash: "16fcc51b8864ff6988d6f0dd65a2fde13ce9d4a7",
      item: "BAT-SMART-11AH"
    },
    // model part "AVN-540 Power Distribution Board"
    {
      geometryHash: "13539ceadde9cfd61a7ac87e52a4e1745debea64",
      item: "PCB-PDB-R1"
    },
    // model part "ESC-600 Motor Controller FL"
    {
      geometryHash: "71057c0acd6c8259a2574cd62eb7a9df8352167b",
      item: "ESC-80A-NDAA"
    },
    // model part "AVN-510 Flight Controller"
    {
      geometryHash: "ae3ea29f768e5b64acbfe8d3a8f3ec531808c54b",
      item: "FC-NDAA-H7"
    },
    // model part "AVN-520 Mission Computer"
    {
      geometryHash: "25ff385b3ee10dcd5f12d0d86a7d416c33fa379c",
      item: "MCU-EDGE-16"
    },
    // model part "AVN-530 Datalink Radio"
    {
      geometryHash: "608af36965f450beca7b166ff73fa951059c25b8",
      item: "RDO-MESH-2X2"
    },
    // model part "COM-811 CRPA Anti-Jam GNSS Antenna"
    {
      geometryHash: "425134ff4b49d0b7688df133fc8f788bf883ab59",
      item: "GNSS-CRPA-4"
    },
    // model part "COM-830 MANET Blade Antenna L"
    {
      geometryHash: "d3d6b1c43a8e5a6615b36c6e8f0371dfb8f195fc",
      item: "ANT-BLADE-01"
    },
    // model part "PLD-940 Sensor Ball"
    {
      geometryHash: "62282b0ab67bc471a4d06e844a3e93df1014d0cc",
      item: "GMB-EOIR-640"
    },
    // model part "ARM-240 Carbon Arm FL"
    {
      geometryHash: "f8e4406fb57976cc363d734521faf4a450487d2f",
      item: "ARM-CF-30"
    },
    // model part "MTR-420 Motor Bell FL"
    {
      geometryHash: "b1b68f0ae231498177efec7a766d59e4f359e5bf",
      item: "MTR-4114-G1"
    },
    // model part "PRP-310 22in Propeller FL"
    {
      geometryHash: "406dcb9a55351347e86d5737a35d934756c7ac3b",
      item: "PRP-2270-CF"
    }
  ]
};
