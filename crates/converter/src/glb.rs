//! Write a GLB from the tessellated assembly tree — port of `app/glb.py`. The
//! glTF node tree mirrors graph.json 1:1, every node carries `extras.nodeId`,
//! identical parts (same geometryHash) share one mesh, materials dedupe by RGBA.
//! We write the container ourselves (not byte-identical to pygltflib, but the
//! same node/mesh/material contract the viewer depends on).

use crate::graph::{AssemblyNode, PartMesh};
use serde_json::{json, Value};
use std::collections::HashMap;

const ARRAY_BUFFER: i64 = 34962;
const ELEMENT_ARRAY_BUFFER: i64 = 34963;
const FLOAT: i64 = 5126;
const UNSIGNED_INT: i64 = 5125;
const DEFAULT_COLOR: [f64; 4] = [0.65, 0.65, 0.65, 1.0];
const IDENTITY: [f64; 16] = [
    1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

struct Builder {
    blob: Vec<u8>,
    buffer_views: Vec<Value>,
    accessors: Vec<Value>,
    meshes: Vec<Value>,
    materials: Vec<Value>,
    nodes: Vec<Value>,
    mesh_by_hash: HashMap<String, usize>,
    material_by_color: HashMap<String, usize>,
}

impl Builder {
    fn new() -> Self {
        Builder {
            blob: Vec::new(),
            buffer_views: Vec::new(),
            accessors: Vec::new(),
            meshes: Vec::new(),
            materials: Vec::new(),
            nodes: Vec::new(),
            mesh_by_hash: HashMap::new(),
            material_by_color: HashMap::new(),
        }
    }

    fn append_buffer_view(&mut self, data: &[u8], target: i64) -> usize {
        while self.blob.len() % 4 != 0 {
            self.blob.push(0);
        }
        let offset = self.blob.len();
        self.blob.extend_from_slice(data);
        self.buffer_views.push(json!({
            "buffer": 0, "byteOffset": offset, "byteLength": data.len(), "target": target
        }));
        self.buffer_views.len() - 1
    }

    fn material(&mut self, color: Option<[f64; 4]>) -> usize {
        let rgba = color.unwrap_or(DEFAULT_COLOR);
        let key = format!("{:?}", rgba);
        if let Some(&i) = self.material_by_color.get(&key) {
            return i;
        }
        self.materials.push(json!({
            "pbrMetallicRoughness": {
                "baseColorFactor": rgba.to_vec(),
                "metallicFactor": 0.1,
                "roughnessFactor": 0.8
            },
            "alphaMode": if rgba[3] < 1.0 { "BLEND" } else { "OPAQUE" },
            "doubleSided": false
        }));
        let i = self.materials.len() - 1;
        self.material_by_color.insert(key, i);
        i
    }

    fn mesh(&mut self, part: &PartMesh, color: Option<[f64; 4]>, name: &str) -> usize {
        if let Some(&i) = self.mesh_by_hash.get(&part.geometry_hash) {
            return i;
        }
        let positions = &part.positions;
        let normals = vertex_normals(positions, &part.indices);

        let mut pos_bytes = Vec::with_capacity(positions.len() * 12);
        let mut min = [f32::INFINITY; 3];
        let mut max = [f32::NEG_INFINITY; 3];
        for p in positions {
            for k in 0..3 {
                pos_bytes.extend_from_slice(&p[k].to_le_bytes());
                min[k] = min[k].min(p[k]);
                max[k] = max[k].max(p[k]);
            }
        }
        let mut nrm_bytes = Vec::with_capacity(normals.len() * 12);
        for n in &normals {
            for k in 0..3 {
                nrm_bytes.extend_from_slice(&n[k].to_le_bytes());
            }
        }
        let mut idx_bytes = Vec::with_capacity(part.indices.len() * 12);
        let mut idx_count = 0usize;
        for tri in &part.indices {
            for &i in tri {
                idx_bytes.extend_from_slice(&i.to_le_bytes());
                idx_count += 1;
            }
        }

        let pos_view = self.append_buffer_view(&pos_bytes, ARRAY_BUFFER);
        let nrm_view = self.append_buffer_view(&nrm_bytes, ARRAY_BUFFER);
        let idx_view = self.append_buffer_view(&idx_bytes, ELEMENT_ARRAY_BUFFER);

        self.accessors.push(json!({
            "bufferView": pos_view, "componentType": FLOAT, "count": positions.len(),
            "type": "VEC3", "min": min.to_vec(), "max": max.to_vec()
        }));
        let pos_acc = self.accessors.len() - 1;
        self.accessors.push(json!({
            "bufferView": nrm_view, "componentType": FLOAT, "count": normals.len(), "type": "VEC3"
        }));
        let nrm_acc = self.accessors.len() - 1;
        self.accessors.push(json!({
            "bufferView": idx_view, "componentType": UNSIGNED_INT, "count": idx_count, "type": "SCALAR"
        }));
        let idx_acc = self.accessors.len() - 1;

        let material = self.material(color);
        self.meshes.push(json!({
            "name": name,
            "primitives": [{
                "attributes": {"POSITION": pos_acc, "NORMAL": nrm_acc},
                "indices": idx_acc,
                "material": material
            }]
        }));
        let i = self.meshes.len() - 1;
        self.mesh_by_hash.insert(part.geometry_hash.clone(), i);
        i
    }

    fn add_node(&mut self, node: &AssemblyNode) -> usize {
        let mut gltf_node = json!({"name": node.name, "extras": {"nodeId": node.node_id}});
        if node.transform != IDENTITY {
            gltf_node["matrix"] = json!(node.transform.to_vec());
        }
        if let Some(mesh) = &node.mesh {
            if !mesh.positions.is_empty() {
                let m = self.mesh(mesh, node.color, &node.product_name);
                gltf_node["mesh"] = json!(m);
            }
        }
        self.nodes.push(gltf_node);
        let index = self.nodes.len() - 1;
        let children: Vec<usize> = node.children.iter().map(|c| self.add_node(c)).collect();
        if !children.is_empty() {
            self.nodes[index]["children"] = json!(children);
        }
        index
    }
}

/// Area-weighted smooth vertex normals — port of `_vertex_normals`.
fn vertex_normals(positions: &[[f32; 3]], indices: &[[u32; 3]]) -> Vec<[f32; 3]> {
    let mut normals = vec![[0.0f64; 3]; positions.len()];
    for tri in indices {
        let a = positions[tri[0] as usize];
        let b = positions[tri[1] as usize];
        let c = positions[tri[2] as usize];
        let ab = [
            (b[0] - a[0]) as f64,
            (b[1] - a[1]) as f64,
            (b[2] - a[2]) as f64,
        ];
        let ac = [
            (c[0] - a[0]) as f64,
            (c[1] - a[1]) as f64,
            (c[2] - a[2]) as f64,
        ];
        let fn_ = [
            ab[1] * ac[2] - ab[2] * ac[1],
            ab[2] * ac[0] - ab[0] * ac[2],
            ab[0] * ac[1] - ab[1] * ac[0],
        ];
        for &v in tri {
            for k in 0..3 {
                normals[v as usize][k] += fn_[k];
            }
        }
    }
    normals
        .into_iter()
        .map(|n| {
            let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
            let l = if len == 0.0 { 1.0 } else { len };
            [(n[0] / l) as f32, (n[1] / l) as f32, (n[2] / l) as f32]
        })
        .collect()
}

/// Write the GLB container (binary glTF) for the assembly tree.
pub fn write_glb(root: &AssemblyNode) -> Vec<u8> {
    let mut b = Builder::new();
    let root_index = b.add_node(root);

    let mut gltf = json!({
        "asset": {"version": "2.0", "generator": "carbon-assembler"},
        "scene": 0,
        "scenes": [{"nodes": [root_index]}],
        "nodes": b.nodes,
        "meshes": b.meshes,
        "accessors": b.accessors,
        "bufferViews": b.buffer_views,
        "materials": b.materials,
    });
    if !b.blob.is_empty() {
        gltf["buffers"] = json!([{"byteLength": b.blob.len()}]);
    }

    let mut json_bytes = serde_json::to_vec(&gltf).unwrap();
    while json_bytes.len() % 4 != 0 {
        json_bytes.push(b' ');
    }
    let mut bin = b.blob;
    while bin.len() % 4 != 0 {
        bin.push(0);
    }

    let total = 12 + 8 + json_bytes.len() + if bin.is_empty() { 0 } else { 8 + bin.len() };
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(b"glTF");
    out.extend_from_slice(&2u32.to_le_bytes());
    out.extend_from_slice(&(total as u32).to_le_bytes());
    // JSON chunk
    out.extend_from_slice(&(json_bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(b"JSON");
    out.extend_from_slice(&json_bytes);
    // BIN chunk
    if !bin.is_empty() {
        out.extend_from_slice(&(bin.len() as u32).to_le_bytes());
        out.extend_from_slice(&[b'B', b'I', b'N', 0]);
        out.extend_from_slice(&bin);
    }
    out
}
