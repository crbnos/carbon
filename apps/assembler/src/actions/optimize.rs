//! `optimize` action — GLB | GLTF | STEP → optimised GLB. Runs the meshopt
//! geometry passes + codec encode (via `crates/optimize`), walking a simplify
//! ladder until the render-weight + output-size gates pass. Async job; late-mint
//! uploads the single `glb` output.

use crate::jobs::{Done, Output};
use crate::{http, AppState};
use serde_json::json;
use std::sync::Arc;
use std::time::Instant;

pub struct OptimizeReq {
    pub source_url: String,
    /// "glb" | "gltf" | "step".
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
    /// Quality/perf knob: max simplify error in mm (`None` = ratio-only). Applies
    /// on top of every ladder rung as the precision floor.
    pub tolerance: Option<f32>,
    /// Auto-mode normalized error budget, used when neither a ratio ladder nor an
    /// absolute tolerance drives simplification. `None` = lossless.
    pub auto_error: Option<f32>,
    /// Draco quantization bits (position, normal, texcoord) — Draco codec only.
    pub draco_bits: (i32, i32, i32),
    /// Quantize normals to i16 (none/meshopt codecs). Core glTF, ~half the normal bytes.
    pub quantize_normals: bool,
    /// Merge same-material primitives within a mesh (fewer draw calls + smaller).
    pub merge_primitives: bool,
    /// Decoded (render-weight) byte ceiling — the "packed" gate.
    pub max_packed: usize,
    /// Encoded output byte ceiling.
    pub max_output: usize,
    /// STEP tessellation (ignored for glb/gltf input).
    pub lin: f64,
    pub ang: f64,
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
        let format = req.format.clone();
        let opts = req.opts;

        let res = tokio::task::spawn_blocking(move || run_optimize(&tmp_str, &format, &opts)).await;
        let _ = tokio::fs::remove_file(&tmp).await;

        let outcome = match res {
            Ok(Ok(o)) => o,
            Ok(Err(msg)) => {
                eprintln!("[{job_id}] optimize failed: {msg}");
                jobs.set_error(&job_id, "TESSELLATION_FAILED", msg).await;
                return;
            }
            Err(e) => {
                let msg = format!("optimize panicked: {e}");
                eprintln!("[{job_id}] {msg}");
                jobs.set_error(&job_id, "TESSELLATION_FAILED", msg).await;
                return;
            }
        };

        let optimise_ms = started.elapsed().as_millis() as i64;
        eprintln!(
            "[{job_id}] optimize done: {} -> {} tris, {} -> {} bytes, {optimise_ms}ms{}",
            outcome.stats.input_triangles,
            outcome.stats.output_triangles,
            outcome.stats.input_bytes,
            outcome.glb.len(),
            if outcome.warnings.is_empty() {
                ""
            } else {
                " (warnings)"
            }
        );

        let done = Done {
            result: json!({
                "codec": codec_name(outcome.codec),
                "simplifyRatioUsed": outcome.ratio,
                "inputTris": outcome.stats.input_triangles,
                "outputTris": outcome.stats.output_triangles,
                "inputBytes": outcome.stats.input_bytes,
                "outputBytes": outcome.glb.len(),
                "outputs": { "glb": { "path": req.glb_path } },
                "warnings": outcome.warnings,
            }),
            stats: json!({
                "optimiseMs": optimise_ms,
                "decodedBytes": outcome.stats.decoded_bytes,
            }),
        };
        let outputs = vec![Output {
            name: "glb".into(),
            content_type: "model/gltf-binary".into(),
            bytes: outcome.glb,
        }];
        jobs.pending_put(&job_id, outputs, done, None).await;
        jobs.set_status(&job_id, "uploading").await;
        jobs.wake(&job_id);
    });
}

struct Outcome {
    glb: Vec<u8>,
    stats: optimize::Stats,
    codec: optimize::Codec,
    ratio: Option<f32>,
    warnings: Vec<String>,
}

/// GLB source bytes — either the STEP tessellation (owned) or a memory-mapped
/// uploaded GLB (OS-paged, off the RSS).
enum Src {
    Owned(Vec<u8>),
    Mapped(memmap2::Mmap),
}
impl Src {
    fn bytes(&self) -> &[u8] {
        match self {
            Src::Owned(v) => v,
            Src::Mapped(m) => m,
        }
    }
}

/// Load the source into GLB bytes (tessellating STEP), then walk the simplify
/// ladder — the first rung under both gates wins; else keep the smallest and flag
/// `asset-too-large` (never a silent truncation).
fn run_optimize(path: &str, format: &str, opts: &Opts) -> Result<Outcome, String> {
    let src = match format {
        "step" | "stp" => {
            let text = read_head(path, 32 * 1024 * 1024)?;
            Src::Owned(
                converter::convert::convert_step(path, &text, opts.lin, opts.ang)
                    .map_err(|e| e.message)?
                    .glb,
            )
        }
        // mmap the uploaded GLB so a large source stays OS-paged, never a
        // resident Vec — the BIN chunk faults in on access during optimise.
        "glb" | "gltf" => {
            let file = std::fs::File::open(path).map_err(|e| format!("open source: {e}"))?;
            Src::Mapped(
                unsafe { memmap2::Mmap::map(&file) }.map_err(|e| format!("mmap source: {e}"))?,
            )
        }
        other => return Err(format!("unsupported format: {other}")),
    };
    let glb = src.bytes();
    let input_bytes = glb.len();

    let ladder = if opts.ladder.is_empty() {
        vec![None]
    } else {
        opts.ladder.clone()
    };

    let mut best: Option<Outcome> = None;
    let mut warnings: Vec<String> = Vec::new();
    for rung in ladder {
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
        let mut res = optimize::optimize_glb(glb, &o).map_err(|e| e.message)?;
        res.stats.input_bytes = input_bytes;
        let passes = res.stats.decoded_bytes <= opts.max_packed && res.glb.len() <= opts.max_output;
        let outcome = Outcome {
            glb: res.glb,
            stats: res.stats,
            codec: opts.codec,
            ratio: rung,
            warnings: Vec::new(),
        };
        if passes {
            return Ok(outcome);
        }
        warnings.push(format!(
            "rung {:?} over budget: decoded {}B (max {}B), output {}B (max {}B)",
            rung, outcome.stats.decoded_bytes, opts.max_packed, outcome.glb.len(), opts.max_output
        ));
        best = Some(outcome);
    }

    let mut out = best.ok_or_else(|| "no simplify rungs to run".to_string())?;
    warnings.push("asset-too-large".into());
    out.warnings = warnings;
    Ok(out)
}

fn read_head(path: &str, cap: usize) -> Result<String, String> {
    use std::io::Read;
    let file = std::fs::File::open(path).map_err(|e| format!("read temp: {e}"))?;
    let mut buf = Vec::new();
    file.take(cap as u64)
        .read_to_end(&mut buf)
        .map_err(|e| format!("read temp: {e}"))?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

fn codec_name(c: optimize::Codec) -> &'static str {
    match c {
        optimize::Codec::None => "none",
        optimize::Codec::Meshopt => "meshopt",
        optimize::Codec::Draco => "draco",
    }
}
