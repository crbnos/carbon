//! Assembly tree, world bboxes, source-unit detection, and graph.json emission —
//! ported 1:1 from `app/convert.py`. Deterministic; no OCCT.

use crate::nodeid::{geometry_hash, node_id};
use nalgebra::{Matrix4, Vector3};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::OnceLock;

pub const GRAPH_VERSION: i64 = 1;
pub const OUTPUT_UNIT: &str = "mm";

pub const IDENTITY_4X4: [f64; 16] = [
    1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

#[derive(Debug, Clone)]
pub struct PartMesh {
    pub positions: Vec<[f32; 3]>, // part-local, mm
    pub indices: Vec<[u32; 3]>,
    pub geometry_hash: String,
    pub is_proxy: bool,
}

impl PartMesh {
    pub fn new(positions: Vec<[f32; 3]>, indices: Vec<[u32; 3]>, is_proxy: bool) -> Self {
        let geometry_hash = geometry_hash(&positions, &indices);
        PartMesh {
            positions,
            indices,
            geometry_hash,
            is_proxy,
        }
    }
}

#[derive(Debug, Clone)]
pub struct AssemblyNode {
    pub name: String,
    pub product_name: String,
    pub transform: [f64; 16], // local 4x4, column-major
    pub is_assembly: bool,
    pub mesh: Option<PartMesh>,
    pub color: Option<[f64; 4]>,
    pub volume: Option<f64>,
    pub children: Vec<AssemblyNode>,
    pub node_id: String,
    pub bbox_min: [f64; 3],
    pub bbox_max: [f64; 3],
}

impl AssemblyNode {
    fn hash_key(&self) -> &str {
        self.mesh
            .as_ref()
            .map(|m| m.geometry_hash.as_str())
            .unwrap_or("")
    }
}

// --- source unit detection ---------------------------------------------------

fn unit_names(name: &str) -> Option<&'static str> {
    match name {
        "INCH" => Some("inch"),
        "FOOT" => Some("foot"),
        "MILE" => Some("mile"),
        "YARD" => Some("yard"),
        _ => None,
    }
}

fn si_prefix(p: &str) -> &'static str {
    match p {
        "MILLI" => "mm",
        "CENTI" => "cm",
        "DECI" => "dm",
        "MICRO" => "um",
        "KILO" => "km",
        _ => "m",
    }
}

/// `_detect_source_unit`: best-effort read of the STEP declared length unit.
pub fn detect_source_unit(text: &str) -> String {
    static STMT: OnceLock<Regex> = OnceLock::new();
    static CONV: OnceLock<Regex> = OnceLock::new();
    static SI: OnceLock<Regex> = OnceLock::new();
    let stmt =
        STMT.get_or_init(|| Regex::new(r"(?s)\(([^;]*?LENGTH_UNIT\(\)[^;]*?)\)\s*;").unwrap());
    let conv = CONV.get_or_init(|| Regex::new(r"CONVERSION_BASED_UNIT\s*\(\s*'([^']+)'").unwrap());
    let si =
        SI.get_or_init(|| Regex::new(r"SI_UNIT\s*\(\s*(?:\.(\w+)\.|\$)\s*,\s*\.METRE\.").unwrap());

    // Lossy decoding expands invalid bytes to 3-byte `�`, so a byte-capped read
    // can decode to MORE than `cap` bytes — floor to a char boundary or the
    // slice panics mid-replacement-char (seen on binary xbf heads).
    let cap = 32 * 1024 * 1024;
    let text = if text.len() > cap {
        let mut end = cap;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        &text[..end]
    } else {
        text
    };

    for m in stmt.captures_iter(text) {
        let body = &m[1];
        if let Some(c) = conv.captures(body) {
            let name = c[1].to_uppercase();
            return unit_names(&name)
                .map(|s| s.to_string())
                .unwrap_or_else(|| c[1].to_lowercase());
        }
        if let Some(c) = si.captures(body) {
            let prefix = c.get(1).map(|g| g.as_str()).unwrap_or("");
            return si_prefix(prefix).to_string();
        }
    }
    OUTPUT_UNIT.to_string()
}

// --- stable node IDs ---------------------------------------------------------

pub fn assign_node_ids(root: &mut AssemblyNode) {
    root.node_id = node_id(root.hash_key(), "", 0);
    assign_child_ids(root, "");
}

fn assign_child_ids(node: &mut AssemblyNode, parent_path: &str) {
    let path = if parent_path.is_empty() {
        node.product_name.clone()
    } else {
        format!("{parent_path}/{}", node.product_name)
    };
    let mut ordinals: HashMap<String, usize> = HashMap::new();
    for child in &mut node.children {
        let key = child.hash_key().to_string();
        let ordinal = *ordinals.get(&key).unwrap_or(&0);
        ordinals.insert(key.clone(), ordinal + 1);
        child.node_id = node_id(&key, &path, ordinal);
        assign_child_ids(child, &path);
    }
}

// --- world-space bounding boxes ----------------------------------------------

pub fn compute_world_bboxes(node: &mut AssemblyNode, parent_world: &Matrix4<f64>) {
    let local = Matrix4::from_column_slice(&node.transform);
    let world = parent_world * local;
    let r = world.fixed_view::<3, 3>(0, 0).into_owned();
    let t = Vector3::new(world[(0, 3)], world[(1, 3)], world[(2, 3)]);

    if let Some(mesh) = &node.mesh {
        if !mesh.positions.is_empty() {
            let mut lo = Vector3::new(f64::INFINITY, f64::INFINITY, f64::INFINITY);
            let mut hi = Vector3::new(f64::NEG_INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
            for p in &mesh.positions {
                let v = Vector3::new(p[0] as f64, p[1] as f64, p[2] as f64);
                let w = r * v + t;
                lo = lo.inf(&w);
                hi = hi.sup(&w);
            }
            node.bbox_min = [lo[0], lo[1], lo[2]];
            node.bbox_max = [hi[0], hi[1], hi[2]];
        } else {
            node.bbox_min = [t[0], t[1], t[2]];
            node.bbox_max = [t[0], t[1], t[2]];
        }
    } else {
        node.bbox_min = [t[0], t[1], t[2]];
        node.bbox_max = [t[0], t[1], t[2]];
    }

    for child in &mut node.children {
        compute_world_bboxes(child, &world);
    }

    if !node.children.is_empty() {
        let mut lo = Vector3::new(f64::INFINITY, f64::INFINITY, f64::INFINITY);
        let mut hi = Vector3::new(f64::NEG_INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
        for c in &node.children {
            lo = lo.inf(&Vector3::new(c.bbox_min[0], c.bbox_min[1], c.bbox_min[2]));
            hi = hi.sup(&Vector3::new(c.bbox_max[0], c.bbox_max[1], c.bbox_max[2]));
        }
        let has_mesh = node
            .mesh
            .as_ref()
            .map(|m| !m.positions.is_empty())
            .unwrap_or(false);
        if has_mesh {
            lo = lo.inf(&Vector3::new(
                node.bbox_min[0],
                node.bbox_min[1],
                node.bbox_min[2],
            ));
            hi = hi.sup(&Vector3::new(
                node.bbox_max[0],
                node.bbox_max[1],
                node.bbox_max[2],
            ));
        }
        node.bbox_min = [lo[0], lo[1], lo[2]];
        node.bbox_max = [hi[0], hi[1], hi[2]];
    }
}

// --- graph.json --------------------------------------------------------------

pub fn count_leaves(node: &AssemblyNode) -> i64 {
    if !node.is_assembly {
        return 1;
    }
    node.children.iter().map(count_leaves).sum()
}

pub fn count_triangles(node: &AssemblyNode) -> i64 {
    let own = node
        .mesh
        .as_ref()
        .map(|m| m.indices.len() as i64)
        .unwrap_or(0);
    own + node.children.iter().map(count_triangles).sum::<i64>()
}

pub fn node_to_dict(node: &AssemblyNode) -> Value {
    json!({
        "nodeId": node.node_id,
        "name": node.name,
        "isAssembly": node.is_assembly,
        "geometryHash": node.mesh.as_ref().map(|m| m.geometry_hash.clone()),
        "transform": node.transform.to_vec(),
        "bbox": {"min": node.bbox_min.to_vec(), "max": node.bbox_max.to_vec()},
        "volume": if node.is_assembly { Value::Null } else { node.volume.map(|v| json!(v)).unwrap_or(Value::Null) },
        "color": node.color.map(|c| c.to_vec()),
        "children": node.children.iter().map(node_to_dict).collect::<Vec<_>>(),
    })
}

pub fn build_graph(root: &AssemblyNode, source_unit: &str) -> Value {
    json!({
        "version": GRAPH_VERSION,
        "unit": OUTPUT_UNIT,
        "sourceUnit": source_unit,
        "componentCount": count_leaves(root),
        "root": node_to_dict(root),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_unit_detection() {
        // Cases from the former Python service's test_source_unit_detection.
        assert_eq!(
            detect_source_unit("DATA;\n#41=( CONVERSION_BASED_UNIT('INCH',#38) LENGTH_UNIT() NAMED_UNIT(#40) );\nENDSEC;"),
            "inch"
        );
        assert_eq!(
            detect_source_unit(
                "DATA;\n#41=( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT($,.METRE.) );\nENDSEC;"
            ),
            "m"
        );
        assert_eq!(detect_source_unit("DATA;\nENDSEC;"), "mm");
        // Extra: millimetre SI unit.
        assert_eq!(
            detect_source_unit("#5=( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );"),
            "mm"
        );
    }

    #[test]
    fn source_unit_truncation_respects_char_boundaries() {
        // A lossy-decoded binary head can exceed the 32MB byte cap (invalid
        // bytes expand to 3-byte `�`) with a multi-byte char straddling the cap
        // — slicing at the raw cap used to panic (prod convert on xbf raws).
        let cap = 32 * 1024 * 1024;
        let mut text = "a".repeat(cap - 1);
        text.push('\u{FFFD}'); // bytes cap-1..cap+2 — cap is not a boundary
        assert_eq!(detect_source_unit(&text), "mm");
    }
}
