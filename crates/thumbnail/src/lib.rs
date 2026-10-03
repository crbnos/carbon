// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! GLB → PNG preview thumbnail, rendered on the CPU.
//!
//! Reads the GLBs this service produces — plain buffers (`convert`) and
//! `EXT_meshopt_compression` (`optimize`) — walks the scene, and rasterises every
//! triangle into a z-buffer from the viewer's default direction (front-top-right
//! isometric, Z up). The background is transparent; the model is lit by two
//! fixed lights and coloured by each material's `baseColorFactor`.
//!
//! Textures, vertex colours and Draco-compressed primitives are not read: the
//! first two fall back to the material colour, Draco is an error.

use serde_json::Value;
use std::borrow::Cow;
use std::fmt;
use std::io::Write;

/// Side of the square thumbnail, in pixels, when the caller does not choose.
pub const DEFAULT_SIZE: u32 = 300;
pub const MIN_SIZE: u32 = 32;
pub const MAX_SIZE: u32 = 1024;

/// Each output pixel averages this many samples per side.
const SUPERSAMPLE: usize = 3;
/// Empty border around the model, as a fraction of the image side.
const MARGIN: f32 = 0.06;
/// Colour of a primitive with no material — the converter's default part grey.
const DEFAULT_COLOR: [f32; 3] = [0.65, 0.65, 0.65];
/// Towards the camera. The viewer frames a model from here (`ModelCanvas`).
const VIEW_DIRECTION: [f32; 3] = [1.0, -1.0, 1.0];
/// A malformed scene whose nodes form a cycle would otherwise never finish.
const MAX_NODE_VISITS: usize = 1_000_000;
/// Ceilings on what one render holds in memory. The counts in a GLB are the
/// uploader's to choose (a decoded view's size, how many times a mesh is
/// instanced), and an allocation that fails aborts the whole service rather than
/// this job. Far above anything the optimiser's own size gates let through.
const MAX_VIEW_BYTES: usize = 1 << 30;
const MAX_VERTICES: usize = 8_000_000;
const MAX_TRIANGLES: usize = 16_000_000;
/// Bounds render time: stacked full-frame triangles cost a frame each.
const MAX_PIXEL_TESTS: u64 = 1 << 32;

#[derive(Debug)]
pub struct ThumbnailError(pub String);

impl fmt::Display for ThumbnailError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for ThumbnailError {}

fn err<T>(message: impl Into<String>) -> Result<T, ThumbnailError> {
    Err(ThumbnailError(message.into()))
}

/// Render `glb` to a `size`×`size` RGBA PNG.
pub fn render_png(glb: &[u8], size: u32) -> Result<Vec<u8>, ThumbnailError> {
    let size = size.clamp(MIN_SIZE, MAX_SIZE) as usize;
    let doc = Doc::parse(glb)?;
    let triangles = doc.triangles()?;
    if triangles.indices.is_empty() {
        return err("GLB has no triangles to render");
    }
    let rgba = rasterize(&triangles, size)?;
    Ok(encode_png(&rgba, size))
}

// ---- GLB reading --------------------------------------------------------------

struct Doc<'a> {
    root: Value,
    bin: &'a [u8],
}

fn u32_le(bytes: &[u8], offset: usize) -> usize {
    u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ]) as usize
}

/// `bytes[offset..offset + length]`, or `None` when that runs past the end.
fn range(bytes: &[u8], offset: usize, length: usize) -> Option<&[u8]> {
    bytes.get(offset..offset.checked_add(length)?)
}

fn index_of(value: &Value) -> Option<usize> {
    value.as_u64().map(|v| v as usize)
}

impl<'a> Doc<'a> {
    fn parse(glb: &'a [u8]) -> Result<Self, ThumbnailError> {
        if glb.len() < 12 || &glb[0..4] != b"glTF" {
            return err("not a GLB");
        }
        let mut root = None;
        let mut bin: &[u8] = &[];
        let mut offset = 12;
        while offset + 8 <= glb.len() {
            let end = offset + 8 + u32_le(glb, offset);
            if end > glb.len() {
                return err("truncated GLB chunk");
            }
            let data = &glb[offset + 8..end];
            match &glb[offset + 4..offset + 8] {
                b"JSON" => {
                    root = Some(
                        serde_json::from_slice::<Value>(data)
                            .map_err(|e| ThumbnailError(format!("parse glTF json: {e}")))?,
                    )
                }
                b"BIN\0" => bin = data,
                _ => {}
            }
            offset = end;
        }
        match root {
            Some(root) => Ok(Doc { root, bin }),
            None => err("GLB has no JSON chunk"),
        }
    }

    /// The bytes of a bufferView, meshopt-decoded when it is compressed.
    fn view(&self, index: usize) -> Result<(Cow<'a, [u8]>, Option<usize>), ThumbnailError> {
        let view = &self.root["bufferViews"][index];
        if view.is_null() {
            return err(format!("bufferView {index} is missing"));
        }
        let meshopt = &view["extensions"]["EXT_meshopt_compression"];
        if meshopt.is_null() {
            if index_of(&view["buffer"]) != Some(0) {
                return err("only the GLB's own binary buffer is supported");
            }
            let offset = index_of(&view["byteOffset"]).unwrap_or(0);
            let length = index_of(&view["byteLength"]).unwrap_or(0);
            let bytes = range(self.bin, offset, length)
                .ok_or_else(|| ThumbnailError(format!("bufferView {index} is out of range")))?;
            return Ok((Cow::Borrowed(bytes), index_of(&view["byteStride"])));
        }

        if index_of(&meshopt["buffer"]) != Some(0) {
            return err("only the GLB's own binary buffer is supported");
        }
        let filter = meshopt["filter"].as_str().unwrap_or("NONE");
        if filter != "NONE" {
            return err(format!("meshopt filter {filter} is not supported"));
        }
        let offset = index_of(&meshopt["byteOffset"]).unwrap_or(0);
        let length = index_of(&meshopt["byteLength"]).unwrap_or(0);
        let stride = index_of(&meshopt["byteStride"]).unwrap_or(0);
        let count = index_of(&meshopt["count"]).unwrap_or(0);
        let mode = meshopt["mode"].as_str().unwrap_or("ATTRIBUTES");
        let source = range(self.bin, offset, length)
            .ok_or_else(|| ThumbnailError(format!("bufferView {index} is out of range")))?;

        // The C decoders assert on these instead of returning an error.
        let valid = match mode {
            "ATTRIBUTES" => stride % 4 == 0 && (4..=256).contains(&stride),
            "TRIANGLES" => (stride == 2 || stride == 4) && count % 3 == 0,
            "INDICES" => stride == 2 || stride == 4,
            _ => false,
        };
        if !valid {
            return err(format!("bufferView {index}: invalid meshopt {mode} view"));
        }
        let size = count
            .checked_mul(stride)
            .filter(|size| *size <= MAX_VIEW_BYTES)
            .ok_or_else(|| ThumbnailError(format!("bufferView {index} is too large")))?;
        let mut decoded = vec![0u8; size];
        // SAFETY: `decoded` holds exactly `count * stride` bytes, which is what
        // each decoder writes for the validated stride, and `source` is a live
        // slice of the given length.
        let status = unsafe {
            let destination = decoded.as_mut_ptr().cast();
            match mode {
                "ATTRIBUTES" => meshopt::ffi::meshopt_decodeVertexBuffer(
                    destination,
                    count,
                    stride,
                    source.as_ptr(),
                    source.len(),
                ),
                "TRIANGLES" => meshopt::ffi::meshopt_decodeIndexBuffer(
                    destination,
                    count,
                    stride,
                    source.as_ptr(),
                    source.len(),
                ),
                _ => meshopt::ffi::meshopt_decodeIndexSequence(
                    destination,
                    count,
                    stride,
                    source.as_ptr(),
                    source.len(),
                ),
            }
        };
        if status != 0 {
            return err(format!(
                "bufferView {index}: meshopt decode failed ({status})"
            ));
        }
        let byte_stride = (mode == "ATTRIBUTES").then_some(stride);
        Ok((Cow::Owned(decoded), byte_stride))
    }

    fn accessor(&self, index: usize) -> Result<Accessor<'a>, ThumbnailError> {
        let accessor = &self.root["accessors"][index];
        let Some(view_index) = index_of(&accessor["bufferView"]) else {
            return err(format!("accessor {index} has no bufferView"));
        };
        let component = index_of(&accessor["componentType"]).unwrap_or(0);
        let component_size = match component {
            5120 | 5121 => 1,
            5122 | 5123 => 2,
            5125 | 5126 => 4,
            other => return err(format!("accessor {index}: component type {other}")),
        };
        let components = match accessor["type"].as_str().unwrap_or("") {
            "SCALAR" => 1,
            "VEC2" => 2,
            "VEC3" => 3,
            "VEC4" => 4,
            other => return err(format!("accessor {index}: type {other}")),
        };
        let (data, view_stride) = self.view(view_index)?;
        let element = component_size * components;
        let stride = view_stride.filter(|s| *s >= element).unwrap_or(element);
        let offset = index_of(&accessor["byteOffset"]).unwrap_or(0);
        let count = index_of(&accessor["count"]).unwrap_or(0);
        let end = count
            .saturating_sub(1)
            .checked_mul(stride)
            .and_then(|last| last.checked_add(offset))
            .and_then(|start| start.checked_add(element));
        if count > 0 && end.is_none_or(|end| end > data.len()) {
            return err(format!("accessor {index} runs past its bufferView"));
        }
        Ok(Accessor {
            data,
            offset,
            stride,
            count,
            component,
            component_size,
            components,
            normalized: accessor["normalized"].as_bool().unwrap_or(false),
        })
    }

    /// Every triangle of the default scene, in world space.
    fn triangles(&self) -> Result<Triangles, ThumbnailError> {
        let nodes = self.root["nodes"].as_array().map_or(&[][..], Vec::as_slice);
        let scene = index_of(&self.root["scene"]).unwrap_or(0);
        let mut stack: Vec<(usize, Mat4)> = match self.root["scenes"][scene]["nodes"].as_array() {
            Some(roots) => roots
                .iter()
                .filter_map(index_of)
                .map(|n| (n, IDENTITY))
                .collect(),
            // No scene: every node that is nobody's child is a root.
            None => {
                let mut is_child = vec![false; nodes.len()];
                for node in nodes {
                    for child in node["children"].as_array().into_iter().flatten() {
                        if let Some(slot) = index_of(child).and_then(|c| is_child.get_mut(c)) {
                            *slot = true;
                        }
                    }
                }
                (0..nodes.len())
                    .filter(|n| !is_child[*n])
                    .map(|n| (n, IDENTITY))
                    .collect()
            }
        };

        let mut out = Triangles::default();
        let mut visits = 0;
        while let Some((index, parent)) = stack.pop() {
            visits += 1;
            if visits > MAX_NODE_VISITS {
                return err("scene graph is too large or cyclic");
            }
            let Some(node) = nodes.get(index) else {
                continue;
            };
            let world = multiply(&parent, &local_matrix(node));
            if let Some(mesh) = index_of(&node["mesh"]) {
                self.mesh_triangles(mesh, &world, &mut out)?;
            }
            for child in node["children"].as_array().into_iter().flatten() {
                if let Some(child) = index_of(child) {
                    stack.push((child, world));
                }
            }
        }
        Ok(out)
    }

    fn mesh_triangles(
        &self,
        mesh: usize,
        world: &Mat4,
        out: &mut Triangles,
    ) -> Result<(), ThumbnailError> {
        let primitives = self.root["meshes"][mesh]["primitives"].as_array();
        for primitive in primitives.into_iter().flatten() {
            if !primitive["extensions"]["KHR_draco_mesh_compression"].is_null() {
                return err("Draco-compressed GLBs are not supported");
            }
            // 4 = TRIANGLES, the default; points, lines, strips and fans are skipped.
            if index_of(&primitive["mode"]).unwrap_or(4) != 4 {
                continue;
            }
            let Some(position) = index_of(&primitive["attributes"]["POSITION"]) else {
                continue;
            };
            // Checked on the declared counts, before any view is decoded.
            let declared = |accessor: usize| index_of(&self.root["accessors"][accessor]["count"]);
            let declared_vertices = declared(position).unwrap_or(0);
            let declared_indices = index_of(&primitive["indices"])
                .and_then(declared)
                .unwrap_or(declared_vertices);
            if out.positions.len().saturating_add(declared_vertices) > MAX_VERTICES
                || out.indices.len().saturating_add(declared_indices / 3) > MAX_TRIANGLES
            {
                return err("model is too large to render a thumbnail");
            }
            let positions = self.accessor(position)?;
            if positions.components != 3 {
                continue;
            }
            let normals = match index_of(&primitive["attributes"]["NORMAL"]) {
                Some(normal) => Some(self.accessor(normal)?)
                    .filter(|n| n.components >= 3 && n.count == positions.count),
                None => None,
            };
            let indices = match index_of(&primitive["indices"]) {
                Some(indices) => Some(self.accessor(indices)?),
                None => None,
            };
            let color = index_of(&primitive["material"])
                .and_then(|m| {
                    let factor =
                        &self.root["materials"][m]["pbrMetallicRoughness"]["baseColorFactor"];
                    Some([
                        factor[0].as_f64()? as f32,
                        factor[1].as_f64()? as f32,
                        factor[2].as_f64()? as f32,
                    ])
                })
                .unwrap_or(DEFAULT_COLOR);

            let index_count = indices.as_ref().map_or(positions.count, |i| i.count);

            let base = out.positions.len() as u32;
            for i in 0..positions.count {
                out.positions.push(transform_point(
                    world,
                    [
                        positions.get(i, 0),
                        positions.get(i, 1),
                        positions.get(i, 2),
                    ],
                ));
            }
            // Per-vertex normals when the primitive has them, else none: the
            // rasteriser falls back to the face normal.
            if let Some(normals) = &normals {
                out.normals.resize(base as usize, [0.0; 3]);
                for i in 0..normals.count {
                    out.normals.push(transform_direction(
                        world,
                        [normals.get(i, 0), normals.get(i, 1), normals.get(i, 2)],
                    ));
                }
            }

            let vertex_count = positions.count as u32;
            let at = |i: usize| match &indices {
                Some(indices) => indices.get_index(i),
                None => i as u32,
            };
            for triangle in 0..index_count / 3 {
                let (a, b, c) = (at(triangle * 3), at(triangle * 3 + 1), at(triangle * 3 + 2));
                if a < vertex_count && b < vertex_count && c < vertex_count {
                    out.indices.push([base + a, base + b, base + c]);
                    out.colors.push(color);
                }
            }
        }
        Ok(())
    }
}

struct Accessor<'a> {
    data: Cow<'a, [u8]>,
    offset: usize,
    stride: usize,
    count: usize,
    component: usize,
    component_size: usize,
    components: usize,
    normalized: bool,
}

impl Accessor<'_> {
    fn bytes(&self, element: usize, component: usize) -> &[u8] {
        let start = self.offset + element * self.stride + component * self.component_size;
        &self.data[start..start + self.component_size]
    }

    fn get(&self, element: usize, component: usize) -> f32 {
        let b = self.bytes(element, component);
        let (value, max) = match self.component {
            5120 => (b[0] as i8 as f32, 127.0),
            5121 => (b[0] as f32, 255.0),
            5122 => (i16::from_le_bytes([b[0], b[1]]) as f32, 32767.0),
            5123 => (u16::from_le_bytes([b[0], b[1]]) as f32, 65535.0),
            5125 => (u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as f32, 1.0),
            _ => return f32::from_le_bytes([b[0], b[1], b[2], b[3]]),
        };
        if self.normalized {
            (value / max).max(-1.0)
        } else {
            value
        }
    }

    fn get_index(&self, element: usize) -> u32 {
        let b = self.bytes(element, 0);
        match self.component_size {
            1 => b[0] as u32,
            2 => u16::from_le_bytes([b[0], b[1]]) as u32,
            _ => u32::from_le_bytes([b[0], b[1], b[2], b[3]]),
        }
    }
}

/// World-space triangle soup. `normals` is either empty for a vertex (zero
/// vector, or shorter than `positions`) or its world-space normal.
#[derive(Default)]
struct Triangles {
    positions: Vec<[f32; 3]>,
    normals: Vec<[f32; 3]>,
    indices: Vec<[u32; 3]>,
    /// Linear RGB, one per triangle.
    colors: Vec<[f32; 3]>,
}

// ---- Transforms ---------------------------------------------------------------

/// Column-major, as glTF stores it.
type Mat4 = [f32; 16];

const IDENTITY: Mat4 = [
    1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

fn multiply(a: &Mat4, b: &Mat4) -> Mat4 {
    let mut out = [0.0; 16];
    for column in 0..4 {
        for row in 0..4 {
            out[column * 4 + row] = (0..4).map(|k| a[k * 4 + row] * b[column * 4 + k]).sum();
        }
    }
    out
}

fn floats<const N: usize>(value: &Value) -> Option<[f32; N]> {
    let array = value.as_array().filter(|a| a.len() == N)?;
    let mut out = [0.0; N];
    for (slot, v) in out.iter_mut().zip(array) {
        *slot = v.as_f64()? as f32;
    }
    Some(out)
}

fn local_matrix(node: &Value) -> Mat4 {
    if let Some(matrix) = floats::<16>(&node["matrix"]) {
        return matrix;
    }
    let t = floats::<3>(&node["translation"]).unwrap_or([0.0; 3]);
    let [x, y, z, w] = floats::<4>(&node["rotation"]).unwrap_or([0.0, 0.0, 0.0, 1.0]);
    let s = floats::<3>(&node["scale"]).unwrap_or([1.0; 3]);
    [
        (1.0 - 2.0 * (y * y + z * z)) * s[0],
        (2.0 * (x * y + z * w)) * s[0],
        (2.0 * (x * z - y * w)) * s[0],
        0.0,
        (2.0 * (x * y - z * w)) * s[1],
        (1.0 - 2.0 * (x * x + z * z)) * s[1],
        (2.0 * (y * z + x * w)) * s[1],
        0.0,
        (2.0 * (x * z + y * w)) * s[2],
        (2.0 * (y * z - x * w)) * s[2],
        (1.0 - 2.0 * (x * x + y * y)) * s[2],
        0.0,
        t[0],
        t[1],
        t[2],
        1.0,
    ]
}

fn transform_point(m: &Mat4, p: [f32; 3]) -> [f32; 3] {
    [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ]
}

/// Rotates a normal by the matrix's upper 3×3. Exact for rotations and uniform
/// scale, which is all the converter emits; a sheared normal is only a slightly
/// wrong shade.
fn transform_direction(m: &Mat4, d: [f32; 3]) -> [f32; 3] {
    [
        m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
        m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
        m[2] * d[0] + m[6] * d[1] + m[10] * d[2],
    ]
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn normalize(v: [f32; 3]) -> [f32; 3] {
    let length = dot(v, v).sqrt();
    if length > 0.0 {
        [v[0] / length, v[1] / length, v[2] / length]
    } else {
        v
    }
}

// ---- Rasteriser ---------------------------------------------------------------

/// Orthographic z-buffer render to straight-alpha RGBA, `size`×`size`.
fn rasterize(triangles: &Triangles, size: usize) -> Result<Vec<u8>, ThumbnailError> {
    let toward = normalize(VIEW_DIRECTION);
    let right = normalize(cross([0.0, 0.0, 1.0], toward));
    let up = cross(toward, right);
    // Key light over the viewer's left shoulder, a weaker fill from the right.
    let key = normalize([
        toward[0] - 0.6 * right[0] + 0.7 * up[0],
        toward[1] - 0.6 * right[1] + 0.7 * up[1],
        toward[2] - 0.6 * right[2] + 0.7 * up[2],
    ]);
    let fill = normalize([
        toward[0] + 0.9 * right[0] - 0.2 * up[0],
        toward[1] + 0.9 * right[1] - 0.2 * up[1],
        toward[2] + 0.9 * right[2] - 0.2 * up[2],
    ]);

    // Screen x / y and depth (larger is nearer) for every vertex.
    let projected: Vec<[f32; 3]> = triangles
        .positions
        .iter()
        .map(|p| [dot(*p, right), dot(*p, up), dot(*p, toward)])
        .collect();
    let mut min = [f32::INFINITY; 2];
    let mut max = [f32::NEG_INFINITY; 2];
    for p in projected
        .iter()
        .filter(|p| p[0].is_finite() && p[1].is_finite())
    {
        for axis in 0..2 {
            min[axis] = min[axis].min(p[axis]);
            max[axis] = max[axis].max(p[axis]);
        }
    }

    if !(min[0] <= max[0] && min[1] <= max[1]) {
        return err("GLB has no finite geometry to render");
    }

    let side = size * SUPERSAMPLE;
    let extent = (max[0] - min[0]).max(max[1] - min[1]).max(f32::EPSILON);
    let scale = side as f32 * (1.0 - 2.0 * MARGIN) / extent;
    let center = [(min[0] + max[0]) / 2.0, (min[1] + max[1]) / 2.0];
    let half = side as f32 / 2.0;
    let to_screen = |p: [f32; 3]| {
        [
            (p[0] - center[0]) * scale + half,
            // Image rows grow downwards.
            half - (p[1] - center[1]) * scale,
            p[2],
        ]
    };

    let mut depth = vec![f32::NEG_INFINITY; side * side];
    let mut color = vec![[0u8; 3]; side * side];
    let mut pixel_tests = 0u64;

    for (triangle, base_color) in triangles.indices.iter().zip(&triangles.colors) {
        let [ia, ib, ic] = triangle.map(|i| i as usize);
        let (a, b, c) = (
            to_screen(projected[ia]),
            to_screen(projected[ib]),
            to_screen(projected[ic]),
        );
        let area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if !area.is_finite() || area == 0.0 {
            continue;
        }
        let x0 = a[0].min(b[0]).min(c[0]).floor().max(0.0) as usize;
        let y0 = a[1].min(b[1]).min(c[1]).floor().max(0.0) as usize;
        let x1 = (a[0].max(b[0]).max(c[0]).ceil() as usize).min(side - 1);
        let y1 = (a[1].max(b[1]).max(c[1]).ceil() as usize).min(side - 1);
        if x0 > x1 || y0 > y1 {
            continue;
        }
        pixel_tests += ((x1 - x0 + 1) * (y1 - y0 + 1)) as u64;
        if pixel_tests > MAX_PIXEL_TESTS {
            return err("model is too complex to render a thumbnail");
        }

        let face = normalize(cross(
            sub(triangles.positions[ib], triangles.positions[ia]),
            sub(triangles.positions[ic], triangles.positions[ia]),
        ));
        let vertex_normal = |i: usize| {
            triangles
                .normals
                .get(i)
                .copied()
                .filter(|n| dot(*n, *n) > 0.0)
                .unwrap_or(face)
        };
        let (na, nb, nc) = (vertex_normal(ia), vertex_normal(ib), vertex_normal(ic));

        for y in y0..=y1 {
            for x in x0..=x1 {
                let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
                // Barycentric weights; inclusive edges, so neighbours sharing an
                // edge never leave a gap between them.
                let wa = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
                let wb = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
                let wc = 1.0 - wa - wb;
                if wa < 0.0 || wb < 0.0 || wc < 0.0 {
                    continue;
                }
                let z = wa * a[2] + wb * b[2] + wc * c[2];
                let pixel = y * side + x;
                if z <= depth[pixel] {
                    continue;
                }
                depth[pixel] = z;

                let mut normal = normalize([
                    wa * na[0] + wb * nb[0] + wc * nc[0],
                    wa * na[1] + wb * nb[1] + wc * nc[1],
                    wa * na[2] + wb * nb[2] + wc * nc[2],
                ]);
                // CAD exports are not reliably wound: light whichever side faces us.
                if dot(normal, toward) < 0.0 {
                    normal = [-normal[0], -normal[1], -normal[2]];
                }
                let light =
                    (0.32 + 0.6 * dot(normal, key).max(0.0) + 0.22 * dot(normal, fill).max(0.0))
                        .min(1.0);
                color[pixel] = base_color.map(|channel| to_srgb(channel * light));
            }
        }
    }

    // Box-filter the supersampled image down; coverage becomes alpha.
    let mut rgba = vec![0u8; size * size * 4];
    let samples = (SUPERSAMPLE * SUPERSAMPLE) as u32;
    for y in 0..size {
        for x in 0..size {
            let mut sum = [0u32; 3];
            let mut covered = 0u32;
            for sy in 0..SUPERSAMPLE {
                for sx in 0..SUPERSAMPLE {
                    let pixel = (y * SUPERSAMPLE + sy) * side + x * SUPERSAMPLE + sx;
                    if depth[pixel] > f32::NEG_INFINITY {
                        covered += 1;
                        for channel in 0..3 {
                            sum[channel] += color[pixel][channel] as u32;
                        }
                    }
                }
            }
            if covered > 0 {
                let out = &mut rgba[(y * size + x) * 4..][..4];
                for channel in 0..3 {
                    out[channel] = (sum[channel] / covered) as u8;
                }
                out[3] = (covered * 255 / samples) as u8;
            }
        }
    }
    Ok(rgba)
}

fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn to_srgb(linear: f32) -> u8 {
    let l = linear.clamp(0.0, 1.0);
    let encoded = if l <= 0.003_130_8 {
        12.92 * l
    } else {
        1.055 * l.powf(1.0 / 2.4) - 0.055
    };
    (encoded * 255.0 + 0.5) as u8
}

// ---- PNG ----------------------------------------------------------------------

/// 8-bit RGBA, no interlace. Each scanline is Sub-filtered, which shrinks the
/// flat background and smooth shading well under zlib.
fn encode_png(rgba: &[u8], size: usize) -> Vec<u8> {
    let row = size * 4;
    let mut filtered = Vec::with_capacity((row + 1) * size);
    for line in rgba.chunks_exact(row) {
        filtered.push(1); // filter type: Sub
        for (i, byte) in line.iter().enumerate() {
            let left = if i >= 4 { line[i - 4] } else { 0 };
            filtered.push(byte.wrapping_sub(left));
        }
    }
    let mut zlib = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::best());
    // Writing to a Vec cannot fail.
    zlib.write_all(&filtered).expect("zlib write");
    let compressed = zlib.finish().expect("zlib finish");

    let mut header = Vec::with_capacity(13);
    header.extend_from_slice(&(size as u32).to_be_bytes());
    header.extend_from_slice(&(size as u32).to_be_bytes());
    header.extend_from_slice(&[8, 6, 0, 0, 0]); // 8-bit, RGBA, deflate, no filter method, no interlace

    let mut png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    for (kind, data) in [
        (b"IHDR", header.as_slice()),
        (b"IDAT", compressed.as_slice()),
        (b"IEND", &[][..]),
    ] {
        png.extend_from_slice(&(data.len() as u32).to_be_bytes());
        png.extend_from_slice(kind);
        png.extend_from_slice(data);
        let mut crc = crc32fast::Hasher::new();
        crc.update(kind);
        crc.update(data);
        png.extend_from_slice(&crc.finalize().to_be_bytes());
    }
    png
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    /// A binary STL of the axis-aligned cube `[0, edge]³`.
    fn cube_stl(edge: f32) -> Vec<u8> {
        let v = |x: u8, y: u8, z: u8| [x as f32 * edge, y as f32 * edge, z as f32 * edge];
        let quads = [
            [v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)],
            [v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)],
            [v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)],
            [v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)],
            [v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)],
            [v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)],
        ];
        let mut stl = vec![0u8; 80];
        stl.extend_from_slice(&12u32.to_le_bytes());
        for quad in quads {
            for triangle in [[quad[0], quad[1], quad[2]], [quad[0], quad[2], quad[3]]] {
                let normal = normalize(cross(
                    sub(triangle[1], triangle[0]),
                    sub(triangle[2], triangle[0]),
                ));
                for vector in [normal, triangle[0], triangle[1], triangle[2]] {
                    for component in vector {
                        stl.extend_from_slice(&component.to_le_bytes());
                    }
                }
                stl.extend_from_slice(&[0, 0]);
            }
        }
        stl
    }

    fn alpha(rgba: &[u8], size: usize, x: usize, y: usize) -> u8 {
        rgba[(y * size + x) * 4 + 3]
    }

    fn render(glb: &[u8], size: usize) -> Vec<u8> {
        rasterize(&Doc::parse(glb).unwrap().triangles().unwrap(), size).unwrap()
    }

    #[test]
    fn a_cube_fills_the_middle_and_leaves_the_corners_transparent() {
        let glb = optimize::stl_to_glb(&cube_stl(10.0)).unwrap();
        let size = 96;
        let rgba = render(&glb, size);

        assert_eq!(alpha(&rgba, size, size / 2, size / 2), 255);
        for (x, y) in [(0, 0), (size - 1, 0), (0, size - 1), (size - 1, size - 1)] {
            assert_eq!(alpha(&rgba, size, x, y), 0, "corner {x},{y}");
        }
        // Three faces are visible from the isometric direction, each lit
        // differently: the top (key light) is the brightest.
        let luma = |x: usize, y: usize| rgba[(y * size + x) * 4];
        let top = luma(size / 2, size / 4);
        let left = luma(size / 3, size * 2 / 3);
        let right = luma(size * 2 / 3, size * 2 / 3);
        assert!(
            top > left && top > right,
            "top {top}, left {left}, right {right}"
        );
        assert_ne!(left, right);
    }

    #[test]
    fn the_model_is_framed_whatever_its_size_or_position() {
        let small = render(&optimize::stl_to_glb(&cube_stl(0.001)).unwrap(), 64);
        let large = render(&optimize::stl_to_glb(&cube_stl(5000.0)).unwrap(), 64);
        assert_eq!(small, large);
    }

    #[test]
    fn a_meshopt_compressed_glb_renders_like_the_plain_one() {
        let plain = optimize::stl_to_glb(&cube_stl(10.0)).unwrap();
        let options = |codec| optimize::Options {
            codec,
            ..Default::default()
        };
        // Both go through the same weld + reorder, so only the encoding differs.
        let reference = optimize::optimize_glb(&plain, &options(optimize::Codec::None))
            .unwrap()
            .glb;
        let compressed = optimize::optimize_glb(&plain, &options(optimize::Codec::Meshopt))
            .unwrap()
            .glb;
        assert!(String::from_utf8_lossy(&compressed).contains("EXT_meshopt_compression"));

        assert_eq!(render(&compressed, 96), render(&reference, 96));
    }

    #[test]
    fn the_png_is_a_valid_rgba_image_of_the_requested_size() {
        let glb = optimize::stl_to_glb(&cube_stl(10.0)).unwrap();
        let png = render_png(&glb, 64).unwrap();

        assert_eq!(&png[..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
        assert_eq!(&png[12..16], b"IHDR");
        assert_eq!(u32::from_be_bytes(png[16..20].try_into().unwrap()), 64);
        assert_eq!(u32::from_be_bytes(png[20..24].try_into().unwrap()), 64);
        assert_eq!(&png[24..29], &[8, 6, 0, 0, 0]);
        assert_eq!(&png[png.len() - 8..png.len() - 4], b"IEND");

        // IHDR is 25 bytes after the signature; IDAT's length and data follow.
        let length = u32::from_be_bytes(png[33..37].try_into().unwrap()) as usize;
        assert_eq!(&png[37..41], b"IDAT");
        let mut scanlines = Vec::new();
        flate2::read::ZlibDecoder::new(&png[41..41 + length])
            .read_to_end(&mut scanlines)
            .unwrap();
        assert_eq!(scanlines.len(), (64 * 4 + 1) * 64);
    }

    /// A GLB of `vertices / 3` copies of one triangle, whose JSON the test can rewrite.
    fn triangle_glb(vertices: usize, edit: impl Fn(&mut Value)) -> Vec<u8> {
        let mut bin = Vec::new();
        for _ in 0..vertices / 3 {
            for value in [0.0f32, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0] {
                bin.extend_from_slice(&value.to_le_bytes());
            }
        }
        let mut root = serde_json::json!({
            "asset": { "version": "2.0" },
            "scene": 0,
            "scenes": [{ "nodes": [0] }],
            "nodes": [{ "mesh": 0 }],
            "meshes": [{ "primitives": [{ "attributes": { "POSITION": 0 } }] }],
            "accessors": [{
                "bufferView": 0, "componentType": 5126, "count": vertices, "type": "VEC3"
            }],
            "bufferViews": [{ "buffer": 0, "byteLength": bin.len() }],
            "buffers": [{ "byteLength": bin.len() }],
        });
        edit(&mut root);
        let mut json = serde_json::to_vec(&root).unwrap();
        while json.len() % 4 != 0 {
            json.push(b' ');
        }
        let mut glb = Vec::from(*b"glTF");
        glb.extend_from_slice(&2u32.to_le_bytes());
        glb.extend_from_slice(&((28 + json.len() + bin.len()) as u32).to_le_bytes());
        glb.extend_from_slice(&(json.len() as u32).to_le_bytes());
        glb.extend_from_slice(b"JSON");
        glb.extend_from_slice(&json);
        glb.extend_from_slice(&(bin.len() as u32).to_le_bytes());
        glb.extend_from_slice(b"BIN\0");
        glb.extend_from_slice(&bin);
        glb
    }

    fn message(glb: &[u8]) -> String {
        render_png(glb, 64).unwrap_err().0
    }

    #[test]
    fn counts_the_file_cannot_back_are_errors_not_allocations() {
        assert!(render_png(&triangle_glb(3, |_| {}), 64).is_ok());

        // An accessor claiming more elements than its view holds.
        let glb = triangle_glb(3, |root| root["accessors"][0]["count"] = 1_000.into());
        assert!(message(&glb).contains("runs past its bufferView"));

        let glb = triangle_glb(3, |root| root["accessors"][0]["count"] = u64::MAX.into());
        assert!(message(&glb).contains("too large to render"));

        // A compressed view claiming a decoded size no machine has.
        let glb = triangle_glb(3, |root| {
            root["bufferViews"][0]["extensions"] = serde_json::json!({
                "EXT_meshopt_compression": {
                    "buffer": 0, "byteLength": 36, "byteStride": 12,
                    "count": u64::MAX / 16, "mode": "ATTRIBUTES"
                }
            });
        });
        assert!(message(&glb).contains("too large"));

        // A mesh instanced past the vertex ceiling.
        let glb = triangle_glb(9_000, |root| {
            let instances = MAX_VERTICES / 9_000 + 1;
            root["nodes"] = Value::Array(vec![serde_json::json!({ "mesh": 0 }); instances]);
            root["scenes"][0]["nodes"] = (0..instances).collect::<Vec<_>>().into();
        });
        assert!(message(&glb).contains("too large to render"));

        // Geometry with no finite coordinate to frame.
        let glb = triangle_glb(3, |root| {
            root["nodes"] = serde_json::json!([
                { "children": [1], "scale": [f32::MAX, f32::MAX, f32::MAX] },
                { "mesh": 0, "scale": [f32::MAX, f32::MAX, f32::MAX] }
            ]);
        });
        assert!(message(&glb).contains("no finite geometry"));
    }

    #[test]
    fn input_that_cannot_be_rendered_is_an_error() {
        assert!(render_png(b"not a glb", 64).is_err());
        let mut truncated = optimize::stl_to_glb(&cube_stl(10.0)).unwrap();
        truncated.truncate(truncated.len() - 16);
        assert!(render_png(&truncated, 64).is_err());
    }
}
