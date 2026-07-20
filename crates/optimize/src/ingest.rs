//! Mesh-format ingest: OBJ / PLY / OFF / dotbim → uncompressed, weldable GLB.
//!
//! Mirrors `stl_to_glb`'s strategy: every format is expanded to a flat triangle
//! soup (positions + per-face or carried normals) and built into a single-mesh
//! GLB via `build_triangle_glb`. Sharing/topology is deliberately NOT preserved
//! here — the optimiser's weld pass reconstructs it (that is its job), then
//! simplifies and encodes like any other input. Fail loud on malformed input;
//! never emit an empty mesh.

use crate::{build_triangle_glb, OptimizeError};

/// Wavefront OBJ. Geometry only: `v` + `f` (polygons fan-triangulated, negative
/// and 1-based indices per spec). Materials/uv/vn are ignored — per-face normals
/// are recomputed, matching the STL path.
pub fn obj_to_glb(bytes: &[u8]) -> Result<Vec<u8>, OptimizeError> {
    let text =
        std::str::from_utf8(bytes).map_err(|_| OptimizeError::new("OBJ is not valid UTF-8"))?;
    let mut vertices: Vec<[f32; 3]> = Vec::new();
    let mut triangles: Vec<[usize; 3]> = Vec::new();

    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("v ") {
            let mut it = rest.split_whitespace().filter_map(|t| t.parse::<f32>().ok());
            match (it.next(), it.next(), it.next()) {
                (Some(x), Some(y), Some(z)) => vertices.push([x, y, z]),
                _ => return Err(OptimizeError::new("OBJ vertex with fewer than 3 coords")),
            }
        } else if let Some(rest) = line.strip_prefix("f ") {
            // Each face token is `v`, `v/vt`, `v//vn`, or `v/vt/vn`; only the
            // vertex index matters here. Negative = relative to current count.
            let mut face: Vec<usize> = Vec::new();
            for token in rest.split_whitespace() {
                let first = token.split('/').next().unwrap_or("");
                let idx: i64 = first
                    .parse()
                    .map_err(|_| OptimizeError::new("OBJ face has a non-numeric index"))?;
                let resolved = if idx < 0 {
                    vertices.len() as i64 + idx
                } else {
                    idx - 1
                };
                if resolved < 0 || resolved as usize >= vertices.len() {
                    return Err(OptimizeError::new("OBJ face index out of range"));
                }
                face.push(resolved as usize);
            }
            fan_triangulate(&face, &mut triangles);
        }
    }
    soup_to_glb(&vertices, &triangles, "OBJ")
}

/// OFF (Object File Format): counts line, vertices, polygon faces.
pub fn off_to_glb(bytes: &[u8]) -> Result<Vec<u8>, OptimizeError> {
    let text =
        std::str::from_utf8(bytes).map_err(|_| OptimizeError::new("OFF is not valid UTF-8"))?;
    let mut tokens = text
        .lines()
        .map(|l| l.split('#').next().unwrap_or("").trim())
        .filter(|l| !l.is_empty())
        .flat_map(|l| l.split_whitespace())
        .peekable();

    if tokens.peek() == Some(&"OFF") {
        tokens.next();
    }
    let mut next_usize = |what: &str| -> Result<usize, OptimizeError> {
        tokens
            .next()
            .and_then(|t| t.parse::<usize>().ok())
            .ok_or_else(|| OptimizeError::new(format!("OFF: missing/invalid {what}")))
    };
    let n_vertices = next_usize("vertex count")?;
    let n_faces = next_usize("face count")?;
    let _n_edges = tokens.next(); // unused

    let mut vertices: Vec<[f32; 3]> = Vec::with_capacity(n_vertices);
    for _ in 0..n_vertices {
        let mut coord = [0.0f32; 3];
        for c in &mut coord {
            *c = tokens
                .next()
                .and_then(|t| t.parse().ok())
                .ok_or_else(|| OptimizeError::new("OFF: truncated vertex"))?;
        }
        vertices.push(coord);
    }
    let mut triangles: Vec<[usize; 3]> = Vec::new();
    for _ in 0..n_faces {
        let count = tokens
            .next()
            .and_then(|t| t.parse::<usize>().ok())
            .ok_or_else(|| OptimizeError::new("OFF: truncated face"))?;
        let mut face = Vec::with_capacity(count);
        for _ in 0..count {
            let idx = tokens
                .next()
                .and_then(|t| t.parse::<usize>().ok())
                .ok_or_else(|| OptimizeError::new("OFF: truncated face index"))?;
            if idx >= vertices.len() {
                return Err(OptimizeError::new("OFF face index out of range"));
            }
            face.push(idx);
        }
        fan_triangulate(&face, &mut triangles);
    }
    soup_to_glb(&vertices, &triangles, "OFF")
}

/// dotbim (`.bim`): plain JSON — shared meshes instanced by elements carrying a
/// translation + quaternion. Transforms are baked into the soup; colors are not
/// carried (the optimise pipeline is geometry-only).
pub fn bim_to_glb(bytes: &[u8]) -> Result<Vec<u8>, OptimizeError> {
    let parsed: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|_| OptimizeError::new("dotbim is not valid JSON"))?;
    let meshes = parsed["meshes"]
        .as_array()
        .ok_or_else(|| OptimizeError::new("dotbim has no meshes array"))?;

    // mesh_id -> (vertices, triangles)
    let mut library: std::collections::HashMap<i64, (Vec<[f32; 3]>, Vec<[usize; 3]>)> =
        std::collections::HashMap::new();
    for mesh in meshes {
        let id = mesh["mesh_id"]
            .as_i64()
            .ok_or_else(|| OptimizeError::new("dotbim mesh without mesh_id"))?;
        let coords: Vec<f32> = mesh["coordinates"]
            .as_array()
            .ok_or_else(|| OptimizeError::new("dotbim mesh without coordinates"))?
            .iter()
            .filter_map(|v| v.as_f64().map(|f| f as f32))
            .collect();
        let indices: Vec<usize> = mesh["indices"]
            .as_array()
            .ok_or_else(|| OptimizeError::new("dotbim mesh without indices"))?
            .iter()
            .filter_map(|v| v.as_u64().map(|u| u as usize))
            .collect();
        if coords.len() % 3 != 0 || indices.len() % 3 != 0 {
            return Err(OptimizeError::new("dotbim mesh arrays not multiples of 3"));
        }
        let vertices: Vec<[f32; 3]> = coords.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect();
        for &i in &indices {
            if i >= vertices.len() {
                return Err(OptimizeError::new("dotbim index out of range"));
            }
        }
        let triangles = indices.chunks_exact(3).map(|t| [t[0], t[1], t[2]]).collect();
        library.insert(id, (vertices, triangles));
    }

    // Elements instance the meshes; absent/empty elements = render meshes once.
    let default_elements: Vec<serde_json::Value>;
    let elements = match parsed["elements"].as_array() {
        Some(arr) if !arr.is_empty() => arr,
        _ => {
            default_elements = library
                .keys()
                .map(|id| serde_json::json!({ "mesh_id": id }))
                .collect();
            &default_elements
        }
    };

    let mut positions: Vec<[f32; 3]> = Vec::new();
    let mut normals: Vec<[f32; 3]> = Vec::new();
    for el in elements {
        let Some((vertices, triangles)) = el["mesh_id"].as_i64().and_then(|id| library.get(&id))
        else {
            continue;
        };
        let q = &el["rotation"];
        let quat = [
            q["qx"].as_f64().unwrap_or(0.0) as f32,
            q["qy"].as_f64().unwrap_or(0.0) as f32,
            q["qz"].as_f64().unwrap_or(0.0) as f32,
            q["qw"].as_f64().unwrap_or(1.0) as f32,
        ];
        let v = &el["vector"];
        let translate = [
            v["x"].as_f64().unwrap_or(0.0) as f32,
            v["y"].as_f64().unwrap_or(0.0) as f32,
            v["z"].as_f64().unwrap_or(0.0) as f32,
        ];
        for tri in triangles {
            let p: Vec<[f32; 3]> = tri
                .iter()
                .map(|&i| {
                    let r = rotate(quat, vertices[i]);
                    [
                        r[0] + translate[0],
                        r[1] + translate[1],
                        r[2] + translate[2],
                    ]
                })
                .collect();
            let n = face_normal(p[0], p[1], p[2]);
            positions.extend_from_slice(&p);
            normals.extend_from_slice(&[n, n, n]);
        }
    }
    if positions.is_empty() {
        return Err(OptimizeError::new("dotbim contains no renderable geometry"));
    }
    build_triangle_glb(&positions, &normals)
}

/// PLY: ascii and binary_little_endian, the two formats seen in the wild for
/// exports. Vertex x/y/z are read; other vertex properties are skipped by size;
/// faces are `property list` polygons, fan-triangulated.
pub fn ply_to_glb(bytes: &[u8]) -> Result<Vec<u8>, OptimizeError> {
    let header_end = find_subslice(bytes, b"end_header\n")
        .ok_or_else(|| OptimizeError::new("PLY has no end_header"))?
        + b"end_header\n".len();
    let header = std::str::from_utf8(&bytes[..header_end])
        .map_err(|_| OptimizeError::new("PLY header is not UTF-8"))?;

    #[derive(Clone, Copy, PartialEq)]
    enum Fmt {
        Ascii,
        BinaryLe,
    }
    let mut fmt = None;
    // (element name, count, per-element property sizes/kinds)
    struct Elem {
        name: String,
        count: usize,
        // scalar property byte sizes in order; x/y/z positions tracked by index
        props: Vec<(String, usize)>,
        list: Option<(usize, usize)>, // (count-type size, item-type size) for face lists
    }
    let mut elems: Vec<Elem> = Vec::new();

    for line in header.lines() {
        let mut it = line.split_whitespace();
        match it.next() {
            Some("format") => {
                fmt = match it.next() {
                    Some("ascii") => Some(Fmt::Ascii),
                    Some("binary_little_endian") => Some(Fmt::BinaryLe),
                    other => {
                        return Err(OptimizeError::new(format!(
                            "unsupported PLY format: {}",
                            other.unwrap_or("?")
                        )))
                    }
                };
            }
            Some("element") => {
                let name = it.next().unwrap_or("").to_string();
                let count = it
                    .next()
                    .and_then(|t| t.parse().ok())
                    .ok_or_else(|| OptimizeError::new("PLY element without count"))?;
                elems.push(Elem {
                    name,
                    count,
                    props: Vec::new(),
                    list: None,
                });
            }
            Some("property") => {
                let Some(elem) = elems.last_mut() else { continue };
                let kind = it.next().unwrap_or("");
                if kind == "list" {
                    let count_size = ply_type_size(it.next().unwrap_or(""))?;
                    let item_size = ply_type_size(it.next().unwrap_or(""))?;
                    elem.list = Some((count_size, item_size));
                } else {
                    let size = ply_type_size(kind)?;
                    let name = it.next().unwrap_or("").to_string();
                    elem.props.push((name, size));
                }
            }
            _ => {}
        }
    }
    let fmt = fmt.ok_or_else(|| OptimizeError::new("PLY has no format line"))?;

    let mut vertices: Vec<[f32; 3]> = Vec::new();
    let mut triangles: Vec<[usize; 3]> = Vec::new();

    match fmt {
        Fmt::Ascii => {
            let body = std::str::from_utf8(&bytes[header_end..])
                .map_err(|_| OptimizeError::new("ASCII PLY body is not UTF-8"))?;
            let mut lines = body.lines().filter(|l| !l.trim().is_empty());
            for elem in &elems {
                for _ in 0..elem.count {
                    let line = lines
                        .next()
                        .ok_or_else(|| OptimizeError::new("PLY body truncated"))?;
                    let tokens: Vec<&str> = line.split_whitespace().collect();
                    if elem.name == "vertex" {
                        vertices.push(read_ply_vertex_ascii(&tokens, &elem.props)?);
                    } else if elem.list.is_some() {
                        let count: usize = tokens
                            .first()
                            .and_then(|t| t.parse().ok())
                            .ok_or_else(|| OptimizeError::new("PLY face without count"))?;
                        let face: Vec<usize> = tokens
                            .iter()
                            .skip(1)
                            .take(count)
                            .filter_map(|t| t.parse().ok())
                            .collect();
                        if face.len() != count {
                            return Err(OptimizeError::new("PLY face truncated"));
                        }
                        push_face(&face, vertices.len(), &mut triangles)?;
                    }
                }
            }
        }
        Fmt::BinaryLe => {
            let mut off = header_end;
            let read_f32 = |bytes: &[u8], off: usize| -> Result<f32, OptimizeError> {
                bytes
                    .get(off..off + 4)
                    .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                    .ok_or_else(|| OptimizeError::new("PLY body truncated"))
            };
            for elem in &elems {
                for _ in 0..elem.count {
                    if elem.name == "vertex" {
                        let mut coord = [0.0f32; 3];
                        let mut cursor = off;
                        for (name, size) in &elem.props {
                            match name.as_str() {
                                "x" => coord[0] = read_f32(bytes, cursor)?,
                                "y" => coord[1] = read_f32(bytes, cursor)?,
                                "z" => coord[2] = read_f32(bytes, cursor)?,
                                _ => {}
                            }
                            cursor += size;
                        }
                        vertices.push(coord);
                        off = cursor;
                    } else if let Some((count_size, item_size)) = elem.list {
                        let count = read_uint_le(bytes, off, count_size)? as usize;
                        off += count_size;
                        let mut face = Vec::with_capacity(count);
                        for _ in 0..count {
                            face.push(read_uint_le(bytes, off, item_size)? as usize);
                            off += item_size;
                        }
                        push_face(&face, vertices.len(), &mut triangles)?;
                    } else {
                        // Unknown fixed-size element: skip its bytes.
                        off += elem.props.iter().map(|(_, s)| s).sum::<usize>();
                    }
                }
            }
        }
    }
    soup_to_glb(&vertices, &triangles, "PLY")
}

// ---- shared helpers ----------------------------------------------------------

fn fan_triangulate(face: &[usize], out: &mut Vec<[usize; 3]>) {
    for t in 1..face.len().saturating_sub(1) {
        out.push([face[0], face[t], face[t + 1]]);
    }
}

fn push_face(
    face: &[usize],
    vertex_count: usize,
    out: &mut Vec<[usize; 3]>,
) -> Result<(), OptimizeError> {
    if face.iter().any(|&i| i >= vertex_count) {
        return Err(OptimizeError::new("PLY face index out of range"));
    }
    fan_triangulate(face, out);
    Ok(())
}

/// Expand an indexed polygon soup to flat triangles with per-face normals and
/// build the GLB (the optimiser welds it back).
fn soup_to_glb(
    vertices: &[[f32; 3]],
    triangles: &[[usize; 3]],
    what: &str,
) -> Result<Vec<u8>, OptimizeError> {
    if triangles.is_empty() {
        return Err(OptimizeError::new(format!("{what} has no triangles")));
    }
    let mut positions = Vec::with_capacity(triangles.len() * 3);
    let mut normals = Vec::with_capacity(triangles.len() * 3);
    for tri in triangles {
        let [a, b, c] = [vertices[tri[0]], vertices[tri[1]], vertices[tri[2]]];
        let n = face_normal(a, b, c);
        positions.extend_from_slice(&[a, b, c]);
        normals.extend_from_slice(&[n, n, n]);
    }
    build_triangle_glb(&positions, &normals)
}

fn face_normal(a: [f32; 3], b: [f32; 3], c: [f32; 3]) -> [f32; 3] {
    let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
    ];
    let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
    if len > 0.0 {
        [n[0] / len, n[1] / len, n[2] / len]
    } else {
        [0.0, 0.0, 1.0]
    }
}

/// Rotate a point by a quaternion (x, y, z, w).
fn rotate(q: [f32; 4], p: [f32; 3]) -> [f32; 3] {
    let [qx, qy, qz, qw] = q;
    // v' = v + 2q × (q × v + w v)
    let cx = qy * p[2] - qz * p[1] + qw * p[0];
    let cy = qz * p[0] - qx * p[2] + qw * p[1];
    let cz = qx * p[1] - qy * p[0] + qw * p[2];
    [
        p[0] + 2.0 * (qy * cz - qz * cy),
        p[1] + 2.0 * (qz * cx - qx * cz),
        p[2] + 2.0 * (qx * cy - qy * cx),
    ]
}

fn ply_type_size(t: &str) -> Result<usize, OptimizeError> {
    match t {
        "char" | "uchar" | "int8" | "uint8" => Ok(1),
        "short" | "ushort" | "int16" | "uint16" => Ok(2),
        "int" | "uint" | "int32" | "uint32" | "float" | "float32" => Ok(4),
        "double" | "float64" => Ok(8),
        other => Err(OptimizeError::new(format!("unknown PLY type: {other}"))),
    }
}

fn read_uint_le(bytes: &[u8], off: usize, size: usize) -> Result<u64, OptimizeError> {
    let slice = bytes
        .get(off..off + size)
        .ok_or_else(|| OptimizeError::new("PLY body truncated"))?;
    let mut value = 0u64;
    for (i, b) in slice.iter().enumerate() {
        value |= (*b as u64) << (8 * i);
    }
    Ok(value)
}

fn read_ply_vertex_ascii(
    tokens: &[&str],
    props: &[(String, usize)],
) -> Result<[f32; 3], OptimizeError> {
    let mut coord = [0.0f32; 3];
    for (i, (name, _)) in props.iter().enumerate() {
        let slot = match name.as_str() {
            "x" => 0,
            "y" => 1,
            "z" => 2,
            _ => continue,
        };
        coord[slot] = tokens
            .get(i)
            .and_then(|t| t.parse().ok())
            .ok_or_else(|| OptimizeError::new("PLY vertex missing coordinate"))?;
    }
    Ok(coord)
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tri_count(glb: &[u8]) -> usize {
        let stats = crate::optimize_glb(glb, &crate::Options::default())
            .expect("optimize parses ingested glb")
            .stats;
        stats.input_triangles
    }

    #[test]
    fn obj_quad_fan_triangulates() {
        let obj = b"v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n";
        let glb = obj_to_glb(obj).unwrap();
        assert_eq!(tri_count(&glb), 2);
    }

    #[test]
    fn obj_negative_and_slashed_indices() {
        let obj = b"v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3/1/1 -2/2/2 -1/3/3\n";
        let glb = obj_to_glb(obj).unwrap();
        assert_eq!(tri_count(&glb), 1);
    }

    #[test]
    fn off_polygon_faces() {
        let off = b"OFF\n4 1 0\n0 0 0\n1 0 0\n1 1 0\n0 1 0\n4 0 1 2 3\n";
        let glb = off_to_glb(off).unwrap();
        assert_eq!(tri_count(&glb), 2);
    }

    #[test]
    fn ply_ascii_roundtrip() {
        let ply = b"ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n";
        let glb = ply_to_glb(ply).unwrap();
        assert_eq!(tri_count(&glb), 1);
    }

    #[test]
    fn ply_binary_le_roundtrip() {
        let mut ply: Vec<u8> = b"ply\nformat binary_little_endian 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar uint vertex_indices\nend_header\n".to_vec();
        for v in [[0f32, 0., 0.], [1., 0., 0.], [0., 1., 0.]] {
            for c in v {
                ply.extend_from_slice(&c.to_le_bytes());
            }
        }
        ply.push(3);
        for i in [0u32, 1, 2] {
            ply.extend_from_slice(&i.to_le_bytes());
        }
        let glb = ply_to_glb(&ply).unwrap();
        assert_eq!(tri_count(&glb), 1);
    }

    #[test]
    fn bim_instanced_elements() {
        let bim = serde_json::json!({
            "schema_version": "1.1.0",
            "meshes": [{ "mesh_id": 0,
                "coordinates": [0,0,0, 1,0,0, 0,1,0],
                "indices": [0,1,2] }],
            "elements": [
                { "mesh_id": 0, "vector": {"x":0,"y":0,"z":0},
                  "rotation": {"qx":0,"qy":0,"qz":0,"qw":1} },
                { "mesh_id": 0, "vector": {"x":5,"y":0,"z":0},
                  "rotation": {"qx":0,"qy":0,"qz":0,"qw":1} }
            ]
        });
        let glb = bim_to_glb(bim.to_string().as_bytes()).unwrap();
        assert_eq!(tri_count(&glb), 2);
    }

    #[test]
    fn rejects_empty_or_garbage() {
        assert!(obj_to_glb(b"v 0 0 0\n").is_err());
        assert!(off_to_glb(b"OFF\n0 0 0\n").is_err());
        assert!(bim_to_glb(b"{}").is_err());
        assert!(ply_to_glb(b"not a ply").is_err());
    }
}
