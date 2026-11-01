// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! `pmi.json` — the PMI (Product Manufacturing Information) of a STEP AP242
//! model: dimensions, geometric tolerances, datums, graphic-only notes and the
//! saved views, read by `occt_bridge::read_pmi`. The contract is
//! `packages/viewer/src/pmi.ts`; the two must agree field for field.
//!
//! Everything is world mm in the frame of the optimised GLB (angles degrees).
//! The geometry of `convert` is untouched: this is a separate read.

use serde::Serialize;
use std::collections::HashMap;

pub const PMI_VERSION: u32 = 1;

/// Largest `pmi.json` the ingest writes. Over it the referenced-face triangles
/// go first (the highlight is the only thing they feed); still over, no PMI.
pub const MAX_PMI_JSON_BYTES: usize = 16 * 1024 * 1024;

/// Samples curved presentation and referenced edges (radians).
pub const PMI_ANGULAR_DEFLECTION: f64 = 0.2;

pub type Vec3 = [f64; 3];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PmiDocument {
    pub version: u32,
    pub unit: &'static str,
    pub source_unit: Option<&'static str>,
    pub items: Vec<PmiItem>,
    pub faces: Vec<PmiMesh>,
    pub edges: Vec<Vec<f64>>,
    pub views: Vec<PmiView>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PmiMesh {
    pub positions: Vec<f64>,
    pub indices: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PmiPlane {
    pub origin: Vec3,
    pub normal: Vec3,
    pub x_direction: Vec3,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PmiItem {
    pub id: String,
    pub kind: &'static str,
    pub name: Option<String>,
    pub dimension: Option<PmiDimension>,
    pub tolerance: Option<PmiTolerance>,
    pub datum: Option<PmiDatum>,
    pub lines: Vec<Vec<f64>>,
    pub mesh: Option<PmiMesh>,
    pub plane: Option<PmiPlane>,
    pub text_position: Option<Vec3>,
    pub faces: Vec<u32>,
    pub edges: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PmiFitClass {
    pub hole: bool,
    pub form_variance: String,
    pub grade: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PmiDecimals {
    pub left: i32,
    pub right: i32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PmiDimension {
    #[serde(rename = "type")]
    pub kind: String,
    pub value: Option<f64>,
    pub upper: Option<f64>,
    pub lower: Option<f64>,
    pub upper_bound: Option<f64>,
    pub lower_bound: Option<f64>,
    pub fit_class: Option<PmiFitClass>,
    pub qualifier: Option<String>,
    pub decimals: Option<PmiDecimals>,
    pub modifiers: Vec<String>,
    pub descriptions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PmiDatumRef {
    pub name: String,
    pub modifiers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PmiTolerance {
    #[serde(rename = "type")]
    pub kind: String,
    pub value: Option<f64>,
    pub zone_shape: Option<String>,
    pub material: Option<String>,
    pub zone_modifier: Option<String>,
    pub zone_modifier_value: Option<f64>,
    pub modifiers: Vec<String>,
    pub max_value: Option<f64>,
    pub datums: Vec<PmiDatumRef>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PmiDatum {
    pub name: String,
    pub modifiers: Vec<String>,
    pub target: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PmiView {
    pub id: String,
    pub name: String,
    pub direction: Vec3,
    pub up: Vec3,
    pub projection: Option<&'static str>,
    pub item_ids: Vec<String>,
}

/// The `sourceUnit` the viewer can start its unit toggle at: only the two it
/// offers. Takes [`crate::graph::detect_source_unit_bytes`]'s answer.
pub fn pmi_source_unit(detected: &str) -> Option<&'static str> {
    match detected {
        "mm" => Some("mm"),
        "inch" => Some("in"),
        _ => None,
    }
}

/// Read a STEP or `.xbf` file's PMI. `Ok(None)` when it has none.
pub fn extract_pmi(
    path: &str,
    source_unit: Option<&'static str>,
) -> Result<Option<PmiDocument>, String> {
    let tree = occt_bridge::read_pmi(path, PMI_ANGULAR_DEFLECTION);
    if !tree.ok {
        return Err(if tree.error.is_empty() {
            "PMI read failed".to_string()
        } else {
            tree.error
        });
    }
    Ok(build_document(&tree, source_unit))
}

/// 0.1 µm — far below any tolerance, and it keeps the JSON short. A
/// non-finite value becomes 0: serde_json writes NaN as `null`, which the
/// viewer's parser refuses, and one bad point would drop the whole document.
fn r4(v: f64) -> f64 {
    if !v.is_finite() {
        return 0.0;
    }
    let r = (v * 10_000.0).round() / 10_000.0;
    if r == 0.0 {
        0.0 // no "-0.0"
    } else {
        r
    }
}

fn r4_all(values: &[f64]) -> Vec<f64> {
    values.iter().map(|&v| r4(v)).collect()
}

fn vec3(values: &[f64], at: usize) -> Vec3 {
    [r4(values[at]), r4(values[at + 1]), r4(values[at + 2])]
}

fn non_empty(s: &str) -> Option<String> {
    if s.trim().is_empty() {
        None
    } else {
        Some(s.trim().to_string())
    }
}

fn some_if(cond: bool, v: f64) -> Option<f64> {
    if cond && v.is_finite() {
        Some(r4(v))
    } else {
        None
    }
}

const KINDS: [&str; 4] = ["dimension", "tolerance", "datum", "note"];
const ID_PREFIX: [&str; 4] = ["d", "t", "a", "n"];

fn has_graphics(item: &occt_bridge::PmiRaw) -> bool {
    !item.lines.is_empty() || !item.mesh.indices.is_empty()
}

/// A dimension with no value and no drawing shows nothing. OCCT makes these
/// for a dimension whose drawing it stored as a separate graphic-only item
/// (NIST CTC 01 has four), which the document keeps as a note.
fn is_empty_dimension(item: &occt_bridge::PmiRaw) -> bool {
    item.kind == 0 && !item.has_value && !has_graphics(item)
}

pub fn build_document(
    tree: &occt_bridge::PmiTree,
    source_unit: Option<&'static str>,
) -> Option<PmiDocument> {
    if tree.items.is_empty() && tree.views.is_empty() {
        return None;
    }

    // OCCT adds a datum once per tolerance that references it. Keep one per
    // letter: the first copy with graphics, else the first copy.
    let mut kept_datum: HashMap<&str, usize> = HashMap::new();
    for (i, raw) in tree.items.iter().enumerate() {
        if raw.kind != 2 {
            continue;
        }
        let name = raw.name.trim();
        match kept_datum.get(name) {
            Some(&k) if has_graphics(&tree.items[k]) || !has_graphics(raw) => {}
            _ => {
                kept_datum.insert(name, i);
            }
        }
    }
    // Raw index → output index (a merged datum points at the one kept).
    let mut out_index: Vec<Option<usize>> = vec![None; tree.items.len()];
    let mut counters = [0usize; 4];
    let mut items: Vec<PmiItem> = Vec::new();
    for (i, raw) in tree.items.iter().enumerate() {
        let kind = (raw.kind as usize).min(3);
        if kind == 2 && kept_datum.get(raw.name.trim()) != Some(&i) {
            continue;
        }
        if is_empty_dimension(raw) {
            continue;
        }
        counters[kind] += 1;
        out_index[i] = Some(items.len());
        items.push(item(
            raw,
            kind,
            format!("{}{}", ID_PREFIX[kind], counters[kind]),
        ));
    }
    for (i, raw) in tree.items.iter().enumerate() {
        if raw.kind == 2 && out_index[i].is_none() {
            out_index[i] = kept_datum.get(raw.name.trim()).and_then(|&k| out_index[k]);
        }
    }
    if items.is_empty() && tree.views.is_empty() {
        return None;
    }

    let views = tree
        .views
        .iter()
        .enumerate()
        .map(|(i, v)| {
            let mut item_ids: Vec<String> = Vec::new();
            for &raw in &v.items {
                if let Some(Some(o)) = out_index.get(raw as usize) {
                    let id = &items[*o].id;
                    if !item_ids.contains(id) {
                        item_ids.push(id.clone());
                    }
                }
            }
            PmiView {
                id: format!("v{}", i + 1),
                name: non_empty(&v.name).unwrap_or_else(|| format!("View {}", i + 1)),
                direction: vec3(&v.direction, 0),
                up: vec3(&v.up, 0),
                projection: match v.projection {
                    1 => Some("parallel"),
                    2 => Some("central"),
                    _ => None,
                },
                item_ids,
            }
        })
        .collect();

    Some(PmiDocument {
        version: PMI_VERSION,
        unit: "mm",
        source_unit,
        items,
        faces: tree
            .faces
            .iter()
            .map(|m| PmiMesh {
                positions: r4_all(&m.positions),
                indices: m.indices.clone(),
            })
            .collect(),
        edges: tree.edges.iter().map(|e| r4_all(&e.points)).collect(),
        views,
    })
}

fn item(raw: &occt_bridge::PmiRaw, kind: usize, id: String) -> PmiItem {
    let modifiers: Vec<String> = raw
        .modifiers
        .iter()
        .filter(|m| !m.is_empty())
        .cloned()
        .collect();
    let dimension = (kind == 0).then(|| PmiDimension {
        kind: raw.type_name.clone(),
        value: some_if(raw.has_value, raw.value),
        upper: some_if(raw.has_plus_minus, raw.upper),
        lower: some_if(raw.has_plus_minus, raw.lower),
        upper_bound: some_if(raw.has_range, raw.upper_bound),
        lower_bound: some_if(raw.has_range, raw.lower_bound),
        fit_class: raw.has_fit.then(|| PmiFitClass {
            hole: raw.fit_hole,
            form_variance: raw.fit_variance.clone(),
            grade: raw.fit_grade.clone(),
        }),
        qualifier: non_empty(&raw.qualifier),
        decimals: raw.has_decimals.then_some(PmiDecimals {
            left: raw.decimals_left,
            right: raw.decimals_right,
        }),
        modifiers: modifiers.clone(),
        descriptions: raw.descriptions.clone(),
    });
    let tolerance = (kind == 1).then(|| PmiTolerance {
        kind: raw.type_name.clone(),
        value: some_if(raw.has_value, raw.value),
        zone_shape: non_empty(&raw.zone_shape),
        material: non_empty(&raw.material),
        zone_modifier: non_empty(&raw.zone_modifier),
        zone_modifier_value: some_if(raw.zone_modifier_value > 0.0, raw.zone_modifier_value),
        modifiers: modifiers.clone(),
        max_value: some_if(raw.max_value > 0.0, raw.max_value),
        datums: raw
            .datum_refs
            .iter()
            .enumerate()
            .filter(|(_, n)| !n.trim().is_empty())
            .map(|(i, n)| PmiDatumRef {
                name: n.trim().to_string(),
                modifiers: raw
                    .datum_ref_modifiers
                    .get(i)
                    .map(|m| {
                        m.split(',')
                            .filter(|s| !s.is_empty())
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default(),
            })
            .collect(),
    });
    let datum = (kind == 2).then(|| PmiDatum {
        name: raw.name.trim().to_string(),
        modifiers: modifiers.clone(),
        target: non_empty(&raw.datum_target),
    });
    PmiItem {
        id,
        kind: KINDS[kind],
        name: non_empty(&raw.name),
        dimension,
        tolerance,
        datum,
        lines: raw
            .lines
            .iter()
            .filter(|l| l.points.len() >= 6)
            .map(|l| r4_all(&l.points))
            .collect(),
        mesh: (!raw.mesh.indices.is_empty()).then(|| PmiMesh {
            positions: r4_all(&raw.mesh.positions),
            indices: raw.mesh.indices.clone(),
        }),
        plane: (raw.has_plane && raw.plane.len() == 9).then(|| PmiPlane {
            origin: vec3(&raw.plane, 0),
            normal: vec3(&raw.plane, 3),
            x_direction: vec3(&raw.plane, 6),
        }),
        text_position: (raw.has_text && raw.text.len() == 3).then(|| vec3(&raw.text, 0)),
        faces: raw.faces.clone(),
        edges: raw.edges.clone(),
    }
}

/// Serialize under [`MAX_PMI_JSON_BYTES`]. Over the cap the referenced-face
/// triangles and every item's face indices go (the highlight is lost, the
/// annotations stay); still over, an error.
pub fn to_json(doc: &PmiDocument) -> Result<Vec<u8>, String> {
    let bytes = serde_json::to_vec(doc).map_err(|e| e.to_string())?;
    if bytes.len() <= MAX_PMI_JSON_BYTES {
        return Ok(bytes);
    }
    let mut lean = doc.clone();
    lean.faces.clear();
    for item in &mut lean.items {
        item.faces.clear();
    }
    let bytes = serde_json::to_vec(&lean).map_err(|e| e.to_string())?;
    if bytes.len() <= MAX_PMI_JSON_BYTES {
        return Ok(bytes);
    }
    Err(format!(
        "pmi.json is {} bytes, over the {} byte cap",
        bytes.len(),
        MAX_PMI_JSON_BYTES
    ))
}
