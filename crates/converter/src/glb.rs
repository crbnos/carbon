//! Write a GLB from the tessellated assembly tree — port of `app/glb.py`. The
//! glTF node tree mirrors graph.json 1:1, every node carries `extras.nodeId`,
//! identical parts (same geometryHash) share one mesh, materials dedupe by RGBA.
//! The container is assembled by the `gltf` crate (`gltf::binary::Glb`); we build
//! the typed `gltf::json::Root` rather than hand-writing JSON.

use crate::graph::{AssemblyNode, PartMesh};
use gltf::json;
use json::validation::{Checked::Valid, USize64};
use std::borrow::Cow;
use std::collections::HashMap;

const DEFAULT_COLOR: [f32; 4] = [0.65, 0.65, 0.65, 1.0];
const IDENTITY: [f64; 16] = [
    1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

struct Builder {
    blob: Vec<u8>,
    buffer_views: Vec<json::buffer::View>,
    accessors: Vec<json::Accessor>,
    meshes: Vec<json::Mesh>,
    materials: Vec<json::Material>,
    nodes: Vec<json::Node>,
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

    fn append_buffer_view(&mut self, data: &[u8], target: json::buffer::Target) -> usize {
        while self.blob.len() % 4 != 0 {
            self.blob.push(0);
        }
        let offset = self.blob.len();
        self.blob.extend_from_slice(data);
        self.buffer_views.push(json::buffer::View {
            buffer: json::Index::new(0),
            byte_length: USize64::from(data.len()),
            byte_offset: Some(USize64::from(offset)),
            byte_stride: None,
            target: Some(Valid(target)),
            name: None,
            extensions: Default::default(),
            extras: Default::default(),
        });
        self.buffer_views.len() - 1
    }

    fn material(&mut self, color: Option<[f64; 4]>) -> usize {
        let rgba = color.map_or(DEFAULT_COLOR, |c| {
            [c[0] as f32, c[1] as f32, c[2] as f32, c[3] as f32]
        });
        let key = format!("{:?}", rgba);
        if let Some(&i) = self.material_by_color.get(&key) {
            return i;
        }
        self.materials.push(json::Material {
            alpha_mode: Valid(if rgba[3] < 1.0 {
                json::material::AlphaMode::Blend
            } else {
                json::material::AlphaMode::Opaque
            }),
            double_sided: false,
            pbr_metallic_roughness: json::material::PbrMetallicRoughness {
                base_color_factor: json::material::PbrBaseColorFactor(rgba),
                metallic_factor: json::material::StrengthFactor(0.1),
                roughness_factor: json::material::StrengthFactor(0.8),
                ..Default::default()
            },
            ..Default::default()
        });
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

        let pos_view = self.append_buffer_view(&pos_bytes, json::buffer::Target::ArrayBuffer);
        let nrm_view = self.append_buffer_view(&nrm_bytes, json::buffer::Target::ArrayBuffer);
        let idx_view =
            self.append_buffer_view(&idx_bytes, json::buffer::Target::ElementArrayBuffer);

        self.accessors.push(json::Accessor {
            buffer_view: Some(json::Index::new(pos_view as u32)),
            byte_offset: Some(USize64(0)),
            count: USize64::from(positions.len()),
            component_type: Valid(json::accessor::GenericComponentType(
                json::accessor::ComponentType::F32,
            )),
            type_: Valid(json::accessor::Type::Vec3),
            min: Some(serde_json::json!(min.to_vec())),
            max: Some(serde_json::json!(max.to_vec())),
            name: None,
            normalized: false,
            sparse: None,
            extensions: Default::default(),
            extras: Default::default(),
        });
        let pos_acc = self.accessors.len() - 1;
        self.accessors.push(json::Accessor {
            buffer_view: Some(json::Index::new(nrm_view as u32)),
            byte_offset: Some(USize64(0)),
            count: USize64::from(normals.len()),
            component_type: Valid(json::accessor::GenericComponentType(
                json::accessor::ComponentType::F32,
            )),
            type_: Valid(json::accessor::Type::Vec3),
            min: None,
            max: None,
            name: None,
            normalized: false,
            sparse: None,
            extensions: Default::default(),
            extras: Default::default(),
        });
        let nrm_acc = self.accessors.len() - 1;
        self.accessors.push(json::Accessor {
            buffer_view: Some(json::Index::new(idx_view as u32)),
            byte_offset: Some(USize64(0)),
            count: USize64::from(idx_count),
            component_type: Valid(json::accessor::GenericComponentType(
                json::accessor::ComponentType::U32,
            )),
            type_: Valid(json::accessor::Type::Scalar),
            min: None,
            max: None,
            name: None,
            normalized: false,
            sparse: None,
            extensions: Default::default(),
            extras: Default::default(),
        });
        let idx_acc = self.accessors.len() - 1;

        let material = self.material(color);
        let mut attributes = std::collections::BTreeMap::new();
        attributes.insert(
            Valid(json::mesh::Semantic::Positions),
            json::Index::new(pos_acc as u32),
        );
        attributes.insert(
            Valid(json::mesh::Semantic::Normals),
            json::Index::new(nrm_acc as u32),
        );
        self.meshes.push(json::Mesh {
            name: Some(name.to_string()),
            primitives: vec![json::mesh::Primitive {
                attributes,
                indices: Some(json::Index::new(idx_acc as u32)),
                material: Some(json::Index::new(material as u32)),
                mode: Valid(json::mesh::Mode::Triangles),
                targets: None,
                extensions: Default::default(),
                extras: Default::default(),
            }],
            weights: None,
            extensions: Default::default(),
            extras: Default::default(),
        });
        let i = self.meshes.len() - 1;
        self.mesh_by_hash.insert(part.geometry_hash.clone(), i);
        i
    }

    fn add_node(&mut self, node: &AssemblyNode) -> usize {
        let matrix = if node.transform != IDENTITY {
            let mut m = [0.0f32; 16];
            for k in 0..16 {
                m[k] = node.transform[k] as f32;
            }
            Some(m)
        } else {
            None
        };
        let mesh = node
            .mesh
            .as_ref()
            .filter(|m| !m.positions.is_empty())
            .map(|m| {
                let i = self.mesh(m, node.color, &node.product_name);
                json::Index::new(i as u32)
            });
        let extras =
            serde_json::value::to_raw_value(&serde_json::json!({ "nodeId": node.node_id })).ok();

        self.nodes.push(json::Node {
            name: Some(node.name.clone()),
            matrix,
            mesh,
            extras,
            ..Default::default()
        });
        let index = self.nodes.len() - 1;
        let children: Vec<json::Index<json::Node>> = node
            .children
            .iter()
            .map(|c| json::Index::new(self.add_node(c) as u32))
            .collect();
        if !children.is_empty() {
            self.nodes[index].children = Some(children);
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

    let buffers = if b.blob.is_empty() {
        Vec::new()
    } else {
        vec![json::Buffer {
            byte_length: USize64::from(b.blob.len()),
            name: None,
            uri: None,
            extensions: Default::default(),
            extras: Default::default(),
        }]
    };

    let gltf_root = json::Root {
        asset: json::Asset {
            version: "2.0".to_string(),
            generator: Some("carbon-assembler".to_string()),
            ..Default::default()
        },
        scene: Some(json::Index::new(0)),
        scenes: vec![json::Scene {
            nodes: vec![json::Index::new(root_index as u32)],
            name: None,
            extensions: Default::default(),
            extras: Default::default(),
        }],
        nodes: b.nodes,
        meshes: b.meshes,
        accessors: b.accessors,
        buffer_views: b.buffer_views,
        materials: b.materials,
        buffers,
        ..Default::default()
    };

    let json_bytes = json::serialize::to_vec(&gltf_root).unwrap();
    let bin = if b.blob.is_empty() {
        None
    } else {
        Some(Cow::Owned(b.blob))
    };

    let glb = gltf::binary::Glb {
        header: gltf::binary::Header {
            magic: *b"glTF",
            version: 2,
            length: 0,
        },
        json: Cow::Owned(json_bytes),
        bin,
    };
    glb.to_vec().unwrap()
}
