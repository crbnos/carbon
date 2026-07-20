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

/// 3MF: a zip whose `3D/3dmodel.model` entry is the model XML — objects hold
/// meshes (and/or components referencing other objects with a 4x3 transform);
/// `<build>` items place objects. Transforms are baked in; units scaled to mm.
pub fn threemf_to_glb(bytes: &[u8]) -> Result<Vec<u8>, OptimizeError> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|_| OptimizeError::new("3MF is not a valid zip archive"))?;
    let model_name = (0..archive.len())
        .filter_map(|i| archive.by_index(i).ok().map(|f| f.name().to_string()))
        .find(|n| n == "3D/3dmodel.model" || n.ends_with(".model"))
        .ok_or_else(|| OptimizeError::new("3MF has no 3dmodel.model entry"))?;
    let mut xml = Vec::new();
    {
        use std::io::Read;
        let mut entry = archive
            .by_name(&model_name)
            .map_err(|_| OptimizeError::new("3MF model entry unreadable"))?;
        entry
            .read_to_end(&mut xml)
            .map_err(|_| OptimizeError::new("3MF model entry unreadable"))?;
    }
    parse_3mf_model(&xml)
}

fn parse_3mf_model(xml: &[u8]) -> Result<Vec<u8>, OptimizeError> {
    use quick_xml::events::Event;

    struct ObjectData {
        vertices: Vec<[f32; 3]>,
        triangles: Vec<[usize; 3]>,
        components: Vec<(String, [f32; 12])>,
    }
    let mut objects: std::collections::HashMap<String, ObjectData> =
        std::collections::HashMap::new();
    let mut build: Vec<(String, [f32; 12])> = Vec::new();
    let mut unit_scale = 1.0f32; // millimeter default

    let mut reader = quick_xml::Reader::from_reader(xml);
    reader.config_mut().trim_text(true);
    let mut current: Option<String> = None;
    let mut buf = Vec::new();
    loop {
        let event = reader
            .read_event_into(&mut buf)
            .map_err(|e| OptimizeError::new(format!("3MF XML error: {e}")))?;
        match &event {
            Event::Start(e) | Event::Empty(e) => {
                let attr = |name: &str| -> Option<String> {
                    e.attributes().flatten().find_map(|a| {
                        (a.key.as_ref() == name.as_bytes())
                            .then(|| String::from_utf8_lossy(&a.value).into_owned())
                    })
                };
                match e.local_name().as_ref() {
                    b"model" => {
                        unit_scale = unit_to_mm(attr("unit").as_deref().unwrap_or("millimeter"))?;
                    }
                    b"object" => {
                        if let Some(id) = attr("id") {
                            objects.insert(
                                id.clone(),
                                ObjectData {
                                    vertices: Vec::new(),
                                    triangles: Vec::new(),
                                    components: Vec::new(),
                                },
                            );
                            current = Some(id);
                        }
                    }
                    b"vertex" => {
                        let Some(obj) = current.as_ref().and_then(|id| objects.get_mut(id)) else {
                            continue;
                        };
                        let coord = |n: &str| -> f32 {
                            attr(n).and_then(|v| v.parse().ok()).unwrap_or(0.0)
                        };
                        obj.vertices.push([coord("x"), coord("y"), coord("z")]);
                    }
                    b"triangle" => {
                        let Some(obj) = current.as_ref().and_then(|id| objects.get_mut(id)) else {
                            continue;
                        };
                        let idx = |n: &str| -> Option<usize> { attr(n)?.parse().ok() };
                        if let (Some(v1), Some(v2), Some(v3)) = (idx("v1"), idx("v2"), idx("v3")) {
                            if v1 >= obj.vertices.len()
                                || v2 >= obj.vertices.len()
                                || v3 >= obj.vertices.len()
                            {
                                return Err(OptimizeError::new("3MF triangle index out of range"));
                            }
                            obj.triangles.push([v1, v2, v3]);
                        }
                    }
                    b"component" => {
                        let Some(obj) = current.as_ref().and_then(|id| objects.get_mut(id)) else {
                            continue;
                        };
                        if let Some(refid) = attr("objectid") {
                            obj.components
                                .push((refid, parse_3mf_transform(attr("transform").as_deref())));
                        }
                    }
                    b"item" => {
                        if let Some(id) = attr("objectid") {
                            build.push((id, parse_3mf_transform(attr("transform").as_deref())));
                        }
                    }
                    _ => {}
                }
            }
            Event::End(e) => {
                if e.local_name().as_ref() == b"object" {
                    current = None;
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }

    // No <build> section: render every object once.
    if build.is_empty() {
        build = objects.keys().map(|id| (id.clone(), IDENTITY_4X3)).collect();
    }

    let mut positions: Vec<[f32; 3]> = Vec::new();
    let mut normals: Vec<[f32; 3]> = Vec::new();
    // Recursively emit an object (mesh + components) under an accumulated transform.
    fn emit(
        id: &str,
        transform: [f32; 12],
        objects: &std::collections::HashMap<
            String,
            (Vec<[f32; 3]>, Vec<[usize; 3]>, Vec<(String, [f32; 12])>),
        >,
        depth: usize,
        positions: &mut Vec<[f32; 3]>,
        normals: &mut Vec<[f32; 3]>,
    ) {
        if depth > 16 {
            return; // cycle guard
        }
        let Some((vertices, triangles, components)) = objects.get(id) else {
            return;
        };
        for tri in triangles {
            let p: Vec<[f32; 3]> = tri
                .iter()
                .map(|&i| apply_4x3(transform, vertices[i]))
                .collect();
            let n = face_normal(p[0], p[1], p[2]);
            positions.extend_from_slice(&p);
            normals.extend_from_slice(&[n, n, n]);
        }
        for (refid, child) in components {
            emit(
                refid,
                compose_4x3(transform, *child),
                objects,
                depth + 1,
                positions,
                normals,
            );
        }
    }
    let plain: std::collections::HashMap<_, _> = objects
        .into_iter()
        .map(|(id, o)| (id, (o.vertices, o.triangles, o.components)))
        .collect();
    for (id, transform) in &build {
        emit(id, *transform, &plain, 0, &mut positions, &mut normals);
    }
    if positions.is_empty() {
        return Err(OptimizeError::new("3MF contains no renderable geometry"));
    }
    for p in &mut positions {
        for c in p.iter_mut() {
            *c *= unit_scale;
        }
    }
    build_triangle_glb(&positions, &normals)
}

/// AMF: XML (optionally zip-wrapped, same-name entry). Objects hold vertex
/// coordinates + volume triangles. Constellations (instance placements) are not
/// applied — objects render once, which matches how slicers treat plain parts.
pub fn amf_to_glb(bytes: &[u8]) -> Result<Vec<u8>, OptimizeError> {
    let xml: Vec<u8> = if bytes.starts_with(b"PK\x03\x04") {
        use std::io::Read;
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
            .map_err(|_| OptimizeError::new("AMF zip is invalid"))?;
        let name = (0..archive.len())
            .filter_map(|i| archive.by_index(i).ok().map(|f| f.name().to_string()))
            .find(|n| n.to_lowercase().ends_with(".amf"))
            .ok_or_else(|| OptimizeError::new("AMF zip has no .amf entry"))?;
        let mut out = Vec::new();
        archive
            .by_name(&name)
            .map_err(|_| OptimizeError::new("AMF entry unreadable"))?
            .read_to_end(&mut out)
            .map_err(|_| OptimizeError::new("AMF entry unreadable"))?;
        out
    } else {
        bytes.to_vec()
    };

    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_reader(xml.as_slice());
    reader.config_mut().trim_text(true);

    let mut unit_scale = 1.0f32;
    let mut vertices: Vec<[f32; 3]> = Vec::new();
    let mut triangles: Vec<[usize; 3]> = Vec::new();
    // Per-object vertex offset: AMF triangle indices are object-local.
    let mut object_base = 0usize;
    let mut coord = [0.0f32; 3];
    let mut tri = [0usize; 3];
    let mut text_target: Option<usize> = None; // 0-2 into coord, 3-5 into tri
    let mut buf = Vec::new();
    loop {
        let event = reader
            .read_event_into(&mut buf)
            .map_err(|e| OptimizeError::new(format!("AMF XML error: {e}")))?;
        match &event {
            Event::Start(e) | Event::Empty(e) => match e.local_name().as_ref() {
                b"amf" => {
                    let unit = e.attributes().flatten().find_map(|a| {
                        (a.key.as_ref() == b"unit")
                            .then(|| String::from_utf8_lossy(&a.value).into_owned())
                    });
                    unit_scale = unit_to_mm(unit.as_deref().unwrap_or("millimeter"))?;
                }
                b"object" => object_base = vertices.len(),
                b"x" => text_target = Some(0),
                b"y" => text_target = Some(1),
                b"z" => text_target = Some(2),
                b"v1" => text_target = Some(3),
                b"v2" => text_target = Some(4),
                b"v3" => text_target = Some(5),
                _ => {}
            },
            Event::Text(t) => {
                if let Some(slot) = text_target {
                    let text = t.decode().unwrap_or_default();
                    let text = text.trim();
                    if slot < 3 {
                        coord[slot] = text.parse().unwrap_or(0.0);
                    } else {
                        tri[slot - 3] = text.parse().unwrap_or(0);
                    }
                }
            }
            Event::End(e) => {
                text_target = None;
                match e.local_name().as_ref() {
                    b"coordinates" => {
                        vertices.push([
                            coord[0] * unit_scale,
                            coord[1] * unit_scale,
                            coord[2] * unit_scale,
                        ]);
                        coord = [0.0; 3];
                    }
                    b"triangle" => {
                        let t = [
                            object_base + tri[0],
                            object_base + tri[1],
                            object_base + tri[2],
                        ];
                        if t.iter().any(|&i| i >= vertices.len()) {
                            return Err(OptimizeError::new("AMF triangle index out of range"));
                        }
                        triangles.push(t);
                        tri = [0; 3];
                    }
                    _ => {}
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }
    soup_to_glb(&vertices, &triangles, "AMF")
}

// ---- shared helpers ----------------------------------------------------------

/// 3MF/AMF unit attribute → mm scale factor.
fn unit_to_mm(unit: &str) -> Result<f32, OptimizeError> {
    match unit {
        "micron" => Ok(0.001),
        "millimeter" => Ok(1.0),
        "centimeter" => Ok(10.0),
        "inch" => Ok(25.4),
        "foot" => Ok(304.8),
        "meter" => Ok(1000.0),
        other => Err(OptimizeError::new(format!("unknown unit: {other}"))),
    }
}

/// Row-major 4x3 affine (the 3MF `transform` attribute: 9 rotation/scale values
/// then the translation row), identity when absent/malformed.
const IDENTITY_4X3: [f32; 12] = [1., 0., 0., 0., 1., 0., 0., 0., 1., 0., 0., 0.];

fn parse_3mf_transform(attr: Option<&str>) -> [f32; 12] {
    let Some(attr) = attr else {
        return IDENTITY_4X3;
    };
    let values: Vec<f32> = attr
        .split_whitespace()
        .filter_map(|t| t.parse().ok())
        .collect();
    match <[f32; 12]>::try_from(values) {
        Ok(m) => m,
        Err(_) => IDENTITY_4X3,
    }
}

/// 3MF row-vector convention: p' = p·M + t.
fn apply_4x3(m: [f32; 12], p: [f32; 3]) -> [f32; 3] {
    [
        p[0] * m[0] + p[1] * m[3] + p[2] * m[6] + m[9],
        p[0] * m[1] + p[1] * m[4] + p[2] * m[7] + m[10],
        p[0] * m[2] + p[1] * m[5] + p[2] * m[8] + m[11],
    ]
}

/// Compose parent ∘ child for the row-vector convention (apply child first).
fn compose_4x3(parent: [f32; 12], child: [f32; 12]) -> [f32; 12] {
    let mut out = [0.0f32; 12];
    for row in 0..3 {
        for col in 0..3 {
            out[row * 3 + col] = child[row * 3] * parent[col]
                + child[row * 3 + 1] * parent[3 + col]
                + child[row * 3 + 2] * parent[6 + col];
        }
    }
    let t = apply_4x3(parent, [child[9], child[10], child[11]]);
    out[9] = t[0];
    out[10] = t[1];
    out[11] = t[2];
    out
}

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
    fn threemf_build_item_and_component() {
        // One triangle object; a second object referencing it as a component with
        // a translation; the build places the second → still 1 emitted instance
        // chain = 1 triangle from the component path.
        let model = r#"<?xml version="1.0"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="1" type="model"><mesh>
   <vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>
   <triangles><triangle v1="0" v2="1" v3="2"/></triangles>
  </mesh></object>
  <object id="2" type="model"><components>
   <component objectid="1" transform="1 0 0 0 1 0 0 0 1 5 0 0"/>
  </components></object>
 </resources>
 <build><item objectid="2"/></build>
</model>"#;
        let mut zip_bytes = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(std::io::Cursor::new(&mut zip_bytes));
            writer
                .start_file::<_, ()>("3D/3dmodel.model", zip::write::FileOptions::default())
                .unwrap();
            std::io::Write::write_all(&mut writer, model.as_bytes()).unwrap();
            writer.finish().unwrap();
        }
        let glb = threemf_to_glb(&zip_bytes).unwrap();
        assert_eq!(tri_count(&glb), 1);
    }

    #[test]
    fn amf_plain_xml() {
        let amf = r#"<?xml version="1.0"?>
<amf unit="millimeter"><object id="0"><mesh>
 <vertices>
  <vertex><coordinates><x>0</x><y>0</y><z>0</z></coordinates></vertex>
  <vertex><coordinates><x>1</x><y>0</y><z>0</z></coordinates></vertex>
  <vertex><coordinates><x>0</x><y>1</y><z>0</z></coordinates></vertex>
 </vertices>
 <volume><triangle><v1>0</v1><v2>1</v2><v3>2</v3></triangle></volume>
</mesh></object></amf>"#;
        let glb = amf_to_glb(amf.as_bytes()).unwrap();
        assert_eq!(tri_count(&glb), 1);
    }

    #[test]
    fn rejects_empty_or_garbage() {
        assert!(obj_to_glb(b"v 0 0 0\n").is_err());
        assert!(off_to_glb(b"OFF\n0 0 0\n").is_err());
        assert!(bim_to_glb(b"{}").is_err());
        assert!(ply_to_glb(b"not a ply").is_err());
    }
}
