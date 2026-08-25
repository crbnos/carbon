import type { AssemblySpec } from "../../types.ts";

// Animated 3D work instructions over the bundled CAD assembly. The node ids
// are graph.json keys from that exact file — see assets/ATTRIBUTION.md.
// Ordered crankcase-outward, the way a radial is actually built up.
export const satelliteAssembly: AssemblySpec = {
  model: "radial-engine",
  name: "Radial Engine — Build Sequence",
  item: "SAT-1000",
  componentCount: 266,
  steps: [
    {
      title: "Set the crankcase in the stand",
      instruction:
        "Mount the crankcase in the rotating stand with the rear face up. Blow out every oil gallery and confirm each one passes air before anything closes over it — a blocked gallery is undetectable once the case is built.",
      componentNodeIds: ["3bc7311d9d4c8ffc"]
    },
    {
      title: "Install the master rod and piston assembly",
      instruction:
        "Fit the master rod on the crankpin first, then bring the articulated rods onto their knuckle pins. Turn the crank a full revolution and confirm every rod swings free — a pinched knuckle bearing will seize the engine on its first run.",
      componentNodeIds: ["85cd37602cfc85ea"]
    },
    {
      title: "Close the crankcase cover",
      instruction:
        "Fit the cover with a new gasket and pull the nuts down in a criss-cross pattern in three passes. Re-check crank rotation after the final pass; if it stiffened, the case is pinching and the cover comes back off.",
      componentNodeIds: ["95451b53f10c23c3"]
    },
    {
      title: "Fit the cam ring housing and its five followers",
      instruction:
        "Set the cam ring on its bearing and line the timing mark up with the crankcase index before the housing goes on — this is the one alignment the rest of the build cannot correct, so verify it twice. Then drop the five cam followers into their bores and confirm each rides the ring without binding.",
      componentNodeIds: [
        "61c5b3be6fbdce0a",
        "6557ef1b8faca7f0",
        "9ed8b3d10efc237e",
        "c075111ec89c6304",
        "2943e2036cf12fe5",
        "8532047e4eda94e0"
      ]
    },
    {
      title: "Fit the five cylinder barrels",
      instruction:
        "Work opposite pairs, not around the circle. Ring-compress each piston into its barrel and confirm the piston travels the full stroke by hand before moving to the next. Record each barrel's bore position on the traveler.",
      componentNodeIds: [
        "da008d43e97f4aa6",
        "44d442e8db5e0987",
        "cd9b2aed498aa26b",
        "d6f9c46ffc3eaabe",
        "3dc65b37b1d4f03e"
      ]
    },
    {
      title: "Fit the five head gaskets",
      instruction:
        "New gaskets only, dry, one per barrel. Check each sits flat in its register with no lip standing proud — a gasket that is even slightly cocked will blow at the first full-power run.",
      componentNodeIds: [
        "7218480880f48807",
        "0ff0f158d5f068ac",
        "f567c75f3ce83cd6",
        "19ff499b9d317a23",
        "7c95eded5c8d739a"
      ]
    },
    {
      title: "Fit the cylinder heads and set valve clearance",
      instruction:
        "Torque each head in three passes to the figure on the traveler. Then set intake and exhaust clearance on all five with the cylinder at top dead centre on its compression stroke, and log both figures per cylinder.",
      componentNodeIds: [
        "1ea2071899b19cb1",
        "99b4d51abc675177",
        "192567d4cbb32726",
        "f79c31a08ad60625",
        "dfc33a292d0882ed"
      ]
    },
    {
      title: "Plumb the intake and exhaust tubes",
      instruction:
        "Fit all five intake tubes and all five exhaust stacks, starting every flange nut before tightening any. Leave the clamps finger-tight until the last tube is on — a tube pulled up hard early loads the next one against its port.",
      componentNodeIds: [
        "dada872bba564fa6",
        "e51c2cf975267c94",
        "47aabdf700d31aa2",
        "a7e243cdaf203f40",
        "1629524257419c80",
        "4bac11e7c03f4be3",
        "4b68a1a8fbddbd80",
        "11c5c1f4cf07a767",
        "90eb7b05105fe291",
        "1bfec9eb21d1518f"
      ]
    },
    {
      title: "Fit the front cover",
      instruction:
        "Close the front cover onto the nose case with a new gasket, pulling the fasteners down evenly. Turn the crank before and after: any change in drag means the cover is loading the cam drive and it comes back off.",
      componentNodeIds: ["3d5308ee67a8d612"]
    },
    {
      title: "Fit the nose cone and turn the engine over",
      instruction:
        "Fit the nose cone last. Turn the engine through two full revolutions by hand feeling for the five compression peaks — five even peaks and no hard stop is the sign-off for this assembly.",
      componentNodeIds: ["7018fb918f1b1be6"]
    }
  ]
};
