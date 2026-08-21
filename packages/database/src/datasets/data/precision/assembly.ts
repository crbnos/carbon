import type { AssemblySpec } from "../../types.ts";

// Animated 3D work instructions over the bundled CAD assembly. The node ids
// are graph.json keys from that exact file — see assets/ATTRIBUTION.md.
export const precisionAssembly: AssemblySpec = {
  model: "extruder-toolhead",
  name: "Extruder Toolhead — Final Assembly",
  item: "HMA-4000",
  componentCount: 70,
  steps: [
    {
      title: "Clamp the tool plate in the build fixture",
      instruction:
        "Set the tool plate in the fixture with the groovemount facing up. Wipe both mating faces with IPA and inspect under light — a single chip trapped under this plate throws the nozzle out of square and shows up as a first-layer defect, not as an assembly fault.",
      componentNodeIds: ["650820861e3f30a9"]
    },
    {
      title: "Torque the four M3×10 plate screws",
      instruction:
        "Start all four buttonheads by hand first, then torque diagonally to 0.6 N·m. Running them down one at a time cocks the plate and preloads the dowels.",
      componentNodeIds: [
        "630dcdcdfb74162f",
        "9043b5f1858554fc",
        "1cee1613d32ea10f",
        "71f3409064e10444"
      ]
    },
    {
      title: "Fit the Bondtech drive body",
      instruction:
        "Slide the extruder body onto the plate dowels until it bottoms — no rocking. Turn the drive gears by hand with no filament loaded; they must spin freely and re-mesh without a catch.",
      componentNodeIds: ["7074c6c564d4c09d"]
    },
    {
      title: "Install the 1.75mm bowden adaptor",
      instruction:
        "Thread the adaptor in until the collet shoulder meets the body, then a quarter turn more — no PTFE tape. Push a 100mm filament offcut through by hand to confirm a clear, straight path before moving on.",
      componentNodeIds: ["aac8ae0dc80653bf"]
    },
    {
      title: "Secure the fan bracket with two M3×8",
      instruction:
        "Hold the bracket square to the plate and torque both screws to 0.5 N·m. Check the bracket has not pulled toward one screw; the shroud alignment in the next step depends on it.",
      componentNodeIds: ["547bb2f5132c1933", "23318994b4c3d0b1"]
    },
    {
      title: "Fit the 5015 fan and shroud, then dress the lead",
      instruction:
        "Seat the shroud so the outlet aims at the nozzle tip with roughly 2mm clearance. Route the fan lead through the strain relief before closing — a lead pinched at this joint survives the test print and fails in the first 50 hours.",
      componentNodeIds: ["b9d4cb1e0a50bacf"]
    }
  ]
};
