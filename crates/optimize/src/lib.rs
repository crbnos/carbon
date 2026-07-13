//! Mesh optimisation for GLB assets. Parses a binary glTF, runs meshopt on every
//! mesh primitive (weld/remap → vertex-cache → overdraw → vertex-fetch, plus an
//! optional simplify ladder), and re-encodes the GLB. The node tree, materials,
//! and `extras` (e.g. `nodeId`) are preserved verbatim — only the geometry
//! buffers are rebuilt.
//!
//! Phase 1 targets geometry-only GLBs (mesh POSITION/NORMAL/TEXCOORD_0 +
//! indices) — the converter's output and the assembly pipeline. Embedded image
//! bufferViews are rejected with a clear error rather than silently corrupted;
//! texture support is a later extension.

use gltf::json;
use json::validation::Checked::Valid;
use json::validation::USize64;
use std::borrow::Cow;
use std::mem::size_of;

mod codec;
pub use codec::Codec;

#[derive(Debug, Clone)]
pub struct Options {
    /// Transmission codec for the output buffers.
    pub codec: Codec,
    /// Simplify target as a fraction of the input triangle count (`None` = no
    /// ratio target; simplification then runs only if `tolerance` is set, taking
    /// it as far as the tolerance allows). The ladder that walks several fractions
    /// lives in the caller; this runs a single ratio.
    pub simplify: Option<f32>,
    /// **The quality/perf knob.** Max simplify error in source units (mm): the
    /// simplified surface never deviates more than this from the original.
    /// Converted per-mesh from meshopt's normalized error via `simplify_scale`.
    /// Larger = coarser/smaller/faster, smaller = higher precision. `None` =
    /// ratio-only (hit the simplify target regardless of error).
    pub tolerance: Option<f32>,
    /// **Auto mode** — a scale-invariant normalized error budget (fraction of each
    /// mesh's extent, e.g. `0.005` = 0.5%) used only when neither `simplify` nor
    /// `tolerance` is given. meshopt then reduces every mesh maximally within this
    /// bound: adaptive per-mesh (a cube stays a cube, a dense surface decimates),
    /// scale-invariant across models. `None` = no auto simplification (lossless —
    /// convert uses this so geometry is only welded/reordered/encoded).
    pub auto_error: Option<f32>,
    /// Use `simplify_sloppy` (topology-breaking, faster/smaller) instead of the
    /// error-bounded `simplify`.
    pub simplify_aggressive: bool,
    /// Draco quantization bits (position, normal, texcoord) — the Draco quality/
    /// perf knob. Fewer bits = smaller + coarser. `Codec::Draco` only.
    pub draco_bits: (i32, i32, i32),
    /// Quantize normals to `i16` (SHORT, normalized) — core glTF, no node
    /// transform, halves normal bytes, visually lossless. `none`/`meshopt` codecs
    /// (Draco quantizes via `draco_bits`). Off by default so convert stays exact.
    pub quantize_normals: bool,
    /// Merge a mesh's primitives that share a material (and attribute set) into
    /// one — fewer draw calls, fewer accessors/JSON, smaller. Within a mesh only,
    /// so node/part identity (and assembly animation) is untouched.
    pub merge_primitives: bool,
    pub weld: bool,
    pub reorder: bool,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            codec: Codec::Meshopt,
            simplify: None,
            tolerance: None,
            auto_error: None,
            simplify_aggressive: false,
            draco_bits: (DRACO_POS_BITS, DRACO_NORM_BITS, DRACO_UV_BITS),
            quantize_normals: false,
            merge_primitives: false,
            weld: true,
            reorder: true,
        }
    }
}

/// Default auto-mode error budget: 0.5% of each mesh's extent — a balanced
/// perf/quality mix. Tunable per request; `crates/optimize` never simplifies
/// unless the caller opts in (explicit ratio/tolerance or a non-None auto_error).
pub const DEFAULT_AUTO_ERROR: f32 = 0.005;

/// Below this triangle count auto mode skips simplification — trivial meshes
/// aren't worth reducing and low-poly geometry risks visible artifacts.
const AUTO_TRI_FLOOR: usize = 256;

#[derive(Debug, Default, Clone)]
pub struct Stats {
    pub input_vertices: usize,
    pub output_vertices: usize,
    pub input_triangles: usize,
    pub output_triangles: usize,
    pub input_bytes: usize,
    pub output_bytes: usize,
    /// Uncompressed vertex+index size the decoder must materialise (the
    /// "render weight"). The ladder gate bounds this — a codec shrinks download,
    /// not what the GPU decodes back to. See PR #1092's packed-size gate.
    pub decoded_bytes: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug)]
pub struct Optimized {
    pub glb: Vec<u8>,
    pub stats: Stats,
}

#[derive(Debug)]
pub struct OptimizeError {
    pub message: String,
}

impl OptimizeError {
    fn new(m: impl Into<String>) -> Self {
        OptimizeError { message: m.into() }
    }
}

impl std::fmt::Display for OptimizeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}
impl std::error::Error for OptimizeError {}

/// Interleaved vertex used for meshopt (pos always present; normal/uv zero-filled
/// when the source primitive lacks them — the emitted accessors follow what was
/// actually present, tracked per primitive).
#[repr(C)]
#[derive(Clone, Copy, Default, PartialEq, bytemuck::Pod, bytemuck::Zeroable)]
struct Vertex {
    pos: [f32; 3],
    nrm: [f32; 3],
    uv: [f32; 2],
}

const VSTRIDE: usize = size_of::<Vertex>(); // 32

/// Optimise every mesh primitive in a GLB and re-encode. `Options::codec`
/// chooses the output buffer encoding.
pub fn optimize_glb(glb_bytes: &[u8], options: &Options) -> Result<Optimized, OptimizeError> {
    let glb = gltf::binary::Glb::from_slice(glb_bytes)
        .map_err(|e| OptimizeError::new(format!("parse GLB: {e}")))?;
    let bin = glb
        .bin
        .as_deref()
        .ok_or_else(|| OptimizeError::new("GLB has no binary chunk"))?;
    let root: json::Root = serde_json::from_slice(&glb.json)
        .map_err(|e| OptimizeError::new(format!("parse glTF json: {e}")))?;
    optimize_root(root, bin, glb_bytes.len(), options)
}

/// Optimise an already-parsed glTF (`root` + its single binary buffer). Used by
/// `optimize_glb` after unwrapping the GLB container, and by callers that load a
/// `.gltf` (external / embedded buffer) themselves. `input_bytes` is reported in
/// stats as the source size.
pub fn optimize_root(
    mut root: json::Root,
    bin: &[u8],
    input_bytes: usize,
    options: &Options,
) -> Result<Optimized, OptimizeError> {
    let mut stats = Stats {
        input_bytes,
        ..Default::default()
    };

    // Which bufferViews are referenced by mesh geometry — everything else (image
    // data, etc.) is unsupported in Phase 1.
    let geometry_views = geometry_buffer_views(&root);
    for (i, _) in root.buffer_views.iter().enumerate() {
        if !geometry_views.contains(&i) {
            return Err(OptimizeError::new(
                "optimize: GLB has non-geometry bufferViews (embedded images/other) — not supported yet",
            ));
        }
    }

    // Extract + optimise each primitive, then hand it to the codec's builder:
    // the view builder (plain / EXT_meshopt) or the per-primitive Draco builder.
    let draco = options.codec == Codec::Draco;
    let mut vb = Builder {
        quantize_normals: options.quantize_normals,
        ..Default::default()
    };
    let mut db = DracoBuilder::default();
    let mut dropped = 0usize;
    let meshes = std::mem::take(&mut root.meshes);
    let mut new_meshes = Vec::with_capacity(meshes.len());
    for mut mesh in meshes {
        let prims = std::mem::take(&mut mesh.primitives);
        // Collect each primitive's geometry, tagged by material. With
        // merge_primitives, same-(material, attribute-set) primitives accumulate
        // into one group; otherwise each is its own group.
        let mut groups: Vec<(Option<u32>, Primitive)> = Vec::with_capacity(prims.len());
        let mut group_idx: std::collections::HashMap<(Option<u32>, bool, bool), usize> =
            std::collections::HashMap::new();
        for prim in &prims {
            let ex = extract_primitive(&root, bin, prim)?;
            stats.input_vertices += ex.count;
            stats.input_triangles += ex.indices.len() / 3;
            // Drop degenerate primitives before they reach the C encoders.
            if !is_encodable(&ex) {
                dropped += 1;
                continue;
            }
            let material = prim.material.map(|m| m.value() as u32);
            if options.merge_primitives {
                let key = (material, ex.has_normals, ex.has_uv);
                if let Some(&gi) = group_idx.get(&key) {
                    let g = &mut groups[gi].1;
                    let base = g.vertices.len() as u32;
                    g.vertices.extend(ex.vertices);
                    g.indices.extend(ex.indices.iter().map(|i| i + base));
                    continue;
                }
                group_idx.insert(key, groups.len());
            }
            groups.push((material, ex));
        }

        let mut kept: Vec<json::mesh::Primitive> = Vec::with_capacity(groups.len());
        for (material, ex) in groups {
            let opt = optimize_primitive(ex, options);
            if opt.vertices.is_empty() || opt.indices.len() < 3 {
                continue;
            }
            stats.output_vertices += opt.vertices.len();
            stats.output_triangles += opt.indices.len() / 3;
            // Uncompressed vertex+index footprint (the decoder's render weight).
            stats.decoded_bytes += decoded_len(&opt);
            let mut prim = new_primitive(material.map(json::Index::new));
            if draco {
                db.write_primitive(&mut prim, &opt, options.draco_bits)?;
            } else {
                vb.write_primitive(&mut prim, &opt);
            }
            kept.push(prim);
        }
        mesh.primitives = kept;
        new_meshes.push(mesh);
    }
    root.meshes = new_meshes;
    if dropped > 0 {
        stats
            .warnings
            .push(format!("dropped {dropped} degenerate primitives"));
    }

    let out = if draco {
        assemble_draco(root, db)?
    } else {
        root.accessors = vb.accessors;
        assemble(root, vb.views, options.codec)?
    };
    stats.output_bytes = out.len();
    Ok(Optimized { glb: out, stats })
}

fn decoded_len(opt: &OptimizedPrimitive) -> usize {
    let n = opt.vertices.len();
    let mut b = n * 12; // positions
    if opt.has_normals {
        b += n * 12;
    }
    if opt.has_uv {
        b += n * 8;
    }
    b + opt.indices.len() * 4
}

// ---- extraction --------------------------------------------------------------

struct Primitive {
    vertices: Vec<Vertex>,
    indices: Vec<u32>,
    count: usize,
    has_normals: bool,
    has_uv: bool,
}

fn geometry_buffer_views(root: &json::Root) -> std::collections::HashSet<usize> {
    let mut set = std::collections::HashSet::new();
    let mut add = |acc_idx: usize| {
        if let Some(a) = root.accessors.get(acc_idx) {
            if let Some(v) = a.buffer_view {
                set.insert(v.value());
            }
        }
    };
    for mesh in &root.meshes {
        for p in &mesh.primitives {
            if let Some(i) = p.indices {
                add(i.value());
            }
            for (_, acc) in p.attributes.iter() {
                add(acc.value());
            }
        }
    }
    set
}

fn extract_primitive(
    root: &json::Root,
    bin: &[u8],
    prim: &json::mesh::Primitive,
) -> Result<Primitive, OptimizeError> {
    let pos_acc = prim
        .attributes
        .iter()
        .find(|(sem, _)| matches!(sem, Valid(json::mesh::Semantic::Positions)))
        .map(|(_, a)| a.value())
        .ok_or_else(|| OptimizeError::new("primitive has no POSITION"))?;
    let positions = read_vec3(root, bin, pos_acc)?;
    let count = positions.len();

    let nrm_acc = prim
        .attributes
        .iter()
        .find(|(sem, _)| matches!(sem, Valid(json::mesh::Semantic::Normals)))
        .map(|(_, a)| a.value());
    let normals = match nrm_acc {
        Some(a) => Some(read_vec3(root, bin, a)?),
        None => None,
    };
    let uv_acc = prim
        .attributes
        .iter()
        .find(|(sem, _)| matches!(sem, Valid(json::mesh::Semantic::TexCoords(0))))
        .map(|(_, a)| a.value());
    let uvs = match uv_acc {
        Some(a) => Some(read_vec2(root, bin, a)?),
        None => None,
    };

    let indices = match prim.indices {
        Some(a) => read_indices(root, bin, a.value())?,
        None => (0..count as u32).collect(),
    };

    let mut vertices = Vec::with_capacity(count);
    for i in 0..count {
        vertices.push(Vertex {
            pos: positions[i],
            nrm: normals.as_ref().map(|n| n[i]).unwrap_or([0.0; 3]),
            uv: uvs.as_ref().map(|u| u[i]).unwrap_or([0.0; 2]),
        });
    }

    Ok(Primitive {
        vertices,
        indices,
        count,
        has_normals: normals.is_some(),
        has_uv: uvs.is_some(),
    })
}

fn accessor_view<'a>(
    root: &json::Root,
    bin: &'a [u8],
    acc_idx: usize,
) -> Result<
    (
        &'a [u8],
        usize,
        usize,
        json::accessor::ComponentType,
        json::accessor::Type,
    ),
    OptimizeError,
> {
    let acc = root
        .accessors
        .get(acc_idx)
        .ok_or_else(|| OptimizeError::new("accessor out of range"))?;
    let view_idx = acc
        .buffer_view
        .ok_or_else(|| OptimizeError::new("accessor has no bufferView"))?
        .value();
    let view = root
        .buffer_views
        .get(view_idx)
        .ok_or_else(|| OptimizeError::new("bufferView out of range"))?;
    let comp = match acc.component_type {
        Valid(c) => c.0,
        _ => return Err(OptimizeError::new("invalid component type")),
    };
    let ty = match acc.type_ {
        Valid(t) => t,
        _ => return Err(OptimizeError::new("invalid accessor type")),
    };
    let view_off = view.byte_offset.map(|o| o.0 as usize).unwrap_or(0);
    let acc_off = acc.byte_offset.map(|o| o.0 as usize).unwrap_or(0);
    let start = view_off + acc_off;
    let stride = view
        .byte_stride
        .map(|s| s.0)
        .unwrap_or_else(|| component_size(comp) * type_components(ty));
    Ok((bin, start, stride, comp, ty))
}

fn read_vec3(root: &json::Root, bin: &[u8], acc_idx: usize) -> Result<Vec<[f32; 3]>, OptimizeError> {
    let (data, start, stride, comp, _) = accessor_view(root, bin, acc_idx)?;
    if !matches!(comp, json::accessor::ComponentType::F32) {
        return Err(OptimizeError::new("expected f32 VEC3"));
    }
    let count = root.accessors[acc_idx].count.0 as usize;
    let mut out = Vec::with_capacity(count);
    for i in 0..count {
        let o = start + i * stride;
        out.push([read_f32(data, o)?, read_f32(data, o + 4)?, read_f32(data, o + 8)?]);
    }
    Ok(out)
}

fn read_vec2(root: &json::Root, bin: &[u8], acc_idx: usize) -> Result<Vec<[f32; 2]>, OptimizeError> {
    let (data, start, stride, comp, _) = accessor_view(root, bin, acc_idx)?;
    if !matches!(comp, json::accessor::ComponentType::F32) {
        return Err(OptimizeError::new("expected f32 VEC2"));
    }
    let count = root.accessors[acc_idx].count.0 as usize;
    let mut out = Vec::with_capacity(count);
    for i in 0..count {
        let o = start + i * stride;
        out.push([read_f32(data, o)?, read_f32(data, o + 4)?]);
    }
    Ok(out)
}

fn read_indices(root: &json::Root, bin: &[u8], acc_idx: usize) -> Result<Vec<u32>, OptimizeError> {
    let (data, start, stride, comp, _) = accessor_view(root, bin, acc_idx)?;
    let count = root.accessors[acc_idx].count.0 as usize;
    let mut out = Vec::with_capacity(count);
    for i in 0..count {
        let o = start + i * stride;
        use json::accessor::ComponentType;
        let v = match comp {
            ComponentType::U8 => {
                *data.get(o).ok_or_else(|| OptimizeError::new("index oob"))? as u32
            }
            ComponentType::U16 => read_u16(data, o)? as u32,
            ComponentType::U32 => read_u32(data, o)?,
            _ => return Err(OptimizeError::new("unsupported index component type")),
        };
        out.push(v);
    }
    Ok(out)
}

fn read_f32(d: &[u8], o: usize) -> Result<f32, OptimizeError> {
    let b = d.get(o..o + 4).ok_or_else(|| OptimizeError::new("f32 oob"))?;
    Ok(f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}
fn read_u16(d: &[u8], o: usize) -> Result<u16, OptimizeError> {
    let b = d.get(o..o + 2).ok_or_else(|| OptimizeError::new("u16 oob"))?;
    Ok(u16::from_le_bytes([b[0], b[1]]))
}
fn read_u32(d: &[u8], o: usize) -> Result<u32, OptimizeError> {
    let b = d.get(o..o + 4).ok_or_else(|| OptimizeError::new("u32 oob"))?;
    Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

fn component_size(comp: json::accessor::ComponentType) -> usize {
    use json::accessor::ComponentType::*;
    match comp {
        I8 | U8 => 1,
        I16 | U16 => 2,
        U32 | F32 => 4,
    }
}
fn type_components(ty: json::accessor::Type) -> usize {
    use json::accessor::Type::*;
    match ty {
        Scalar => 1,
        Vec2 => 2,
        Vec3 => 3,
        Vec4 | Mat2 => 4,
        Mat3 => 9,
        Mat4 => 16,
    }
}

// ---- optimisation ------------------------------------------------------------

struct OptimizedPrimitive {
    vertices: Vec<Vertex>,
    indices: Vec<u32>,
    has_normals: bool,
    has_uv: bool,
}

/// True when a primitive has usable triangle geometry meshopt/draco can encode.
/// A degenerate one (empty, non-triangle-count, or an index past the vertex
/// range) would out-of-bounds-read in the C encoders → segfault; the caller
/// drops those. Real exports (fragmented Onshape gltf) contain them.
fn is_encodable(p: &Primitive) -> bool {
    !p.vertices.is_empty()
        && p.indices.len() >= 3
        && p.indices.len() % 3 == 0
        && p.indices
            .iter()
            .copied()
            .max()
            .is_some_and(|m| (m as usize) < p.vertices.len())
}

fn optimize_primitive(p: Primitive, opts: &Options) -> OptimizedPrimitive {
    let mut vertices = p.vertices;
    let mut indices = p.indices;

    if opts.weld {
        let (vcount, remap) = meshopt::generate_vertex_remap(&vertices, Some(&indices));
        indices = meshopt::remap_index_buffer(Some(&indices), indices.len(), &remap);
        vertices = meshopt::remap_vertex_buffer(&vertices, vcount, &remap);
    }

    // Simplify precedence:
    //   explicit `simplify` (ratio) and/or `tolerance` (absolute mm)  — size- or
    //     precision-driven, honoured on any mesh (>= 1 triangle);
    //   else `auto_error` (normalized budget) — quality-driven, per-mesh adaptive,
    //     skipped below AUTO_TRI_FLOOR;
    //   else off (lossless: only weld/reorder run).
    let explicit = opts.simplify.is_some() || opts.tolerance.is_some();
    let run = if explicit {
        indices.len() >= 3
    } else if opts.auto_error.is_some() {
        indices.len() / 3 >= AUTO_TRI_FLOOR
    } else {
        false
    };
    if run {
        let bytes: &[u8] = bytemuck::cast_slice(&vertices);
        if let Ok(adapter) = meshopt::VertexDataAdapter::new(bytes, VSTRIDE, 0) {
            // Ratio sets the triangle target; 0 = "reduce as far as the error
            // bound allows" (tolerance/auto modes).
            let target = match opts.simplify {
                Some(r) if r > 0.0 && r < 1.0 => {
                    (((indices.len() as f32) * r) as usize / 3).max(1) * 3
                }
                _ => 0,
            };
            // Error ceiling (meshopt's normalized units): an explicit absolute
            // `tolerance` (mm → normalized via simplify_scale) wins; else the
            // normalized `auto_error` when no ratio was given; else unbounded
            // (a pure ratio hits its target regardless of error).
            let rel_err = if let Some(mm) = opts.tolerance.filter(|&m| m > 0.0) {
                let scale = meshopt::simplify_scale(&adapter);
                if scale > 0.0 {
                    (mm / scale).min(1.0)
                } else {
                    1.0
                }
            } else if opts.simplify.is_none() {
                opts.auto_error.unwrap_or(1.0)
            } else {
                1.0
            };
            indices = if opts.simplify_aggressive {
                meshopt::simplify_sloppy(&indices, &adapter, target, rel_err, None)
            } else {
                meshopt::simplify(
                    &indices,
                    &adapter,
                    target,
                    rel_err,
                    meshopt::SimplifyOptions::None,
                    None,
                )
            };
        }
    }

    if opts.reorder && !indices.is_empty() {
        meshopt::optimize_vertex_cache_in_place(&mut indices, vertices.len());
        let bytes: &[u8] = bytemuck::cast_slice(&vertices);
        if let Ok(adapter) = meshopt::VertexDataAdapter::new(bytes, VSTRIDE, 0) {
            meshopt::optimize_overdraw_in_place(&mut indices, &adapter, 1.05);
        }
        vertices = meshopt::optimize_vertex_fetch(&mut indices, &vertices);
    }

    OptimizedPrimitive {
        vertices,
        indices,
        has_normals: p.has_normals,
        has_uv: p.has_uv,
    }
}

// ---- rebuild -----------------------------------------------------------------

/// One output bufferView's typed data, kept until assembly so the meshopt codec
/// can encode from the correct element type.
enum ViewData {
    Attr3(Vec<[f32; 3]>),
    /// Normalized `i16` VEC3 (quantized normals — core glTF, half the bytes).
    Attr3i16(Vec<[i16; 3]>),
    Attr2(Vec<[f32; 2]>),
    Idx { indices: Vec<u32>, vertex_count: usize },
}

impl ViewData {
    fn raw_bytes(&self) -> Vec<u8> {
        match self {
            ViewData::Attr3(v) => {
                let mut b = Vec::with_capacity(v.len() * 12);
                for e in v {
                    for c in e {
                        b.extend_from_slice(&c.to_le_bytes());
                    }
                }
                b
            }
            ViewData::Attr3i16(v) => {
                let mut b = Vec::with_capacity(v.len() * 6);
                for e in v {
                    for c in e {
                        b.extend_from_slice(&c.to_le_bytes());
                    }
                }
                b
            }
            ViewData::Attr2(v) => {
                let mut b = Vec::with_capacity(v.len() * 8);
                for e in v {
                    for c in e {
                        b.extend_from_slice(&c.to_le_bytes());
                    }
                }
                b
            }
            ViewData::Idx { indices, .. } => {
                let mut b = Vec::with_capacity(indices.len() * 4);
                for &i in indices {
                    b.extend_from_slice(&i.to_le_bytes());
                }
                b
            }
        }
    }
    fn stride(&self) -> usize {
        match self {
            ViewData::Attr3(_) => 12,
            ViewData::Attr3i16(_) => 6,
            ViewData::Attr2(_) => 8,
            ViewData::Idx { .. } => 4,
        }
    }
    fn count(&self) -> usize {
        match self {
            ViewData::Attr3(v) => v.len(),
            ViewData::Attr3i16(v) => v.len(),
            ViewData::Attr2(v) => v.len(),
            ViewData::Idx { indices, .. } => indices.len(),
        }
    }
    fn is_index(&self) -> bool {
        matches!(self, ViewData::Idx { .. })
    }
    /// EXT_meshopt_compression buffer mode.
    fn mode(&self) -> &'static str {
        if self.is_index() {
            "TRIANGLES"
        } else {
            "ATTRIBUTES"
        }
    }
    fn target(&self) -> json::buffer::Target {
        if self.is_index() {
            json::buffer::Target::ElementArrayBuffer
        } else {
            json::buffer::Target::ArrayBuffer
        }
    }
    fn encode_meshopt(&self) -> Vec<u8> {
        match self {
            ViewData::Attr3(v) => meshopt::encode_vertex_buffer(v).unwrap_or_default(),
            ViewData::Attr3i16(v) => meshopt::encode_vertex_buffer(v).unwrap_or_default(),
            ViewData::Attr2(v) => meshopt::encode_vertex_buffer(v).unwrap_or_default(),
            ViewData::Idx {
                indices,
                vertex_count,
            } => meshopt::encode_index_buffer(indices, *vertex_count).unwrap_or_default(),
        }
    }
}

#[derive(Default)]
struct Builder {
    views: Vec<ViewData>,
    accessors: Vec<json::Accessor>,
    /// Quantize normals to `i16` (SHORT normalized) instead of f32.
    quantize_normals: bool,
}

impl Builder {
    fn add_view(&mut self, v: ViewData) -> usize {
        self.views.push(v);
        self.views.len() - 1
    }

    fn write_primitive(&mut self, prim: &mut json::mesh::Primitive, opt: &OptimizedPrimitive) {
        use json::accessor::{ComponentType, Type};
        let positions: Vec<[f32; 3]> = opt.vertices.iter().map(|v| v.pos).collect();
        let mut min = [f32::INFINITY; 3];
        let mut max = [f32::NEG_INFINITY; 3];
        for p in &positions {
            for k in 0..3 {
                min[k] = min[k].min(p[k]);
                max[k] = max[k].max(p[k]);
            }
        }
        let pos_view = self.add_view(ViewData::Attr3(positions));
        let pos_acc =
            self.push_accessor(pos_view, opt.vertices.len(), ComponentType::F32, Type::Vec3, false, Some((min, max)));

        let mut attributes = std::collections::BTreeMap::new();
        attributes.insert(Valid(json::mesh::Semantic::Positions), json::Index::new(pos_acc as u32));

        if opt.has_normals {
            let n = opt.vertices.len();
            let na = if self.quantize_normals {
                // f32 unit normal → i16 snorm (normalized) VEC3. Core glTF, no
                // node transform, ~half the bytes, visually lossless.
                let normals: Vec<[i16; 3]> = opt
                    .vertices
                    .iter()
                    .map(|v| {
                        [
                            meshopt::quantize_snorm(v.nrm[0], 16) as i16,
                            meshopt::quantize_snorm(v.nrm[1], 16) as i16,
                            meshopt::quantize_snorm(v.nrm[2], 16) as i16,
                        ]
                    })
                    .collect();
                let nv = self.add_view(ViewData::Attr3i16(normals));
                self.push_accessor(nv, n, ComponentType::I16, Type::Vec3, true, None)
            } else {
                let normals: Vec<[f32; 3]> = opt.vertices.iter().map(|v| v.nrm).collect();
                let nv = self.add_view(ViewData::Attr3(normals));
                self.push_accessor(nv, n, ComponentType::F32, Type::Vec3, false, None)
            };
            attributes.insert(Valid(json::mesh::Semantic::Normals), json::Index::new(na as u32));
        }
        if opt.has_uv {
            let uvs: Vec<[f32; 2]> = opt.vertices.iter().map(|v| v.uv).collect();
            let uvv = self.add_view(ViewData::Attr2(uvs));
            let uva =
                self.push_accessor(uvv, opt.vertices.len(), ComponentType::F32, Type::Vec2, false, None);
            attributes.insert(Valid(json::mesh::Semantic::TexCoords(0)), json::Index::new(uva as u32));
        }

        let iv = self.add_view(ViewData::Idx {
            indices: opt.indices.clone(),
            vertex_count: opt.vertices.len(),
        });
        let ia =
            self.push_accessor(iv, opt.indices.len(), ComponentType::U32, Type::Scalar, false, None);

        prim.attributes = attributes;
        prim.indices = Some(json::Index::new(ia as u32));
    }

    fn push_accessor(
        &mut self,
        view: usize,
        count: usize,
        comp: json::accessor::ComponentType,
        ty: json::accessor::Type,
        normalized: bool,
        minmax: Option<([f32; 3], [f32; 3])>,
    ) -> usize {
        let (min, max) = match minmax {
            Some((mn, mx)) => (
                Some(serde_json::json!(mn.to_vec())),
                Some(serde_json::json!(mx.to_vec())),
            ),
            None => (None, None),
        };
        self.accessors.push(json::Accessor {
            buffer_view: Some(json::Index::new(view as u32)),
            byte_offset: Some(USize64(0)),
            count: USize64::from(count),
            component_type: Valid(json::accessor::GenericComponentType(comp)),
            type_: Valid(ty),
            min,
            max,
            name: None,
            normalized,
            sparse: None,
            extensions: Default::default(),
            extras: Default::default(),
        });
        self.accessors.len() - 1
    }
}

fn make_view(
    buffer: u32,
    offset: usize,
    len: usize,
    byte_stride: Option<usize>,
    target: json::buffer::Target,
) -> json::buffer::View {
    json::buffer::View {
        buffer: json::Index::new(buffer),
        byte_length: USize64::from(len),
        byte_offset: Some(USize64::from(offset)),
        byte_stride: byte_stride.map(json::buffer::Stride),
        target: Some(Valid(target)),
        name: None,
        extensions: Default::default(),
        extras: Default::default(),
    }
}

fn make_buffer(len: usize) -> json::Buffer {
    json::Buffer {
        byte_length: USize64::from(len),
        name: None,
        uri: None,
        extensions: Default::default(),
        extras: Default::default(),
    }
}

/// A fresh triangle-list primitive with the given material; attributes/indices
/// are filled by the codec builder.
fn new_primitive(material: Option<json::Index<json::Material>>) -> json::mesh::Primitive {
    json::mesh::Primitive {
        attributes: Default::default(),
        indices: None,
        material,
        mode: Valid(json::mesh::Mode::Triangles),
        targets: None,
        extensions: Default::default(),
        extras: Default::default(),
    }
}

fn build_glb(json_bytes: Vec<u8>, bin: Vec<u8>) -> Result<Vec<u8>, OptimizeError> {
    gltf::binary::Glb {
        header: gltf::binary::Header {
            magic: *b"glTF",
            version: 2,
            length: 0,
        },
        json: Cow::Owned(json_bytes),
        bin: if bin.is_empty() {
            None
        } else {
            Some(Cow::Owned(bin))
        },
    }
    .to_vec()
    .map_err(|e| OptimizeError::new(format!("assemble GLB: {e}")))
}

/// Serialize `root` + geometry `views` into a GLB using the chosen codec.
fn assemble(
    mut root: json::Root,
    views: Vec<ViewData>,
    codec: Codec,
) -> Result<Vec<u8>, OptimizeError> {
    match codec {
        // Draco falls back to plain in Phase 1 (crates/draco-bridge is Phase 2).
        Codec::None | Codec::Draco => {
            let mut blob = Vec::new();
            let mut bvs = Vec::with_capacity(views.len());
            for v in &views {
                while blob.len() % 4 != 0 {
                    blob.push(0);
                }
                let off = blob.len();
                let bytes = v.raw_bytes();
                blob.extend_from_slice(&bytes);
                bvs.push(make_view(0, off, bytes.len(), None, v.target()));
            }
            root.buffer_views = bvs;
            root.buffers = if blob.is_empty() {
                Vec::new()
            } else {
                vec![make_buffer(blob.len())]
            };
            let json_bytes = json::serialize::to_vec(&root)
                .map_err(|e| OptimizeError::new(format!("serialize glTF json: {e}")))?;
            build_glb(json_bytes, blob)
        }
        // EXT_meshopt_compression: buffer 0 is the GLB BIN holding the meshopt-
        // encoded data; buffer 1 is a memory-only fallback the decoder writes the
        // decompressed data into. Each geometry bufferView points at the fallback
        // (top-level) and at the compressed data (extension). See the EXT spec.
        Codec::Meshopt => {
            let mut bin = Vec::new(); // buffer 0: compressed (the GLB BIN)
            let mut fallback_len = 0usize; // buffer 1: fallback (no bytes emitted)
            let mut bvs = Vec::with_capacity(views.len());
            for v in &views {
                let raw_len = v.count() * v.stride(); // decompressed footprint (no alloc)
                while fallback_len % 4 != 0 {
                    fallback_len += 1;
                }
                let f_off = fallback_len;
                fallback_len += raw_len;

                let comp = v.encode_meshopt();
                if comp.is_empty() {
                    return Err(OptimizeError::new("meshopt encode produced empty buffer"));
                }
                while bin.len() % 4 != 0 {
                    bin.push(0);
                }
                let c_off = bin.len();
                let c_len = comp.len();
                bin.extend_from_slice(&comp);

                let byte_stride = if v.is_index() { None } else { Some(v.stride()) };
                let mut view = make_view(1, f_off, raw_len, byte_stride, v.target());
                // Set the EXT_meshopt_compression record directly on the typed
                // bufferView (gltf "extensions" feature) — no whole-document Value
                // round-trip, so memory stays flat.
                let mut m = serde_json::Map::new();
                m.insert(
                    "EXT_meshopt_compression".into(),
                    serde_json::json!({
                        "buffer": 0, "byteOffset": c_off, "byteLength": c_len,
                        "byteStride": v.stride(), "count": v.count(), "mode": v.mode(),
                    }),
                );
                view.extensions = Some(json::extensions::buffer::View { others: m });
                bvs.push(view);
            }
            root.buffer_views = bvs;
            let mut fallback = make_buffer(fallback_len);
            let mut fm = serde_json::Map::new();
            fm.insert(
                "EXT_meshopt_compression".into(),
                serde_json::json!({ "fallback": true }),
            );
            fallback.extensions = Some(json::extensions::buffer::Buffer { others: fm });
            root.buffers = vec![make_buffer(bin.len()), fallback];
            add_ext(&mut root.extensions_used, "EXT_meshopt_compression");
            add_ext(&mut root.extensions_required, "EXT_meshopt_compression");

            let json_bytes = json::serialize::to_vec(&root)
                .map_err(|e| OptimizeError::new(format!("serialize glTF json: {e}")))?;
            build_glb(json_bytes, bin)
        }
    }
}

fn add_ext(list: &mut Vec<String>, name: &str) {
    if !list.iter().any(|e| e == name) {
        list.push(name.to_string());
    }
}

// ---- Draco (KHR_draco_mesh_compression) --------------------------------------

// Quantization bits (gltf-transform defaults). Draco compresses by quantizing
// attributes; the KHR_draco decoder dequantizes back to float.
const DRACO_POS_BITS: i32 = 14;
const DRACO_NORM_BITS: i32 = 10;
const DRACO_UV_BITS: i32 = 12;

/// Draco is per-primitive: each primitive is encoded into one draco blob, and
/// its accessors carry type/count/min-max but no bufferView (the decoder
/// supplies the data).
#[derive(Default)]
struct DracoBuilder {
    bin: Vec<u8>,
    buffer_views: Vec<json::buffer::View>,
    accessors: Vec<json::Accessor>,
}

impl DracoBuilder {
    fn write_primitive(
        &mut self,
        prim: &mut json::mesh::Primitive,
        opt: &OptimizedPrimitive,
        bits: (i32, i32, i32),
    ) -> Result<(), OptimizeError> {
        let n = opt.vertices.len();
        let positions: Vec<f32> = opt.vertices.iter().flat_map(|v| v.pos).collect();
        let mut min = [f32::INFINITY; 3];
        let mut max = [f32::NEG_INFINITY; 3];
        for v in &opt.vertices {
            for k in 0..3 {
                min[k] = min[k].min(v.pos[k]);
                max[k] = max[k].max(v.pos[k]);
            }
        }
        let normals: Vec<f32> = if opt.has_normals {
            opt.vertices.iter().flat_map(|v| v.nrm).collect()
        } else {
            Vec::new()
        };
        let uvs: Vec<f32> = if opt.has_uv {
            opt.vertices.iter().flat_map(|v| v.uv).collect()
        } else {
            Vec::new()
        };

        let enc = draco_bridge::encode_mesh(
            &positions, &normals, &uvs, &opt.indices, bits.0, bits.1, bits.2,
        );
        if !enc.ok || enc.data.is_empty() {
            return Err(OptimizeError::new("draco encode failed"));
        }

        while self.bin.len() % 4 != 0 {
            self.bin.push(0);
        }
        let off = self.bin.len();
        self.bin.extend_from_slice(&enc.data);
        self.buffer_views.push(json::buffer::View {
            buffer: json::Index::new(0),
            byte_length: USize64::from(enc.data.len()),
            byte_offset: Some(USize64::from(off)),
            byte_stride: None,
            target: None,
            name: None,
            extensions: Default::default(),
            extras: Default::default(),
        });
        let bv = self.buffer_views.len() - 1;

        let mut attributes = std::collections::BTreeMap::new();
        let pos_acc = self.accessor_noview(
            n,
            json::accessor::ComponentType::F32,
            json::accessor::Type::Vec3,
            Some((min, max)),
        );
        attributes.insert(Valid(json::mesh::Semantic::Positions), json::Index::new(pos_acc as u32));
        if opt.has_normals {
            let a = self.accessor_noview(
                n,
                json::accessor::ComponentType::F32,
                json::accessor::Type::Vec3,
                None,
            );
            attributes.insert(Valid(json::mesh::Semantic::Normals), json::Index::new(a as u32));
        }
        if opt.has_uv {
            let a = self.accessor_noview(
                n,
                json::accessor::ComponentType::F32,
                json::accessor::Type::Vec2,
                None,
            );
            attributes.insert(Valid(json::mesh::Semantic::TexCoords(0)), json::Index::new(a as u32));
        }
        let idx_acc = self.accessor_noview(
            opt.indices.len(),
            json::accessor::ComponentType::U32,
            json::accessor::Type::Scalar,
            None,
        );
        prim.attributes = attributes;
        prim.indices = Some(json::Index::new(idx_acc as u32));

        // Set the KHR_draco_mesh_compression record directly on the typed
        // primitive (no whole-document Value round-trip).
        let mut attrs = serde_json::Map::new();
        attrs.insert("POSITION".into(), serde_json::json!(enc.pos_id));
        if enc.norm_id >= 0 {
            attrs.insert("NORMAL".into(), serde_json::json!(enc.norm_id));
        }
        if enc.uv_id >= 0 {
            attrs.insert("TEXCOORD_0".into(), serde_json::json!(enc.uv_id));
        }
        let mut m = serde_json::Map::new();
        m.insert(
            "KHR_draco_mesh_compression".into(),
            serde_json::json!({ "bufferView": bv, "attributes": serde_json::Value::Object(attrs) }),
        );
        prim.extensions = Some(json::extensions::mesh::Primitive {
            others: m,
            ..Default::default()
        });
        Ok(())
    }

    fn accessor_noview(
        &mut self,
        count: usize,
        comp: json::accessor::ComponentType,
        ty: json::accessor::Type,
        minmax: Option<([f32; 3], [f32; 3])>,
    ) -> usize {
        let (min, max) = match minmax {
            Some((mn, mx)) => (
                Some(serde_json::json!(mn.to_vec())),
                Some(serde_json::json!(mx.to_vec())),
            ),
            None => (None, None),
        };
        self.accessors.push(json::Accessor {
            buffer_view: None,
            byte_offset: None,
            count: USize64::from(count),
            component_type: Valid(json::accessor::GenericComponentType(comp)),
            type_: Valid(ty),
            min,
            max,
            name: None,
            normalized: false,
            sparse: None,
            extensions: Default::default(),
            extras: Default::default(),
        });
        self.accessors.len() - 1
    }
}

fn assemble_draco(mut root: json::Root, db: DracoBuilder) -> Result<Vec<u8>, OptimizeError> {
    root.accessors = db.accessors;
    root.buffer_views = db.buffer_views;
    root.buffers = if db.bin.is_empty() {
        Vec::new()
    } else {
        vec![make_buffer(db.bin.len())]
    };
    add_ext(&mut root.extensions_used, "KHR_draco_mesh_compression");
    add_ext(&mut root.extensions_required, "KHR_draco_mesh_compression");

    let json_bytes = json::serialize::to_vec(&root)
        .map_err(|e| OptimizeError::new(format!("serialize glTF json: {e}")))?;
    build_glb(json_bytes, db.bin)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A quad as two triangles with the shared edge duplicated: 6 unindexed
    /// vertices, 4 of them unique. Weld must collapse to 4.
    fn quad_glb() -> Vec<u8> {
        // A(0,0,0) B(1,0,0) C(0,1,0) D(1,1,0); tri1 A,B,C  tri2 C,B,D
        let verts: [[f32; 3]; 6] = [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 1.0, 0.0],
            [1.0, 0.0, 0.0],
            [1.0, 1.0, 0.0],
        ];
        let indices: [u32; 6] = [0, 1, 2, 3, 4, 5];

        let mut blob = Vec::new();
        for v in &verts {
            for c in v {
                blob.extend_from_slice(&c.to_le_bytes());
            }
        }
        let idx_off = blob.len();
        for i in &indices {
            blob.extend_from_slice(&i.to_le_bytes());
        }

        let pos_view = json::buffer::View {
            buffer: json::Index::new(0),
            byte_length: USize64::from(idx_off),
            byte_offset: Some(USize64(0)),
            byte_stride: None,
            target: Some(Valid(json::buffer::Target::ArrayBuffer)),
            name: None,
            extensions: Default::default(),
            extras: Default::default(),
        };
        let idx_view = json::buffer::View {
            buffer: json::Index::new(0),
            byte_length: USize64::from(blob.len() - idx_off),
            byte_offset: Some(USize64::from(idx_off)),
            byte_stride: None,
            target: Some(Valid(json::buffer::Target::ElementArrayBuffer)),
            name: None,
            extensions: Default::default(),
            extras: Default::default(),
        };
        let pos_acc = json::Accessor {
            buffer_view: Some(json::Index::new(0)),
            byte_offset: Some(USize64(0)),
            count: USize64::from(6usize),
            component_type: Valid(json::accessor::GenericComponentType(
                json::accessor::ComponentType::F32,
            )),
            type_: Valid(json::accessor::Type::Vec3),
            min: Some(serde_json::json!([0.0, 0.0, 0.0])),
            max: Some(serde_json::json!([1.0, 1.0, 0.0])),
            name: None,
            normalized: false,
            sparse: None,
            extensions: Default::default(),
            extras: Default::default(),
        };
        let idx_acc = json::Accessor {
            buffer_view: Some(json::Index::new(1)),
            byte_offset: Some(USize64(0)),
            count: USize64::from(6usize),
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
        };
        let mut attributes = std::collections::BTreeMap::new();
        attributes.insert(Valid(json::mesh::Semantic::Positions), json::Index::new(0));
        let prim = json::mesh::Primitive {
            attributes,
            indices: Some(json::Index::new(1)),
            material: None,
            mode: Valid(json::mesh::Mode::Triangles),
            targets: None,
            extensions: Default::default(),
            extras: Default::default(),
        };
        let root = json::Root {
            accessors: vec![pos_acc, idx_acc],
            buffer_views: vec![pos_view, idx_view],
            buffers: vec![json::Buffer {
                byte_length: USize64::from(blob.len()),
                name: None,
                uri: None,
                extensions: Default::default(),
                extras: Default::default(),
            }],
            meshes: vec![json::Mesh {
                primitives: vec![prim],
                weights: None,
                name: None,
                extensions: Default::default(),
                extras: Default::default(),
            }],
            nodes: vec![json::Node {
                mesh: Some(json::Index::new(0)),
                ..Default::default()
            }],
            scene: Some(json::Index::new(0)),
            scenes: vec![json::Scene {
                nodes: vec![json::Index::new(0)],
                name: None,
                extensions: Default::default(),
                extras: Default::default(),
            }],
            ..Default::default()
        };

        let json_bytes = json::serialize::to_vec(&root).unwrap();
        gltf::binary::Glb {
            header: gltf::binary::Header {
                magic: *b"glTF",
                version: 2,
                length: 0,
            },
            json: Cow::Owned(json_bytes),
            bin: Some(Cow::Owned(blob)),
        }
        .to_vec()
        .unwrap()
    }

    #[test]
    fn welds_duplicate_vertices_and_reparses() {
        let glb = quad_glb();
        let opt = optimize_glb(
            &glb,
            &Options {
                codec: Codec::None,
                ..Default::default()
            },
        )
        .expect("optimize");
        assert_eq!(opt.stats.input_vertices, 6);
        assert_eq!(opt.stats.input_triangles, 2);
        // Weld collapses the two duplicated corners.
        assert_eq!(opt.stats.output_vertices, 4);
        assert_eq!(opt.stats.output_triangles, 2);
        // Output must be a valid GLB that round-trips through the parser.
        let reparsed = gltf::binary::Glb::from_slice(&opt.glb).expect("reparse");
        let root: json::Root = serde_json::from_slice(reparsed.json.as_ref()).expect("json");
        assert_eq!(root.meshes.len(), 1);
        assert_eq!(root.nodes.len(), 1);
    }

    #[test]
    fn meshopt_codec_emits_ext_and_reparses() {
        let glb = quad_glb();
        let opt = optimize_glb(
            &glb,
            &Options {
                codec: Codec::Meshopt,
                ..Default::default()
            },
        )
        .expect("optimize");
        let reparsed = gltf::binary::Glb::from_slice(&opt.glb).expect("reparse");
        let root: serde_json::Value =
            serde_json::from_slice(reparsed.json.as_ref()).expect("json");
        // Extension declared + required.
        let used = root["extensionsUsed"].as_array().expect("extensionsUsed");
        assert!(used.iter().any(|e| e == "EXT_meshopt_compression"));
        // Two buffers: compressed BIN + memory-only fallback.
        let buffers = root["buffers"].as_array().expect("buffers");
        assert_eq!(buffers.len(), 2);
        assert_eq!(buffers[1]["extensions"]["EXT_meshopt_compression"]["fallback"], true);
        // Every bufferView carries a compression record pointing at buffer 0.
        for bv in root["bufferViews"].as_array().expect("bufferViews") {
            let ext = &bv["extensions"]["EXT_meshopt_compression"];
            assert_eq!(ext["buffer"], 0);
            assert!(ext["byteLength"].as_u64().unwrap() > 0);
            assert!(ext["mode"].is_string());
        }
    }

    #[test]
    fn draco_codec_emits_khr_ext_and_reparses() {
        let glb = quad_glb();
        let opt = optimize_glb(
            &glb,
            &Options {
                codec: Codec::Draco,
                ..Default::default()
            },
        )
        .expect("optimize");
        let reparsed = gltf::binary::Glb::from_slice(&opt.glb).expect("reparse");
        let root: serde_json::Value =
            serde_json::from_slice(reparsed.json.as_ref()).expect("json");

        for key in ["extensionsUsed", "extensionsRequired"] {
            assert!(
                root[key]
                    .as_array()
                    .expect(key)
                    .iter()
                    .any(|e| e == "KHR_draco_mesh_compression"),
                "{key} missing KHR_draco_mesh_compression"
            );
        }
        // Primitive carries the draco extension.
        let ext = &root["meshes"][0]["primitives"][0]["extensions"]
            ["KHR_draco_mesh_compression"];
        assert_eq!(ext["bufferView"], 0);
        assert_eq!(ext["attributes"]["POSITION"], 0);
        // Draco accessors have no bufferView (decoder provides the data).
        for acc in root["accessors"].as_array().expect("accessors") {
            assert!(acc.get("bufferView").is_none() || acc["bufferView"].is_null());
        }
        // The draco blob is present as the single buffer.
        assert_eq!(root["buffers"].as_array().expect("buffers").len(), 1);
    }

    #[test]
    fn meshopt_roundtrip_decodes_positions() {
        let glb = quad_glb();
        let opt = optimize_glb(
            &glb,
            &Options {
                codec: Codec::Meshopt,
                weld: true,
                reorder: false, // keep it simple; still exercises encode/offsets
                ..Default::default()
            },
        )
        .expect("optimize");
        let reparsed = gltf::binary::Glb::from_slice(&opt.glb).expect("reparse");
        let root: serde_json::Value =
            serde_json::from_slice(reparsed.json.as_ref()).expect("json");
        let bin = reparsed.bin.as_deref().expect("bin");

        // bufferView 0 is POSITION (first view written per primitive).
        let ext = &root["bufferViews"][0]["extensions"]["EXT_meshopt_compression"];
        let off = ext["byteOffset"].as_u64().unwrap() as usize;
        let len = ext["byteLength"].as_u64().unwrap() as usize;
        let count = ext["count"].as_u64().unwrap() as usize;
        let decoded: Vec<[f32; 3]> =
            meshopt::decode_vertex_buffer(&bin[off..off + len], count).expect("decode");
        assert_eq!(decoded.len(), 4); // welded quad corners
        // The four unit-quad corners must all be present.
        for corner in [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [1.0, 1.0, 0.0]] {
            assert!(
                decoded.iter().any(|p| *p == corner),
                "missing corner {corner:?} in {decoded:?}"
            );
        }
    }

    #[test]
    fn simplify_reduces_triangles() {
        let glb = quad_glb();
        let opt = optimize_glb(
            &glb,
            &Options {
                codec: Codec::None,
                simplify: Some(0.5),
                ..Default::default()
            },
        )
        .expect("optimize");
        // A 2-triangle quad can't meaningfully simplify, but it must stay valid
        // and not grow.
        assert!(opt.stats.output_triangles <= 2);
        gltf::binary::Glb::from_slice(&opt.glb).expect("reparse");
    }
}
