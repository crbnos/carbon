//! STEP → graph.json (+ GLB) driver. Reads the OCCT tree from the occt-bridge,
//! assigns nodeIds, computes world bboxes, emits graph.json. Mirrors
//! `app/convert.py::convert_step`.

use crate::graph::{
    assign_node_ids, build_graph, compute_world_bboxes, count_leaves, count_triangles,
    detect_source_unit, AssemblyNode, PartMesh,
};
use nalgebra::Matrix4;
use serde_json::Value;

pub struct Conversion {
    pub graph: Value,
    pub glb: Vec<u8>,
    pub root: AssemblyNode,
    pub component_count: i64,
    pub triangles: i64,
}

#[derive(Debug)]
pub struct ConvertError {
    pub code: String,
    pub message: String,
}

impl ConvertError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        ConvertError {
            code: code.to_string(),
            message: message.into(),
        }
    }
}

fn to_node(tree: &occt_bridge::Tree, index: u64) -> AssemblyNode {
    let raw = &tree.nodes[index as usize];
    let mut transform = [0.0f64; 16];
    for (i, v) in raw.transform.iter().take(16).enumerate() {
        transform[i] = *v;
    }
    let mesh = if raw.has_mesh {
        let positions: Vec<[f32; 3]> = raw
            .vertices
            .chunks_exact(3)
            .map(|c| [c[0], c[1], c[2]])
            .collect();
        let indices: Vec<[u32; 3]> = raw
            .indices
            .chunks_exact(3)
            .map(|c| [c[0], c[1], c[2]])
            .collect();
        Some(PartMesh::new(positions, indices, raw.is_proxy))
    } else {
        None
    };
    let color = if raw.has_color && raw.color.len() == 4 {
        Some([raw.color[0], raw.color[1], raw.color[2], raw.color[3]])
    } else {
        None
    };
    let volume = if raw.has_volume {
        Some(raw.volume)
    } else {
        None
    };
    let children = raw.children.iter().map(|&c| to_node(tree, c)).collect();
    AssemblyNode {
        name: raw.name.clone(),
        product_name: raw.product_name.clone(),
        transform,
        is_assembly: raw.is_assembly,
        mesh,
        color,
        volume,
        children,
        node_id: String::new(),
        bbox_min: [0.0; 3],
        bbox_max: [0.0; 3],
    }
}

/// OCCT BinXCAF (`.xbf`) files start with the ASCII `BINFILE` magic. Content
/// sniff (not extension): transparent zstd means a `.step`-named temp can hold
/// xbf bytes, so the loader must be chosen by what's actually on disk.
fn is_xbf(path: &str) -> bool {
    use std::io::Read;
    let mut head = [0u8; 7];
    std::fs::File::open(path)
        .and_then(|mut f| f.read_exact(&mut head))
        .map(|_| &head == b"BINFILE")
        .unwrap_or(false)
}

/// Read a CAD file (STEP or BinXCAF `.xbf`, auto-detected) into the assembly tree
/// with nodeIds + world bboxes assigned, without emitting graph.json or GLB.
/// Shared by `convert_step` / `convert_xbf` and the planner. Both loaders share
/// the same OCCT tessellation walk, so a STEP and the `.xbf` derived from it
/// yield identical nodeIds + geometry.
pub fn build_tree(
    path: &str,
    linear_deflection: f64,
    angular_deflection: f64,
) -> Result<AssemblyNode, ConvertError> {
    let tree = if is_xbf(path) {
        occt_bridge::read_xbf(path, linear_deflection, angular_deflection)
    } else {
        occt_bridge::read_step(path, linear_deflection, angular_deflection)
    };
    tree_to_root(tree)
}

/// Shared post-processing for every OCCT reader: raw `Tree` → node tree with
/// nodeIds + world bboxes. Keeps STEP/XBF/IGES/BREP byte-identical downstream.
fn tree_to_root(tree: occt_bridge::Tree) -> Result<AssemblyNode, ConvertError> {
    if !tree.ok {
        return Err(ConvertError::new("READ_FAILED", tree.error.clone()));
    }
    let mut root = to_node(&tree, tree.root_index);
    assign_node_ids(&mut root);
    compute_world_bboxes(&mut root, &Matrix4::identity());
    Ok(root)
}

/// Write a STEP file as a compact lossless BinXCAF (`.xbf`) document — the
/// retained-raw form that replaces fat ASCII STEP in storage.
pub fn step_to_xbf(step_path: &str, xbf_path: &str) -> Result<(), ConvertError> {
    if !occt_bridge::step_to_xbf(step_path, xbf_path) {
        return Err(ConvertError::new(
            "READ_FAILED",
            "could not write XBF from STEP",
        ));
    }
    Ok(())
}

/// Convert an IGES file to graph.json + GLB. OCCT's XDE reader normalizes to mm
/// (same `xstep.cascade.unit` static as STEP), so `sourceUnit` is `mm`.
pub fn convert_iges(
    iges_path: &str,
    linear_deflection: f64,
    angular_deflection: f64,
) -> Result<Conversion, ConvertError> {
    let root = tree_to_root(occt_bridge::read_iges(
        iges_path,
        linear_deflection,
        angular_deflection,
    ))?;
    finish_conversion(root, "mm")
}

/// Convert a bare `.brep` shape file to graph.json + GLB. BREP carries no units
/// (values are model-space, conventionally mm) and no structure/names/colors.
pub fn convert_brep(
    brep_path: &str,
    linear_deflection: f64,
    angular_deflection: f64,
) -> Result<Conversion, ConvertError> {
    let root = tree_to_root(occt_bridge::read_brep(
        brep_path,
        linear_deflection,
        angular_deflection,
    ))?;
    finish_conversion(root, "mm")
}

fn finish_conversion(root: AssemblyNode, source_unit: &str) -> Result<Conversion, ConvertError> {
    let component_count = count_leaves(&root);
    let triangles = count_triangles(&root);
    let graph = build_graph(&root, source_unit);
    let glb = crate::glb::write_glb(&root);
    Ok(Conversion {
        graph,
        glb,
        root,
        component_count,
        triangles,
    })
}

/// Convert a BinXCAF (`.xbf`) document to graph.json + GLB. Geometry is already
/// mm (OCCT normalized units when the STEP was read into the xbf), so `sourceUnit`
/// is reported as `mm` — there is no STEP header to re-detect from.
pub fn convert_xbf(
    xbf_path: &str,
    linear_deflection: f64,
    angular_deflection: f64,
) -> Result<Conversion, ConvertError> {
    let root = build_tree(xbf_path, linear_deflection, angular_deflection)?;
    let component_count = count_leaves(&root);
    let triangles = count_triangles(&root);
    let graph = build_graph(&root, "mm");
    let glb = crate::glb::write_glb(&root);
    Ok(Conversion {
        graph,
        glb,
        root,
        component_count,
        triangles,
    })
}

pub fn convert_step(
    step_path: &str,
    step_text: &str,
    linear_deflection: f64,
    angular_deflection: f64,
) -> Result<Conversion, ConvertError> {
    let source_unit = detect_source_unit(step_text);
    let root = build_tree(step_path, linear_deflection, angular_deflection)?;
    let component_count = count_leaves(&root);
    let triangles = count_triangles(&root);
    let graph = build_graph(&root, &source_unit);
    let glb = crate::glb::write_glb(&root);
    Ok(Conversion {
        graph,
        glb,
        root,
        component_count,
        triangles,
    })
}
