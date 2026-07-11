//! Core planner data structures, mirroring `app/plan.py`'s dataclasses.

use crate::corpus::RawComponent;
use cxx::UniquePtr;
use nalgebra::Vector3;
use std::sync::{Arc, OnceLock};

/// A built FCL BVH, safe to share read-only across threads. `BVHModel` is
/// immutable after `endModel` (the only builder), and every FCL query
/// (`collide`/`distance`) reads it without mutation — cxx `UniquePtr` is a plain
/// owning pointer, so concurrent `&`-access for read-only collision is sound.
/// This is what lets the greedy candidate sweeps run on multiple threads (each
/// thread builds its own `Manager` over these shared BVHs).
pub struct SharedBvh(UniquePtr<collision::Bvh>);
// SAFETY: read-only shared access to an immutable BVHModel; see the type doc.
unsafe impl Send for SharedBvh {}
unsafe impl Sync for SharedBvh {}
impl std::ops::Deref for SharedBvh {
    type Target = collision::Bvh;
    fn deref(&self) -> &collision::Bvh {
        &self.0
    }
}

/// A triangle mesh in world space.
#[derive(Debug, Clone)]
pub struct Mesh {
    pub vertices: Vec<Vector3<f64>>,
    pub faces: Vec<[u32; 3]>,
}

impl Mesh {
    pub fn from_flat(vertices: &[f64], faces: &[u32]) -> Self {
        let verts = vertices
            .chunks_exact(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();
        let faces = faces.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect();
        Mesh {
            vertices: verts,
            faces,
        }
    }

    pub fn bbox(&self) -> (Vector3<f64>, Vector3<f64>) {
        let mut lo = Vector3::new(f64::INFINITY, f64::INFINITY, f64::INFINITY);
        let mut hi = Vector3::new(f64::NEG_INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
        for v in &self.vertices {
            lo = lo.inf(v);
            hi = hi.sup(v);
        }
        (lo, hi)
    }

    /// Flat row-major vertex coordinates for BVH construction.
    pub fn flat_vertices(&self) -> Vec<f64> {
        let mut out = Vec::with_capacity(self.vertices.len() * 3);
        for v in &self.vertices {
            out.push(v[0]);
            out.push(v[1]);
            out.push(v[2]);
        }
        out
    }

    /// Flat row-major triangle indices for BVH construction.
    pub fn flat_faces(&self) -> Vec<u32> {
        let mut out = Vec::with_capacity(self.faces.len() * 3);
        for f in &self.faces {
            out.extend_from_slice(f);
        }
        out
    }

    /// Concatenate two meshes (triangle-soup union), reindexing faces.
    pub fn concatenate(meshes: &[&Mesh]) -> Mesh {
        let mut vertices = Vec::new();
        let mut faces = Vec::new();
        let mut offset = 0u32;
        for m in meshes {
            vertices.extend_from_slice(&m.vertices);
            for f in &m.faces {
                faces.push([f[0] + offset, f[1] + offset, f[2] + offset]);
            }
            offset += m.vertices.len() as u32;
        }
        Mesh { vertices, faces }
    }
}

/// A leaf part (or merged unit) in world space — mirrors `_Component`.
#[derive(Clone)]
pub struct Component {
    pub node_id: String,
    pub name: String,
    pub mesh: Mesh,
    pub bbox_min: Vector3<f64>,
    pub bbox_max: Vector3<f64>,
    pub is_proxy: bool,
    /// Seated contact normals with neighbors (filled by `_plan_parts`).
    pub contact_normals: Vec<Vector3<f64>>,
    /// Sandwich seated-interference allowances (nodeId -> mm) and their axes.
    pub seated_allowance: std::collections::HashMap<String, f64>,
    pub seated_allowance_axes: std::collections::HashMap<String, Vector3<f64>>,
    /// Explicit material-volume override (merged units set this to the member
    /// sum; mirrors `mesh._carbon_volume`). When `None`, `part_volume` computes
    /// and memoizes into `vol_cache`.
    pub cached_volume: Option<f64>,
    /// Lazily-built FCL BVH, shared across clones (mirrors `mesh._carbon_bvh`).
    bvh: OnceLock<Arc<SharedBvh>>,
    /// Memoized `part_volume` result (the watertight test builds a full-mesh
    /// edge map — costly, and called repeatedly during greedy sorting).
    pub(crate) vol_cache: OnceLock<f64>,
    /// Memoized `symmetry_axis_kind` result — a LAPACK SVD of the vertex cloud,
    /// pure in the mesh, recomputed once per candidate per greedy iteration
    /// without this cache. `None`-vs-cached distinguished by the outer Option.
    pub(crate) sym_axis_cache: OnceLock<Option<(Vector3<f64>, FastenerKind)>>,
}

impl Component {
    pub fn new(
        node_id: String,
        name: String,
        mesh: Mesh,
        bbox_min: Vector3<f64>,
        bbox_max: Vector3<f64>,
        is_proxy: bool,
    ) -> Self {
        Component {
            node_id,
            name,
            mesh,
            bbox_min,
            bbox_max,
            is_proxy,
            contact_normals: Vec::new(),
            seated_allowance: Default::default(),
            seated_allowance_axes: Default::default(),
            cached_volume: None,
            bvh: OnceLock::new(),
            vol_cache: OnceLock::new(),
            sym_axis_cache: OnceLock::new(),
        }
    }

    pub fn from_raw(raw: &RawComponent) -> Self {
        let mesh = Mesh::from_flat(&raw.vertices, &raw.faces);
        let (lo, hi) = mesh.bbox();
        Component::new(raw.node_id.clone(), raw.name.clone(), mesh, lo, hi, raw.is_proxy)
    }

    /// The part's FCL BVH, built once and cached (mirrors `_mesh_bvh`). The
    /// handle is `Arc<SharedBvh>` so it can be shared read-only across the
    /// parallel greedy sweeps.
    pub fn bvh(&self) -> Arc<SharedBvh> {
        self.bvh
            .get_or_init(|| {
                let verts = self.mesh.flat_vertices();
                let faces = self.mesh.flat_faces();
                Arc::new(SharedBvh(collision::new_bvh(&verts, &faces)))
            })
            .clone()
    }
}

/// Classified fastener — mirrors `_FastenerInfo`.
#[derive(Debug, Clone)]
pub struct FastenerInfo {
    pub axis: Vector3<f64>,
    pub mates: std::collections::HashMap<String, f64>,
    pub kind: Option<FastenerKind>,
    pub shank_radius: Option<f64>,
    pub sliding: std::collections::HashMap<String, f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FastenerKind {
    Rod,
    Disc,
}

/// A planned removal/insertion — mirrors `PlannedComponent`.
#[derive(Debug, Clone)]
pub struct PlannedComponent {
    pub node_id: String,
    pub motion: Motion,
    pub confidence: Option<String>,
    pub removal_direction: Option<[f64; 3]>,
    pub blocked_by: Vec<String>,
    pub tier: Option<String>,
    pub verified: bool,
    pub group_id: Option<String>,
}

/// An insertion motion (removal reversed), matching the plan.json contract.
#[derive(Debug, Clone, PartialEq)]
pub enum Motion {
    None,
    Linear {
        direction: [f64; 3],
        distance: f64,
    },
    L {
        segments: Vec<MotionSegment>,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct MotionSegment {
    pub direction: [f64; 3],
    pub distance: f64,
}

impl Motion {
    pub fn type_str(&self) -> &'static str {
        match self {
            Motion::None => "none",
            Motion::Linear { .. } => "linear",
            Motion::L { .. } => "L",
        }
    }
}
