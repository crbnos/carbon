// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// MIL-STD-881F (13 May 2022) starter structures, levels 1 to 3, copied from
// the standard's Appendix A, B, C and F tables. 881F is a US Government work
// with Distribution Statement A, so its element names ship as data. Building a
// project from one inserts the rows with their codes pinned.
// Spec: `.ai/specs/2026-10-12-wbs-interop-and-contract-financing.md` (Phase A)

export type WbsTemplateRow = { code: string; name: string };

export type WbsTemplateKey = "B" | "A" | "C" | "F";

export type WbsTemplate = {
  key: WbsTemplateKey;
  name: string;
  /** Tree order: every row comes after its parent. */
  rows: readonly WbsTemplateRow[];
};

const rows = (list: [string, string][]): WbsTemplateRow[] =>
  list.map(([code, name]) => ({ code, name }));

export const WBS_TEMPLATES: readonly WbsTemplate[] = [
  {
    key: "B",
    name: "MIL-STD-881F Appendix B — Electronics/Avionics/Generic Systems",
    rows: rows([
      ["1.0", "Electronics/Avionics/Generic Systems"],
      ["1.1", "Prime Mission Product (PMP) 1...n (Specify)"],
      ["1.1.1", "PMP Integration, Assembly, Test, and Checkout"],
      ["1.1.2", "PMP Subsystem 1...n (Specify)"],
      ["1.1.3", "PMP Software Release 1...n (Specify)"],
      ["1.2", "Platform Integration, Assembly, Test, and Checkout"],
      ["1.3", "Systems Engineering"],
      ["1.3.1", "Software Systems Engineering"],
      ["1.3.2", "Integrated Logistics Support (ILS) Systems Engineering"],
      ["1.3.3", "Cybersecurity Systems Engineering"],
      ["1.3.4", "Core Systems Engineering"],
      ["1.3.5", "Other Systems Engineering 1...n (Specify)"],
      ["1.4", "Program Management"],
      ["1.4.1", "Software Program Management"],
      ["1.4.2", "Integrated Logistics Support (ILS) Program Management"],
      ["1.4.3", "Cybersecurity Management"],
      ["1.4.4", "Core Program Management"],
      ["1.4.5", "Other Program Management 1...n (Specify)"],
      ["1.5", "System Test and Evaluation"],
      ["1.5.1", "Developmental Test and Evaluation"],
      ["1.5.2", "Operational Test and Evaluation"],
      ["1.5.3", "Live Fire Test and Evaluation"],
      ["1.5.4", "Mock-ups/System Integration Labs (SILs)"],
      ["1.5.5", "Test and Evaluation Support"],
      ["1.5.6", "Test Facilities"],
      ["1.6", "Training"],
      ["1.6.1", "Equipment"],
      ["1.6.2", "Services"],
      ["1.6.3", "Facilities"],
      ["1.6.4", "Training Software 1...n (Specify)"],
      ["1.7", "Data"],
      ["1.7.1", "Data Deliverables 1...n (Specify)"],
      ["1.7.2", "Data Repository"],
      ["1.7.3", "Data Rights 1...n (Specify)"],
      ["1.8", "Peculiar Support Equipment"],
      ["1.8.1", "Test and Measurement Equipment"],
      ["1.8.2", "Support and Handling Equipment"],
      ["1.9", "Common Support Equipment"],
      ["1.9.1", "Test and Measurement Equipment"],
      ["1.9.2", "Support and Handling Equipment"],
      ["1.10", "Operational/Site Activation by Site 1...n (Specify)"],
      ["1.10.1", "System Assembly, Installation, and Checkout on Site"],
      ["1.10.2", "Contractor Technical Support"],
      ["1.10.3", "Site Construction"],
      ["1.10.4", "Site /Ship/Vehicle Conversion"],
      ["1.10.5", "Interim Contractor Support (ICS)"],
      ["1.11", "Contractor Logistics Support (CLS)"],
      ["1.12", "Industrial Facilities"],
      ["1.12.1", "Construction/Conversion/Expansion"],
      ["1.12.2", "Equipment Acquisition or Modernization"],
      ["1.12.3", "Maintenance (Industrial Facilities)"],
      ["1.13", "Initial Spares and Repair Parts"]
    ])
  },
  {
    key: "A",
    name: "MIL-STD-881F Appendix A — Aircraft Systems",
    rows: rows([
      ["1.0", "Aircraft System"],
      ["1.1", "Aircraft System, Integration, Assembly, Test and Checkout"],
      ["1.2", "Air Vehicle"],
      ["1.2.1", "Air Vehicle Integration, Assembly, Test and Checkout"],
      ["1.2.2", "Air Frame"],
      ["1.2.3", "Propulsion"],
      ["1.2.4", "Vehicle Subsystems"],
      ["1.2.5", "Avionics"],
      ["1.2.6", "Armament/Weapons Delivery"],
      ["1.2.7", "Auxiliary Equipment"],
      ["1.2.8", "Furnishings and Equipment"],
      ["1.2.9", "Air Vehicle Software Release 1...n (Specify)"],
      ["1.2.10", "Other Air Vehicle 1...n (Specify)"],
      ["1.3", "Payload/Mission System"],
      ["1.3.1", "Payload Integration, Assembly, Test, and Checkout"],
      ["1.3.2", "Survivability Payload 1...n (Specify)"],
      ["1.3.3", "Reconnaissance Payload 1...n (Specify)"],
      ["1.3.4", "Electronic Warfare Payload 1...n (Specify)"],
      ["1.3.5", "Armament/Weapons Delivery Payload 1...n (Specify)"],
      ["1.3.6", "Payload Software Release 1...n (Specify)"],
      ["1.3.7", "Other Payload 1...n (Specify)"],
      ["1.4", "Ground/Host Segment"],
      ["1.4.1", "Ground Segment Integration, Assembly, Test, and Checkout"],
      ["1.4.2", "Ground Control Systems"],
      ["1.4.3", "Command and Control Subsystem"],
      ["1.4.4", "Launch Equipment"],
      ["1.4.5", "Recovery Equipment"],
      ["1.4.6", "Transport Vehicles"],
      ["1.4.7", "Ground Segment Software Release 1...n (Specify)"],
      ["1.4.8", "Other Ground/Host Segment 1...n (Specify)"],
      ["1.5", "Aircraft System Software Release 1...n (Specify)"],
      ["1.6", "Systems Engineering"],
      ["1.6.1", "Software Systems Engineering"],
      ["1.6.2", "Integrated Logistics Support (ILS) Systems Engineering"],
      ["1.6.3", "Cybersecurity Systems Engineering"],
      ["1.6.4", "Core Systems Engineering"],
      ["1.6.5", "Other Systems Engineering 1...n (Specify)"],
      ["1.7", "Program Management"],
      ["1.7.1", "Software Program Management"],
      ["1.7.2", "Integrated Logistics Support (ILS) Program Management"],
      ["1.7.3", "Cybersecurity Management"],
      ["1.7.4", "Core Program Management"],
      ["1.7.5", "Other Program Management 1...n (Specify)"],
      ["1.8", "System Test and Evaluation"],
      ["1.8.1", "Developmental Test and Evaluation"],
      ["1.8.2", "Operational Test and Evaluation"],
      ["1.8.3", "Live Fire Test and Evaluation"],
      ["1.8.4", "Mock-ups/System Integration Labs (SILs)"],
      ["1.8.5", "Test and Evaluation Support"],
      ["1.8.6", "Test Facilities"],
      ["1.9", "Training"],
      ["1.9.1", "Equipment"],
      ["1.9.2", "Services"],
      ["1.9.3", "Facilities"],
      ["1.9.4", "Training Software 1...n (Specify)"],
      ["1.10", "Data"],
      ["1.10.1", "Data Deliverables 1...n (Specify)"],
      ["1.10.2", "Data Repository"],
      ["1.10.3", "Data Rights 1...n (Specify)"],
      ["1.11", "Peculiar Support Equipment"],
      ["1.11.1", "Test and Measurement Equipment"],
      ["1.11.2", "Support and Handling Equipment"],
      ["1.12", "Common Support Equipment"],
      ["1.12.1", "Test and Measurement Equipment"],
      ["1.12.2", "Support and Handling Equipment"],
      ["1.13", "Operational/Site Activation by Site 1...n (Specify)"],
      ["1.13.1", "System Assembly, Installation, and Checkout on Site"],
      ["1.13.2", "Contractor Technical Support"],
      ["1.13.3", "Site Construction"],
      ["1.13.4", "Site/Ship/Vehicle Conversion"],
      ["1.13.5", "Interim Contractor Support (ICS)"],
      ["1.14", "Contractor Logistics Support (CLS)"],
      ["1.15", "Industrial Facilities"],
      ["1.15.1", "Construction/Conversion/Expansion"],
      ["1.15.2", "Equipment Acquisition or Modernization"],
      ["1.15.3", "Maintenance (Industrial Facilities)"],
      ["1.16", "Initial Spares and Repair Parts"]
    ])
  },
  {
    key: "C",
    name: "MIL-STD-881F Appendix C — Missile/Ordnance Systems",
    rows: rows([
      ["1.0", "Missile/Ordnance System"],
      [
        "1.1",
        "Missile/Ordnance System Integration, Assembly, Test, and Checkout"
      ],
      ["1.2", "Air Vehicle/Munition"],
      [
        "1.2.1",
        "Air Vehicle/Munition Integration, Assembly, Test, and Checkout"
      ],
      ["1.2.2", "Airframe"],
      ["1.2.3", "Propulsion Subsystem 1...n (Specify)"],
      ["1.2.4", "Power and Distribution"],
      ["1.2.5", "Guidance"],
      ["1.2.6", "Navigation"],
      ["1.2.7", "Controls"],
      ["1.2.8", "Communications"],
      ["1.2.9", "Payload"],
      ["1.2.10", "On Board Test Equipment"],
      ["1.2.11", "On Board Training Equipment"],
      ["1.2.12", "Auxiliary Equipment"],
      ["1.2.13", "Air Vehicle Software Release 1...n (Specify)"],
      ["1.3", "Encasement Device"],
      ["1.3.1", "Encasement Device Integration, Assembly, Test, and Checkout"],
      ["1.3.2", "Encasement Device Structure"],
      ["1.3.3", "Encasement Device Software Release 1...n (Specify)"],
      ["1.3.4", "Other Encasement Device Subsystems 1...n (Specify)"],
      ["1.4", "Command and/or Launch"],
      [
        "1.4.1",
        "Command and/or Launch Integration, Assembly, Test, and Checkout"
      ],
      ["1.4.2", "Surveillance, Identification and Tracking Sensors"],
      ["1.4.3", "Communications"],
      ["1.4.4", "Launcher"],
      ["1.4.5", "Adapter Kits"],
      ["1.4.6", "Launch and Guidance Control"],
      ["1.4.7", "Ready Magazine"],
      ["1.4.8", "Auxiliary Equipment"],
      ["1.4.9", "Command and/or Launch Software Release 1...n (Specify)"],
      ["1.4.10", "Other Command and/or Launch 1...n (Specify)"],
      ["1.5", "Missile/Ordnance System Software Release 1...n (Specify)"],
      [
        "1.6",
        "Platform Integration, Assembly, Test, and Checkout 1...n (Specify)"
      ],
      ["1.7", "Systems Engineering"],
      ["1.7.1", "Software Systems Engineering"],
      ["1.7.2", "Integrated Logistics Support (ILS) Systems Engineering"],
      ["1.7.3", "Cybersecurity Systems Engineering"],
      ["1.7.4", "Core Systems Engineering"],
      ["1.7.5", "Other Systems Engineering 1...n (Specify)"],
      ["1.8", "Program Management"],
      ["1.8.1", "Software Program Management"],
      ["1.8.2", "Integrated Logistics Support (ILS) Program Management"],
      ["1.8.3", "Cybersecurity Management"],
      ["1.8.4", "Core Program Management"],
      ["1.8.5", "Other Program Management 1...n (Specify)"],
      ["1.9", "System Test and Evaluation"],
      ["1.9.1", "Developmental Test and Evaluation"],
      ["1.9.2", "Operational Test and Evaluation"],
      ["1.9.3", "Live Fire Test and Evaluation"],
      ["1.9.4", "Mock-ups/System Integration Labs (SILs)"],
      ["1.9.5", "Test and Evaluation Support"],
      ["1.9.6", "Test Facilities"],
      ["1.10", "Training"],
      ["1.10.1", "Equipment"],
      ["1.10.2", "Services"],
      ["1.10.3", "Facilities"],
      ["1.10.4", "Training Software 1...n (Specify)"],
      ["1.11", "Data"],
      ["1.11.1", "Data Deliverables 1...n (Specify)"],
      ["1.11.2", "Data Repository"],
      ["1.11.3", "Data Rights 1...n (Specify)"],
      ["1.12", "Peculiar Support Equipment"],
      ["1.12.1", "Test and Measurement Equipment"],
      ["1.12.2", "Support and Handling Equipment"],
      ["1.13", "Common Support Equipment"],
      ["1.13.1", "Test and Measurement Equipment"],
      ["1.13.2", "Support and Handling Equipment"],
      ["1.14", "Operational/Site Activation by Site 1...n (Specify)"],
      ["1.14.1", "System Assembly, Installation, and Checkout"],
      ["1.14.2", "Contractor Technical Support"],
      ["1.14.3", "Site Construction"],
      ["1.14.4", "Site/Ship/Vehicle Conversion"],
      ["1.14.5", "Interim Contractor Support (ICS)"],
      ["1.15", "Contractor Logistics Support (CLS)"],
      ["1.16", "Industrial Facilities"],
      ["1.16.1", "Construction/Conversion/Expansion"],
      ["1.16.2", "Equipment Acquisition or Modernization"],
      ["1.16.3", "Maintenance (Industrial Facilities)"],
      ["1.17", "Initial Spares and Repair Parts"]
    ])
  },
  {
    key: "F",
    name: "MIL-STD-881F Appendix F — Space Systems",
    rows: rows([
      ["1.0", "Space System"],
      ["1.1", "SEIT/PM and Support Equipment"],
      ["1.1.1", "Systems Engineering"],
      ["1.1.2", "Assembly, Integration and Test"],
      ["1.1.3", "Program Management"],
      ["1.1.4", "Support Equipment"],
      ["1.2", "Space Vehicle 1...n (Specify)"],
      ["1.2.1", "SEIT/PM and Support Equipment"],
      ["1.2.2", "Bus"],
      [
        "1.2.3",
        "SEIT/PM and Support Equipment (If applicable for integration of Multiple Payloads)"
      ],
      ["1.2.4", "Payload 1...n (Specify)"],
      ["1.2.5", "Booster Adapter"],
      ["1.2.6", "Space Vehicle Storage"],
      ["1.2.7", "Launch Systems Integration (LSI)"],
      ["1.2.8", "Launch Operations"],
      ["1.2.9", "Mission Operations Support"],
      ["1.2.10", "Space Vehicle Other"],
      ["1.3", "Ground Segment"],
      ["1.3.1", "SEIT/PM and Support Equipment"],
      ["1.3.2", "Ground Functions 1...n (Specify)"],
      ["1.3.3", "Ground Terminal/Gateway (GT) 1...n (Specify)"],
      ["1.3.4", "External Network (T-COMM)"],
      ["1.3.5", "User Equipment"],
      ["1.3.6", "Facilities 1...n (Specify)"],
      ["1.3.7", "Vehicles and Shelters"],
      ["1.4", "Orbital Transfer Vehicle (OTV)"],
      [
        "1.5",
        "Launch Vehicle 1...n (Specify) (See Appendix I for WBS breakout)"
      ]
    ])
  }
];

export function wbsTemplate(key: string): WbsTemplate | undefined {
  return WBS_TEMPLATES.find((template) => template.key === key);
}

/**
 * The code of a template row's parent, or null for level 1. "1.1" sits under
 * "1.0" (the .0 rule of `childWbsCode`), "1.1.2" under "1.1".
 */
export function wbsTemplateParentCode(
  code: string,
  templateRows: readonly WbsTemplateRow[]
): string | null {
  const segments = code.split(".");
  if (segments.length < 2 || (segments.length === 2 && segments[1] === "0")) {
    return null;
  }
  const prefix = segments.slice(0, -1).join(".");
  const candidates = segments.length === 2 ? [`${prefix}.0`, prefix] : [prefix];
  for (const candidate of candidates) {
    if (templateRows.some((row) => row.code === candidate)) return candidate;
  }
  return null;
}
