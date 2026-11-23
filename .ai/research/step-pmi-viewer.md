# PMI in the STEP Viewer Research: Best Practices Survey

## Summary

This file surveys how CAD viewers show PMI (Product Manufacturing Information) from a model-based definition (MBD). It also records how OCCT reads AP242 PMI and which public test files exist. All surveyed viewers show the CAD author's graphical PMI in its annotation plane. Each one lists the PMI in a panel and has saved views that set the camera and the visible PMI. Siemens and the SOLIDWORKS outputs highlight the faces that a picked annotation references.

Semantic PMI (the machine-readable values) is data. Quality tools use it to build a bill of characteristics. OCCT V8 already reads both kinds into the XCAF document that Carbon's converter loads today.

## Competitors Surveyed

- **SAP 3D Visual Enterprise Viewer** — the SAP reference for 3D product data in the enterprise.
- **Siemens JT2Go / Teamcenter Visualization** — the most common free PMI viewer in aerospace and automotive.
- **SOLIDWORKS MBD + eDrawings** — the MBD tool that most Carbon customers (job shops) use.
- **CAD Exchanger** — a CAD data SDK and viewer with an explicit graphical/semantic PMI model.
- **High QA, 1factory** — quality tools that turn PMI or drawings into inspection characteristics.
- **NIST STEP File Analyzer and Viewer (SFA)** — the reference tool for AP242 PMI conformance.

## Key Consensus Patterns

### 1. Two kinds of PMI: graphical and semantic

- **CAD Exchanger**: each PMI element has a graphical representation (outlines, text, filled triangles) and a semantic representation (dimension, geometric tolerance, datum, surface finish components).
- **SAP**: each PMI node carries "semantic information": type, main value, tolerance high, tolerance low, unit.
- **NIST SFA**: the viewer draws only the graphical PMI. The analyzer writes the semantic PMI to a spreadsheet.
- **Rationale**: the author's drawing is what a designer expects to see. Software can only read the semantic values.

### 2. The annotation sits in its plane

- **SAP**: PMI sits in its plane by default. "Billboard Mode" can turn it to face the camera.
- **Siemens**: PMI sits in its plane by default. "Parallel to Screen" is an option per display instance.
- **SOLIDWORKS**: annotations sit on their annotation view planes. Only the "Notes Area" faces the screen.
- **Rationale**: the plane is part of the author's intent. A rotated plane tells the reader which face a dimension measures.

### 3. A PMI list with show/hide

- **SAP**: one "Show/Hide all PMI" toggle, plus "PMI Points on Top".
- **Siemens**: a PMI tree holds PMI and model views. A filter shows PMI by type.
- **CAD Exchanger**: a PMI panel turns all entities on, or one at a time.
- **Rationale**: a model can hold hundreds of annotations. The reader needs to reduce the clutter.

### 4. Saved views set the camera and the visible PMI

- **SAP**: "Model Views" in "Portfolios". A click activates a view; Home then resets to it.
- **Siemens**: "Model Views" in the PMI tree.
- **SOLIDWORKS**: "3D Views" save the orientation, the zoom and the annotations. eDrawings, 3D PDF and STEP 242 export keep them.
- **NIST SFA**: saved views become viewpoints. Each one switches its PMI on and the rest off.
- **Rationale**: the author groups annotations by the view that reads them best.

### 5. A picked annotation highlights its faces

- **Siemens**: the preference "Highlight attached surfaces and PMI" controls it (seen in a search summary only).
- **SOLIDWORKS**: eDrawings highlights the geometry an annotation is attached to (seen in a search summary only).
- **SAP**: no source found for face highlight. Selection turns an object red.
- **Rationale**: the highlight answers "which feature does this tolerance control?".

## Answers to Research Questions

1. Which PMI kinds do viewers show, and what are they called? — Dimensions, geometric tolerances (feature control frames), datums, datum targets, notes and surface finish. "PMI", "semantic PMI", "graphical PMI" and "model view" are the common terms (SAP, Siemens, CAD Exchanger). SOLIDWORKS says "3D View" for a saved view.
2. Which interactions are standard? — A PMI list, a show/hide toggle, saved views, and a face highlight on pick (Siemens, SOLIDWORKS). Filter by type exists in Siemens and SOLIDWORKS only.
3. Graphical or re-rendered from semantic? — Viewers draw the graphical PMI (CAD Exchanger, NIST SFA). When only semantic PMI exists, CAD Exchanger Cloud showed nothing. Carbon must draw its own label in that case.
4. Which edge cases matter? — Inch files (NIST CTC 05 is inch). Duplicate datums (OCCT adds a datum once per tolerance that uses it). Graphic-only PMI with no semantic data. Saved views whose camera position is not reliable (see the OCCT section).
5. What does a quality tool extract per characteristic? — Type, nominal, upper and lower tolerance or limits, the GD&T symbol, the zone value, modifiers and datum references (High QA, 1factory). This is the data a later inspection link needs.

## Competitor-Specific Details

### SAP 3D Visual Enterprise Viewer

The Information panel has "Show/Hide all PMI". The "Load Model Views" import setting (All, Top Level, Assembly, Parts, None) ties a model view to a node of the product structure. "Always on Top" draws PMI through all geometry.

### Siemens JT2Go

The user picks a part in a "toggle single" or "toggle multiple" mode to show its PMI. Menu → PMI → Filter Configuration switches between "Display all PMI entities" and "Filter PMI entities by type".

### SOLIDWORKS MBD / eDrawings

"MBD Dimensions" (formerly DimXpert) are the PMI. "Annotation views" are the planes. "3D Views" are saved views. "Dynamic Annotation Views" shows only the planes that face the current camera.

### CAD Exchanger

`PMI::Element` has `GraphicalRepresentation` (`OutlinedComponent`, `TextComponent`, `TriangulatedComponent`) and `SemanticRepresentation` (`DimensionComponent`, `GeometricToleranceComponent`, `DatumComponent`, `SurfaceFinishComponent`). The viewer marks the parts that have PMI in the product tree.

### High QA

Inspection Manager reads PMI from native and neutral models (STEP included) with HOOPS Exchange. One click makes a ballooned drawing and a bill of characteristics.

### OCCT V8 (Carbon's CAD kernel)

The facts below come from the OCCT V8_0_0_p1 source (`.context/occt-src`).

| Fact | Where |
|---|---|
| `STEPCAFControl_Reader` reads GD&T and saved views by default (`myGDTMode`, `myViewMode` are true) | `STEPCAFControl_Reader.cxx:286-288` |
| `XCAFDoc_DimTolTool` lists dimensions, geometric tolerances and datums | `XCAFDoc_DimTolTool.hxx:63,89,171` |
| `GetRefShapeLabel` returns the referenced shapes of any GD&T label | `XCAFDoc_DimTolTool.hxx:153` |
| A referenced face is a sub-shape label directly under its part's label | `XCAFDoc_ShapeTool.cxx:1139,1209` |
| The presentation is a compound of edges (polyline PMI) and of faces with only a `Poly_Triangulation` (filled text in tessellated PMI) | reader `:2532-2711` |
| The presentation is in the owning part's local frame, in mm | reader `:2808-2814` |
| Angles are in degrees | reader `:4476` |
| The lower tolerance is stored as a positive number | reader `:4765` |
| A datum is added once per tolerance that references it | reader `:3329-3655` |
| A saved view stores a reliable view direction and up direction; its projection point is relative to the camera's own frame | reader `:5900-6070` |
| BinXCAF (`.xbf`) keeps all GD&T attributes and the surface-less faces | `BinMDF_ADriverTable.cxx`, `BinTools_ShapeWriter.cxx:235` |
| AP242 notes are not read | no `NotesTool` use in `TKDESTEP` |

### NIST MBE PMI test files

NIST publishes 18 AP242 files (CTC 01–05, FTC 06–11, STC 06–10). US federal law puts them in the public domain in the US. NIST asks for credit. Three files cover the main paths:

| File | Graphical PMI | Unit | Saved views |
|---|---|---|---|
| `nist_ctc_01_asme1_ap242-e1.stp` (396 KB) | tessellated | mm | 1 |
| `nist_ctc_05_asme1_ap242-e1.stp` (878 KB) | polyline | inch | 2 |
| `nist_stc_06_asme1_ap242-e3.stp` (1 MB) | tessellated, placeholders | mm geometry, inch values | 12 |

### GD&T symbols in Unicode

| Characteristic | Symbol | Code point |
|---|---|---|
| Straightness | ⏤ | U+23E4 |
| Flatness | ⏥ | U+23E5 |
| Circularity | ○ | U+25CB |
| Cylindricity | ⌭ | U+232D |
| Profile of a line | ⌒ | U+2312 |
| Profile of a surface | ⌓ | U+2313 |
| Angularity | ∠ | U+2220 |
| Perpendicularity | ⟂ | U+27C2 |
| Parallelism | ∥ | U+2225 |
| Position | ⌖ | U+2316 |
| Concentricity | ◎ | U+25CE |
| Symmetry | ⌯ | U+232F |
| Circular runout | ↗ | U+2197 (no dedicated code point) |
| Total runout | ⌰ | U+2330 |
| Diameter | ⌀ | U+2300 |
| MMC, LMC, projected zone, free state | Ⓜ Ⓛ Ⓟ Ⓕ | U+24C2, U+24C1, U+24C5, U+24BB |

## Recommended Approach for Carbon

1. Read both kinds of PMI with OCCT during the optimize ingest. The XCAF document is already loaded there. This follows the CAD Exchanger two-representation model.
2. Draw the graphical PMI in its own plane, with the lines on top of the model. This follows SAP, Siemens and SOLIDWORKS defaults, plus SAP's "Always on Top".
3. Draw a text label from the semantic values only when an item has no graphical PMI. CAD Exchanger showed nothing in that case, which hides real data.
4. List the PMI in a panel with one show/hide toggle (SAP), grouped by kind.
5. Show saved views. Use the view direction and the up direction, and fit the camera to the view's PMI. Do not trust the projection point.
6. Highlight the referenced faces when the user picks a PMI item (Siemens, SOLIDWORKS).
7. Keep the semantic values in the artifact, so a later change can make inspection characteristics from them (High QA pattern).
8. Use the three NIST files as manual fixtures and an OCCT-written AP242 file as the committed hermetic test.

## Sources

- https://help.sap.com/doc/a54961fccc8d4c399e0620a442eb0b98/9.0.0.9/en-US/Viewer_help_EN.pdf
- https://help.sap.com/docs/SAP_3D_VISUAL_ENTERPRISE_AUTHOR/67c291fba1bd10148bea8dce7b0caa3e/b32d64427d294d88952b5fa066d2f5c1.html?version=9.0.0.13
- https://help.sap.com/docs/SAP_3D_VISUAL_ENTERPRISE_AUTHOR/8e4c65bb3a6c4ef6b56dc27d1d95cde6/4c831292013d4ac0a70c39f770f189bd.html?version=9.0.0.17
- https://community.sw.siemens.com/s/question/0D54O000061xqScSAI/pmi-filter-configuration
- https://community.sw.siemens.com/s/question/0D5Vb00000No6bHKAR/nx-pmi-chamfer-function-shows-wrong-chamfer-surface-in-jt2go
- https://community.sw.siemens.com/s/question/0D54O000061xk0GSAQ/pmi-parallel-to-screen-display
- https://help.solidworks.com/2021/English/eDrawings/c_annotations.htm
- https://help.solidworks.com/2025/English/SolidWorks/sldworks/c_annotation_view_flat_to_screen.htm
- https://hawkridgesys.com/blog/mbd-dimxpert-and-mbd-dimensions-whats-the-difference
- https://www.engineersrule.com/getting-closer-losing-drawing/
- https://www.engineersrule.com/building-photo-storyline-mbd-data-3d-views/
- https://www.cati.com/blog/capturing-3d-views-solidworks-mbd/
- https://cadexchanger.com/blog/pmi-in-cad-exchanger-cloud/
- https://docs.cadexsoft.com/mtk/mtk_data_model_pmi
- https://cadexchanger.com/blog/new-formats-semantic-pmi-import-in-cad-exchanger-3-7-0/
- https://www.techsoft3d.com/resources/case-studies/high-qa/
- https://www.highqa.com/3d-mbd-integration/
- https://www.1factory.com/drawing-auto-ballooning-first-article.html
- https://www.nist.gov/ctl/smart-connected-systems-division/smart-connected-manufacturing-systems-group/mbe-pmi-0
- https://www.nist.gov/open/license
- https://www.nist.gov/services-resources/software/step-file-analyzer-and-viewer
- https://github.com/usnistgov/SFA
- https://www.unicode.org/Public/UCD/latest/ucd/NamesList.txt
- OCCT V8_0_0_p1 source: https://github.com/Open-Cascade-SAS/OCCT/tree/V8_0_0_p1
