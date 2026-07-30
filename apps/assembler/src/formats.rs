//! Explicit input-format registry + content auto-detection.
//!
//! One source of truth for what the assembler ingests. Surfaced via `GET /v1`
//! discovery so the client never hand-maintains a format list. Detection is
//! content-first (magic bytes / structural signatures + the binary-STL size
//! formula), then the `file-format` crate as a broad net, then the filename
//! extension as a last-resort hint. Genuinely unknown input fails loud
//! (`ambiguous_format` / `unsupported_format`) — never a wrong guess into OCCT.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Format {
    Step,
    Iges,
    Brep,
    /// OCCT BinXCAF document (`.xbf`) — the compacted lossless retained-raw form
    /// of a STEP (B-rep + assembly tree + names + colors, already mm).
    Xbf,
    Glb,
    Gltf,
    Stl,
    Obj,
    Ply,
    Off,
    /// dotbim (`.bim`) — JSON meshes + instanced elements.
    Bim,
    /// 3MF (zip container, `3D/3dmodel.model` XML).
    ThreeMf,
    /// AMF (XML, optionally zip-wrapped).
    Amf,
}

/// How the source is turned into a mesh: OCCT tessellation (exact B-rep) or a
/// direct mesh parse.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Loader {
    Occt,
    Mesh,
}

/// Every supported input token (canonical names + aliases), for the
/// `unsupported_format` error payload.
pub const SUPPORTED: &[&str] = &[
    "step", "stp", "iges", "igs", "brep", "xbf", "glb", "gltf", "stl", "obj", "ply", "off", "bim", "3mf", "amf",
];

/// Canonical formats, in registry order — the `GET /v1` discovery listing.
pub const ALL: &[Format] = &[
    Format::Step,
    Format::Iges,
    Format::Brep,
    Format::Xbf,
    Format::Glb,
    Format::Gltf,
    Format::Stl,
    Format::Obj,
    Format::Ply,
    Format::Off,
    Format::Bim,
    Format::ThreeMf,
    Format::Amf,
];

impl Format {
    pub fn name(self) -> &'static str {
        match self {
            Format::Step => "step",
            Format::Iges => "iges",
            Format::Brep => "brep",
            Format::Xbf => "xbf",
            Format::Glb => "glb",
            Format::Gltf => "gltf",
            Format::Stl => "stl",
            Format::Obj => "obj",
            Format::Ply => "ply",
            Format::Off => "off",
            Format::Bim => "bim",
            Format::ThreeMf => "3mf",
            Format::Amf => "amf",
        }
    }

    pub fn loader(self) -> Loader {
        match self {
            Format::Step | Format::Iges | Format::Brep | Format::Xbf => Loader::Occt,
            _ => Loader::Mesh,
        }
    }

    pub fn loader_name(self) -> &'static str {
        match self.loader() {
            Loader::Occt => "occt",
            Loader::Mesh => "mesh",
        }
    }

    /// Exact B-rep source (precision preserved until tessellation).
    pub fn exact(self) -> bool {
        matches!(self.loader(), Loader::Occt)
    }

    /// Carries assembly structure (node hierarchy / groups) usable by `convert`.
    pub fn structured(self) -> bool {
        matches!(
            self,
            Format::Step
                | Format::Iges
                | Format::Brep
                | Format::Xbf
                | Format::Glb
                | Format::Gltf
                | Format::Obj
        )
    }

    pub fn from_name(s: &str) -> Option<Format> {
        match s.trim().to_ascii_lowercase().as_str() {
            "step" | "stp" => Some(Format::Step),
            "iges" | "igs" => Some(Format::Iges),
            "brep" => Some(Format::Brep),
            "xbf" => Some(Format::Xbf),
            "glb" => Some(Format::Glb),
            "gltf" => Some(Format::Gltf),
            "stl" => Some(Format::Stl),
            "obj" => Some(Format::Obj),
            "ply" => Some(Format::Ply),
            "off" => Some(Format::Off),
            "bim" => Some(Format::Bim),
            "3mf" => Some(Format::ThreeMf),
            "amf" => Some(Format::Amf),
            _ => None,
        }
    }
}

/// A typed detection failure. `code` is the snake_case API error code.
#[derive(Debug)]
pub struct FormatError {
    pub code: &'static str,
    pub message: String,
}

/// Resolve the effective format from the caller's `declared` value + content.
/// `"auto"` (or empty) sniffs; an explicit format is trusted (content is only a
/// cross-check). Returns `(format, detected_via)`.
pub fn resolve(
    declared: &str,
    head: &[u8],
    size: u64,
    ext: Option<&str>,
) -> Result<(Format, &'static str), FormatError> {
    let declared = declared.trim().to_ascii_lowercase();
    if declared.is_empty() || declared == "auto" {
        return match sniff(head, size, ext) {
            Some(f) => Ok((f, "content")),
            None => Err(FormatError {
                code: "ambiguous_format",
                message: "could not determine format from content or extension".into(),
            }),
        };
    }
    match Format::from_name(&declared) {
        Some(f) => Ok((f, "declared")),
        None => Err(FormatError {
            code: "unsupported_format",
            message: format!(
                "format '{declared}' not supported (supported: {})",
                SUPPORTED.join(", ")
            ),
        }),
    }
}

/// Content sniff. `head` = leading bytes, `size` = full byte length (for the
/// binary-STL formula), `ext` = filename extension hint (last resort).
pub fn sniff(head: &[u8], size: u64, ext: Option<&str>) -> Option<Format> {
    // 1. Unambiguous binary/structural signatures.
    if head.len() >= 4 && &head[0..4] == b"glTF" {
        return Some(Format::Glb);
    }
    // OCCT BinXCAF documents start with the ASCII `BINFILE` magic.
    if head.len() >= 7 && &head[0..7] == b"BINFILE" {
        return Some(Format::Xbf);
    }
    let text = leading_text(head);
    let trimmed = text.trim_start();
    if trimmed.starts_with("ISO-10303-21") {
        return Some(Format::Step);
    }
    if head.starts_with(b"ply") {
        return Some(Format::Ply);
    }
    if trimmed.starts_with("OFF") || trimmed.starts_with("COFF") || trimmed.starts_with("NOFF") {
        return Some(Format::Off);
    }
    if trimmed.starts_with("DBRep_") || text.contains("CASCADE Topology") {
        return Some(Format::Brep);
    }
    if is_gltf_json(trimmed) {
        return Some(Format::Gltf);
    }
    // dotbim: JSON with a schema_version + meshes (glTF JSON is caught above by
    // its "asset" key, so no collision).
    // AMF: XML root element (the zip-wrapped variant falls back to the ext hint,
    // like 3MF — a bare PK header is indistinguishable from any other zip).
    if trimmed.starts_with("<?xml") && text.contains("<amf") {
        return Some(Format::Amf);
    }
    if trimmed.starts_with('{')
        && trimmed.contains("\"schema_version\"")
        && trimmed.contains("\"meshes\"")
    {
        return Some(Format::Bim);
    }

    // 2. Binary STL: the size formula BEFORE the ASCII "solid" prefix — a binary
    //    header can itself begin with "solid".
    if head.len() >= 84 {
        let count = u32::from_le_bytes([head[80], head[81], head[82], head[83]]) as u64;
        if size == 84 + count * 50 {
            return Some(Format::Stl);
        }
    }
    if trimmed.starts_with("solid") && text.contains("facet") {
        return Some(Format::Stl);
    }

    // 3. Text heuristics.
    if looks_like_obj(&text) {
        return Some(Format::Obj);
    }
    if is_iges(&text) {
        return Some(Format::Iges);
    }

    // 4. Broad net, then the extension hint.
    if let Some(f) = via_file_format(head) {
        return Some(f);
    }
    ext.and_then(Format::from_name)
}

fn leading_text(head: &[u8]) -> String {
    let n = head.len().min(4096);
    String::from_utf8_lossy(&head[..n]).into_owned()
}

fn is_gltf_json(trimmed: &str) -> bool {
    trimmed.starts_with('{') && trimmed.contains("\"asset\"")
}

fn looks_like_obj(text: &str) -> bool {
    let mut has_vertex = false;
    let mut has_face = false;
    for line in text.lines() {
        if line.starts_with("v ") {
            has_vertex = true;
        } else if line.starts_with("f ") {
            has_face = true;
        }
        if has_vertex && has_face {
            return true;
        }
    }
    false
}

fn is_iges(text: &str) -> bool {
    // IGES records are 80 columns; column 73 of the first record is the section
    // letter ('S' for the start section).
    text.lines()
        .next()
        .and_then(|l| l.as_bytes().get(72).copied())
        == Some(b'S')
}

fn via_file_format(head: &[u8]) -> Option<Format> {
    let ff = file_format::FileFormat::from_bytes(head);
    Format::from_name(ff.extension())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sniff_bytes(b: &[u8]) -> Option<Format> {
        sniff(b, b.len() as u64, None)
    }

    #[test]
    fn detects_by_magic() {
        assert_eq!(sniff_bytes(b"glTF\x02\0\0\0"), Some(Format::Glb));
        assert_eq!(sniff_bytes(b"BINFILE\x01\x02\x03\x04"), Some(Format::Xbf));
        assert_eq!(sniff_bytes(b"ISO-10303-21;\nHEADER;"), Some(Format::Step));
        assert_eq!(sniff_bytes(b"ply\nformat ascii 1.0\n"), Some(Format::Ply));
        assert_eq!(sniff_bytes(b"OFF\n8 6 0\n"), Some(Format::Off));
        assert_eq!(
            sniff_bytes(b"{\n  \"asset\": { \"version\": \"2.0\" }\n}"),
            Some(Format::Gltf)
        );
    }

    #[test]
    fn detects_binary_stl_by_size_formula() {
        // 80-byte header (starting with "solid" to prove the formula wins over the
        // ASCII prefix) + u32 count(1) + 50 bytes.
        let mut b = vec![0u8; 80];
        b[0..5].copy_from_slice(b"solid");
        b.extend_from_slice(&1u32.to_le_bytes());
        b.extend_from_slice(&[0u8; 50]);
        assert_eq!(sniff(&b, b.len() as u64, None), Some(Format::Stl));
    }

    #[test]
    fn detects_ascii_stl_and_obj() {
        assert_eq!(
            sniff_bytes(b"solid part\nfacet normal 0 0 1\nvertex 0 0 0\n"),
            Some(Format::Stl)
        );
        assert_eq!(
            sniff_bytes(b"# comment\nv 0 0 0\nv 1 0 0\nf 1 2 3\n"),
            Some(Format::Obj)
        );
    }

    #[test]
    fn resolve_auto_vs_declared_vs_unsupported() {
        let glb = b"glTF\x02\0\0\0";
        assert_eq!(
            resolve("auto", glb, glb.len() as u64, None).unwrap(),
            (Format::Glb, "content")
        );
        // Declared is trusted (content advisory).
        assert_eq!(
            resolve("stl", b"", 0, None).unwrap(),
            (Format::Stl, "declared")
        );
        assert_eq!(
            resolve("fbx", glb, glb.len() as u64, None)
                .unwrap_err()
                .code,
            "unsupported_format"
        );
        assert_eq!(
            resolve("auto", b"random bytes", 12, None).unwrap_err().code,
            "ambiguous_format"
        );
        // Extension fallback when content is inconclusive.
        assert_eq!(
            resolve("auto", b"random", 6, Some("stl")).unwrap(),
            (Format::Stl, "content")
        );
    }
}
