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

/// Read a STEP file into the assembly tree with nodeIds + world bboxes assigned,
/// without emitting graph.json or GLB. Shared by `convert_step` and the planner.
pub fn build_tree(
    step_path: &str,
    linear_deflection: f64,
    angular_deflection: f64,
) -> Result<AssemblyNode, ConvertError> {
    let tree = occt_bridge::read_step(step_path, linear_deflection, angular_deflection);
    if !tree.ok {
        return Err(ConvertError::new("READ_FAILED", tree.error.clone()));
    }
    let mut root = to_node(&tree, tree.root_index);
    assign_node_ids(&mut root);
    compute_world_bboxes(&mut root, &Matrix4::identity());
    Ok(root)
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
