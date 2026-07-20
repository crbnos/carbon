//! `optimize` action — any supported CAD/mesh input → optimised GLB. Resolves the
//! source format (explicit or content auto-detected), loads it into a GLB
//! (OCCT-tessellating B-rep, ingesting STL, mmapping a GLB, or repacking a text
//! glTF to GLB via a streaming base64 decode), then runs the
//! meshopt geometry passes + codec encode (via `crates/optimize`), walking a
//! simplify ladder until the render-weight + output-size gates pass. Async job;
//! late-mint uploads the single `glb` output. Fails loud with a typed error
//! (`unsupported_format` / `ambiguous_format` / `tessellation_failed` /
//! `cannot_fit_budget`) rather than storing an over-cap or wrong result.

use crate::formats::{self, Format};
use crate::jobs::{Done, Output};
use crate::{http, AppState};
use serde_json::json;
use std::sync::Arc;
use std::time::{Duration, Instant};

pub struct OptimizeReq {
    pub source_url: String,
    /// Declared source format, or `"auto"` / empty to content-detect.
    pub format: String,
    /// Storage path recorded in the completion pointer (late-mint uploads here).
    pub glb_path: Option<String>,
    pub opts: Opts,
}

pub struct Opts {
    pub codec: optimize::Codec,
    /// Simplify rungs walked in order; the first passing the gates wins. `None` =
    /// full fidelity. Default `[None]`.
    pub ladder: Vec<Option<f32>>,
    pub simplify_aggressive: bool,
    pub weld: bool,
    pub reorder: bool,
    /// Quality/perf knob: max simplify error in mm (`None` = ratio-only).
    pub tolerance: Option<f32>,
    /// Auto-mode normalized error budget. `None` = lossless.
    pub auto_error: Option<f32>,
    /// Draco quantization bits (position, normal, texcoord) — Draco codec only.
    pub draco_bits: (i32, i32, i32),
    /// Quantize normals to i16 (none/meshopt codecs).
    pub quantize_normals: bool,
    /// Merge same-material primitives within a mesh.
    pub merge_primitives: bool,
    /// Decoded (render-weight) byte ceiling — the "packed" gate.
    pub max_packed: usize,
    /// Encoded output byte ceiling.
    pub max_output: usize,
    /// STEP/IGES tessellation deflection (ignored for mesh input).
    pub lin: f64,
    pub ang: f64,
    /// Wall-clock budget for the simplify ladder (`quality.time_budget_secs`,
    /// else auto: 720s on Lambda). `None` = unbounded. `spawn` turns this
    /// into an absolute `deadline` relative to job start (so it also charges the
    /// download + tessellation time already spent).
    pub budget: Option<Duration>,
    /// Absolute deadline computed in `spawn`; consumed by the ladder. Never set
    /// from JSON.
    pub deadline: Option<Instant>,
}

/// A typed action failure carrying the snake_case API error code.
struct ActionErr {
    code: &'static str,
    message: String,
}
impl ActionErr {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        ActionErr {
            code,
            message: message.into(),
        }
    }
}

pub fn spawn(state: &AppState, job_id: &str, req: OptimizeReq) {
    let jobs = state.jobs.clone();
    let slots = Arc::clone(&state.slots);
    let job_id = job_id.to_string();
    tokio::spawn(async move {
        let _permit = slots.acquire().await;
        if jobs.is_canceled(&job_id).await {
            return;
        }
        jobs.set_status(&job_id, "running").await;
        eprintln!(
            "[{job_id}] optimize running (codec={:?} format={})",
            req.opts.codec, req.format
        );
        let started = Instant::now();

        let tmp = http::temp_path("model");
        if let Err(e) = http::download_hashed(&req.source_url, &tmp, None).await {
            let _ = tokio::fs::remove_file(&tmp).await;
            eprintln!("[{job_id}] optimize failed: source download: {}", e.message);
            jobs.set_error(&job_id, &e.code, e.message).await;
            return;
        }
        let tmp_str = tmp.to_string_lossy().to_string();
        let declared = req.format.clone();
        let ext = url_ext(&req.source_url);
        let mut opts = req.opts;
        // Charge the download + tessellation already spent against the budget.
        opts.deadline = opts.budget.map(|b| started + b);

        let res = tokio::task::spawn_blocking(move || {
            run_optimize(&tmp_str, &declared, ext.as_deref(), &opts)
        })
        .await;
        let _ = tokio::fs::remove_file(&tmp).await;

        let outcome = match res {
            Ok(Ok(o)) => o,
            Ok(Err(e)) => {
                eprintln!("[{job_id}] optimize failed ({}): {}", e.code, e.message);
                jobs.set_error(&job_id, e.code, e.message).await;
                return;
            }
            Err(e) => {
                let msg = format!("optimize panicked: {e}");
                eprintln!("[{job_id}] {msg}");
                jobs.set_error(&job_id, "optimize_failed", msg).await;
                return;
            }
        };

        let optimise_ms = started.elapsed().as_millis() as i64;
        eprintln!(
            "[{job_id}] optimize done: {} ({} via) {} -> {} tris, {} -> {} bytes, ratio={:?}, {optimise_ms}ms",
            outcome.detected_format,
            outcome.detected_via,
            outcome.stats.input_triangles,
            outcome.stats.output_triangles,
            outcome.stats.input_bytes,
            outcome.glb.len(),
            outcome.ratio,
        );

        let done = Done {
            result: json!({
                "detected_format": outcome.detected_format,
                "detected_via": outcome.detected_via,
                "outputs": {
                    "glb": {
                        "path": req.glb_path,
                        "bytes": outcome.glb.len(),
                        "codec": codec_name(outcome.codec),
                    }
                },
                "warnings": outcome.warnings,
            }),
            stats: json!({
                "input_triangles": outcome.stats.input_triangles,
                "output_triangles": outcome.stats.output_triangles,
                "input_bytes": outcome.stats.input_bytes,
                "output_bytes": outcome.glb.len(),
                "render_weight_bytes": outcome.stats.decoded_bytes,
                "simplify_ratio_used": outcome.ratio,
                "optimise_ms": optimise_ms,
            }),
        };
        let outputs = vec![Output {
            name: "glb".into(),
            content_type: "model/gltf-binary".into(),
            bytes: outcome.glb,
        }];
        jobs.finish(&job_id, outputs, done, None).await;
    });
}

struct Outcome {
    glb: Vec<u8>,
    stats: optimize::Stats,
    codec: optimize::Codec,
    ratio: Option<f32>,
    warnings: Vec<String>,
    detected_format: &'static str,
    detected_via: &'static str,
}

/// GLB source bytes — an owned tessellation/STL-ingest, a memory-mapped uploaded
/// GLB, or a memory-mapped repacked temp GLB (from a text glTF). All OS-paged, off
/// the RSS.
enum Src {
    Owned(Vec<u8>),
    Mapped(memmap2::Mmap),
    /// Repacked temp `.glb` (from text glTF); the `TempPath` holds the file open
    /// for the mmap's lifetime and deletes it on drop.
    MappedTemp(memmap2::Mmap, #[allow(dead_code)] tempfile::TempPath),
}
impl Src {
    fn bytes(&self) -> &[u8] {
        match self {
            Src::Owned(v) => v,
            Src::Mapped(m) | Src::MappedTemp(m, _) => m,
        }
    }
}

/// Resolve the format, load the source into GLB bytes, then walk the simplify
/// ladder — the first rung under both gates wins; if none fit, fail with
/// `cannot_fit_budget` (never store an over-cap blob).
fn run_optimize(
    path: &str,
    declared: &str,
    ext: Option<&str>,
    opts: &Opts,
) -> Result<Outcome, ActionErr> {
    let head = read_head_bytes(path, 512 * 1024).map_err(|e| ActionErr::new("invalid_input", e))?;
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);

    let (format, detected_via) = formats::resolve(declared, &head, size, ext)
        .map_err(|e| ActionErr::new(e.code, e.message))?;
    let detected_format = format.name();

    let src = load_source(path, format, &head, opts)?;
    let glb = src.bytes();
    let input_bytes = glb.len();

    let ladder = if opts.ladder.is_empty() {
        vec![None]
    } else {
        opts.ladder.clone()
    };

    let mut best: Option<Outcome> = None;
    let mut warnings: Vec<String> = Vec::new();
    let mut i = 0;
    while i < ladder.len() {
        // Time-budget gate: if the wall-clock budget is spent and coarser rungs
        // remain, jump straight to the coarsest. The skipped middle rungs are
        // finer (larger output) than the coarsest, so if they'd fail the size gate
        // the coarsest is the only one with a chance — running them first only
        // burns the remaining window. Preserves the size invariant: a no-fit
        // coarsest still fails `cannot_fit_budget` below (never stores over-cap).
        if let Some(dl) = opts.deadline {
            let last = ladder.len() - 1;
            if i < last && Instant::now() >= dl {
                warnings.push(format!(
                    "time budget spent after rung {:?}; skipping to coarsest rung {:?}",
                    ladder[i], ladder[last]
                ));
                i = last;
            }
        }
        let rung = ladder[i];
        let o = optimize::Options {
            codec: opts.codec,
            simplify: rung,
            tolerance: opts.tolerance,
            auto_error: opts.auto_error,
            simplify_aggressive: opts.simplify_aggressive,
            draco_bits: opts.draco_bits,
            quantize_normals: opts.quantize_normals,
            merge_primitives: opts.merge_primitives,
            weld: opts.weld,
            reorder: opts.reorder,
        };
        // Every source is GLB here (STEP/STL ingested to GLB, GLB mmap'd, text
        // glTF repacked to GLB in load_source).
        let mut res = optimize::optimize_glb(glb, &o)
            .map_err(|e| ActionErr::new("optimize_failed", e.message))?;
        res.stats.input_bytes = input_bytes;
        let passes = res.stats.decoded_bytes <= opts.max_packed && res.glb.len() <= opts.max_output;
        let outcome = Outcome {
            glb: res.glb,
            stats: res.stats,
            codec: opts.codec,
            ratio: rung,
            warnings: Vec::new(),
            detected_format,
            detected_via,
        };
        if passes {
            return Ok(outcome);
        }
        warnings.push(format!(
            "rung {:?} over budget: render-weight {}B (max {}B), output {}B (max {}B)",
            rung,
            outcome.stats.decoded_bytes,
            opts.max_packed,
            outcome.glb.len(),
            opts.max_output
        ));
        best = Some(outcome);
        i += 1;
    }

    // Nothing fit the budget even at the most aggressive rung: fail loud rather
    // than store an artifact the served bucket would reject.
    let smallest = best.map(|o| o.glb.len()).unwrap_or(0);
    Err(ActionErr::new(
        "cannot_fit_budget",
        format!(
            "could not fit the size/render-weight budget (smallest {smallest}B, max {}B); tried rungs {:?}. {}",
            opts.max_output,
            opts.ladder,
            warnings.join("; ")
        ),
    ))
}

/// Load the resolved format into GLB bytes.
fn load_source(path: &str, format: Format, head: &[u8], opts: &Opts) -> Result<Src, ActionErr> {
    match format {
        Format::Step => {
            let text = String::from_utf8_lossy(head).into_owned();
            let glb = converter::convert::convert_step(path, &text, opts.lin, opts.ang)
                .map_err(|e| ActionErr::new("tessellation_failed", e.message))?
                .glb;
            Ok(Src::Owned(glb))
        }
        Format::Xbf => {
            // Compacted retained raw (BinXCAF). Geometry already mm; tessellate
            // like STEP. Lets reoptimise run off the compacted source.
            let glb = converter::convert::convert_xbf(path, opts.lin, opts.ang)
                .map_err(|e| ActionErr::new("tessellation_failed", e.message))?
                .glb;
            Ok(Src::Owned(glb))
        }
        Format::Stl => {
            let bytes =
                std::fs::read(path).map_err(|e| ActionErr::new("invalid_input", e.to_string()))?;
            let glb = optimize::stl_to_glb(&bytes)
                .map_err(|e| ActionErr::new("optimize_failed", e.message))?;
            Ok(Src::Owned(glb))
        }
        Format::Glb => {
            let file = std::fs::File::open(path)
                .map_err(|e| ActionErr::new("invalid_input", format!("open source: {e}")))?;
            let map = unsafe { memmap2::Mmap::map(&file) }
                .map_err(|e| ActionErr::new("invalid_input", format!("mmap source: {e}")))?;
            Ok(Src::Mapped(map))
        }
        Format::Gltf => {
            use std::io::Write as _;
            // Repack text glTF → GLB with a streaming base64 decode, then mmap the
            // GLB and run the bounded GLB path. A serde parse of a multi-GB glTF
            // holds the base64 string + decoded bytes at once (~3× the file); this
            // keeps peak memory off the geometry (it lives in the temp GLB on disk).
            let file = std::fs::File::open(path)
                .map_err(|e| ActionErr::new("invalid_input", format!("open source: {e}")))?;
            let gltf = unsafe { memmap2::Mmap::map(&file) }
                .map_err(|e| ActionErr::new("invalid_input", format!("mmap source: {e}")))?;
            let mut tmp = tempfile::NamedTempFile::new()
                .map_err(|e| ActionErr::new("invalid_input", format!("temp glb: {e}")))?;
            {
                let mut bw = std::io::BufWriter::new(&mut tmp);
                optimize::gltf_to_glb(&gltf, &mut bw)
                    .map_err(|e| ActionErr::new("optimize_failed", e.message))?;
                bw.flush().map_err(|e| {
                    ActionErr::new("optimize_failed", format!("flush temp glb: {e}"))
                })?;
            }
            let temp_path = tmp.into_temp_path();
            let glb_file = std::fs::File::open(&temp_path)
                .map_err(|e| ActionErr::new("invalid_input", format!("open temp glb: {e}")))?;
            let glb_map = unsafe { memmap2::Mmap::map(&glb_file) }
                .map_err(|e| ActionErr::new("invalid_input", format!("mmap temp glb: {e}")))?;
            Ok(Src::MappedTemp(glb_map, temp_path))
        }
        // Plain mesh formats: parse → triangle-soup GLB (the optimiser's weld
        // pass reconstructs sharing) → the bounded GLB path.
        Format::Obj | Format::Ply | Format::Off | Format::Bim | Format::ThreeMf | Format::Amf => {
            let bytes =
                std::fs::read(path).map_err(|e| ActionErr::new("invalid_input", e.to_string()))?;
            let glb = match format {
                Format::Obj => optimize::obj_to_glb(&bytes),
                Format::Ply => optimize::ply_to_glb(&bytes),
                Format::Off => optimize::off_to_glb(&bytes),
                Format::Bim => optimize::bim_to_glb(&bytes),
                Format::ThreeMf => optimize::threemf_to_glb(&bytes),
                _ => optimize::amf_to_glb(&bytes),
            }
            .map_err(|e| ActionErr::new("invalid_input", e.message))?;
            Ok(Src::Owned(glb))
        }
        // Exact B-rep sources tessellated by OCCT, same walk as STEP.
        Format::Iges => {
            let glb = converter::convert::convert_iges(path, opts.lin, opts.ang)
                .map_err(|e| ActionErr::new("tessellation_failed", e.message))?
                .glb;
            Ok(Src::Owned(glb))
        }
        Format::Brep => {
            let glb = converter::convert::convert_brep(path, opts.lin, opts.ang)
                .map_err(|e| ActionErr::new("tessellation_failed", e.message))?
                .glb;
            Ok(Src::Owned(glb))
        }
    }
}

fn read_head_bytes(path: &str, cap: usize) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let file = std::fs::File::open(path).map_err(|e| format!("read temp: {e}"))?;
    let mut buf = Vec::new();
    file.take(cap as u64)
        .read_to_end(&mut buf)
        .map_err(|e| format!("read temp: {e}"))?;
    Ok(buf)
}

/// Filename extension hint from a (possibly signed) URL — the last-resort tiebreak
/// for format detection. Strips the query string.
fn url_ext(url: &str) -> Option<String> {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    let name = path.rsplit('/').next().unwrap_or(path);
    name.rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
}

fn codec_name(c: optimize::Codec) -> &'static str {
    match c {
        optimize::Codec::None => "none",
        optimize::Codec::Meshopt => "meshopt",
        optimize::Codec::Draco => "draco",
    }
}
