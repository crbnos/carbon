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
    /// The caller supplied no explicit quality knob, so the service owns the
    /// fidelity policy: `run_optimize` runs a lossless pass first and, only when
    /// a gate fails, re-runs with a keep ratio PREDICTED from that pass's
    /// measured overshoot (`required_keep`), ignoring `ladder`/`auto_error`.
    /// Off when any explicit knob was given — then the caller's ladder is
    /// authoritative.
    pub auto_scale: bool,
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

/// Safety margin applied to the predicted keep ratio. Decoded (render-weight)
/// bytes are exactly linear in kept triangles and encoded bytes are close to
/// linear, but the meshopt encoder's per-vertex rate wobbles with connectivity —
/// the margin makes the first targeted pass land under the gates instead of a
/// hair over (which would cost another full pass).
const AUTO_TARGET_MARGIN: f64 = 0.85;

/// How many measured, targeted simplify passes to attempt after the lossless
/// pass fails the gates. Each pass re-predicts from the previous pass's real
/// numbers, so convergence is geometric; 3 misses means the prediction model
/// does not hold for this input (fail loudly rather than loop).
const AUTO_MAX_TARGETED_PASSES: usize = 3;

/// Length of a GLB's JSON (structure) chunk — the scene graph, nodes, and
/// materials. It does not shrink when triangles are removed, so the encoded
/// size is `json + bin(tris)`: an affine model, not a linear one. `None` on
/// anything that isn't a well-formed GLB (we only ever call this on our own
/// encoder's output, so that is a defensive fallback, not an expected path).
fn glb_json_len(glb: &[u8]) -> Option<usize> {
    if glb.len() < 20 || &glb[0..4] != b"glTF" || &glb[16..20] != b"JSON" {
        return None;
    }
    let len = u32::from_le_bytes(glb[12..16].try_into().ok()?) as usize;
    (len <= glb.len()).then_some(len)
}

/// Predict the fraction of triangles a failing pass may keep so the next pass
/// lands under both gates. Decoded (render-weight) bytes are linear in triangle
/// count; encoded bytes are the JSON structure constant plus a ~linear mesh
/// term — so the constant is subtracted from both the measurement and the cap
/// before inverting the worst overshoot (times the margin). `None` = the pass
/// already fits.
fn required_keep(
    decoded: usize,
    encoded: usize,
    json_len: usize,
    max_packed: usize,
    max_output: usize,
) -> Option<f64> {
    if decoded <= max_packed && encoded <= max_output {
        return None;
    }
    let over_packed = decoded as f64 / max_packed as f64;
    // Guard division by ~zero: json_len >= max_output is the infeasible case
    // the caller fails fast on; a stale/absent json_len degrades to the plain
    // linear model.
    let bin = encoded.saturating_sub(json_len) as f64;
    let bin_cap = max_output.saturating_sub(json_len) as f64;
    let over_encoded = if bin_cap > 0.0 {
        bin / bin_cap
    } else {
        f64::INFINITY
    };
    Some((AUTO_TARGET_MARGIN / over_packed.max(over_encoded)).min(1.0))
}

/// Resolve the format and load the source into GLB bytes, then fit it under the
/// size/render-weight gates.
///
/// Auto mode (no explicit quality knob) is MEASURE → PREDICT, never a guessed
/// coefficient: pass 1 is lossless (weld + reorder + encode only), and since
/// both gate metrics scale ~linearly with triangle count, its real numbers
/// predict the exact keep ratio a failing model needs (`required_keep`). Most
/// models fit lossless and are returned untouched — geometry is only reduced
/// when a gate proves it must be, and then by the minimum measured amount.
/// (The old weight-derived error budget decimated models that had no size
/// problem: a 34 MB-decoded connector — 12x under the render-weight gate —
/// lost 95% of its triangles, pins first, because meshopt's error normalizes
/// to the merged mesh's extent.)
///
/// Explicit knobs (ladder/simplify/tolerance/auto_error) bypass all of this —
/// the caller owns the policy and their ladder is walked as given. If nothing
/// fits, fail with `cannot_fit_budget` (never store an over-cap blob).
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

    // One optimize pass over the tessellated GLB. Every source is GLB here
    // (STEP/STL ingested, GLB mmap'd, text glTF repacked in load_source).
    let run_pass = |simplify: Option<f32>,
                    auto_error: Option<f32>,
                    aggressive: bool|
     -> Result<Outcome, ActionErr> {
        let o = optimize::Options {
            codec: opts.codec,
            simplify,
            tolerance: opts.tolerance,
            auto_error,
            simplify_aggressive: aggressive,
            draco_bits: opts.draco_bits,
            quantize_normals: opts.quantize_normals,
            merge_primitives: opts.merge_primitives,
            weld: opts.weld,
            reorder: opts.reorder,
        };
        let mut res = optimize::optimize_glb(glb, &o)
            .map_err(|e| ActionErr::new("optimize_failed", e.message))?;
        res.stats.input_bytes = input_bytes;
        Ok(Outcome {
            glb: res.glb,
            stats: res.stats,
            codec: opts.codec,
            ratio: simplify,
            warnings: Vec::new(),
            detected_format,
            detected_via,
        })
    };
    let fits =
        |o: &Outcome| o.stats.decoded_bytes <= opts.max_packed && o.glb.len() <= opts.max_output;
    let over_msg = |label: &str, o: &Outcome| {
        format!(
            "{label} over budget: render-weight {}B (max {}B), output {}B (max {}B)",
            o.stats.decoded_bytes,
            opts.max_packed,
            o.glb.len(),
            opts.max_output
        )
    };

    if opts.auto_scale {
        // Measure at full fidelity first.
        let lossless = run_pass(None, None, false)?;
        if fits(&lossless) {
            return Ok(lossless);
        }
        let mut warnings = vec![over_msg("lossless", &lossless)];
        // The JSON (structure) chunk survives simplification whole — if it
        // alone exceeds the output cap, no amount of triangle removal can ever
        // fit. Fail now with the real reason instead of burning three passes
        // discovering it. (Revisit if the optimizer ever learns to prune the
        // scene graph itself — then this floor stops being a floor.)
        let json_len = glb_json_len(&lossless.glb).unwrap_or(0);
        if json_len >= opts.max_output {
            return Err(ActionErr::new(
                "cannot_fit_budget",
                format!(
                    "scene structure alone ({json_len}B of glTF JSON) exceeds the output cap \
                     ({}B) — simplification cannot fit this model",
                    opts.max_output
                ),
            ));
        }
        // Predict the keep ratio from the measured overshoot, then converge:
        // each miss re-predicts from that pass's real numbers, so the ratio
        // shrinks geometrically. The bounded pass count replaces the old
        // skip-to-coarsest deadline dance — pass 2 already targets the size the
        // model must reach, there are no intermediate rungs to skip.
        let mut keep = required_keep(
            lossless.stats.decoded_bytes,
            lossless.glb.len(),
            json_len,
            opts.max_packed,
            opts.max_output,
        )
        .unwrap_or(1.0);
        let mut smallest = lossless.glb.len();
        let mut prev_encoded = lossless.glb.len();
        let mut aggressive = false;
        for _ in 0..AUTO_MAX_TARGETED_PASSES {
            // Ratio targeting hits its triangle count whatever the error — the
            // gate has proven the reduction unavoidable, and meshopt removes the
            // lowest-error collapses first, so what fidelity can survive does.
            let out = run_pass(Some(keep as f32), None, aggressive)?;
            if fits(&out) {
                return Ok(out);
            }
            warnings.push(over_msg(
                &format!("keep={keep:.4}{}", if aggressive { " (sloppy)" } else { "" }),
                &out,
            ));
            let further = required_keep(
                out.stats.decoded_bytes,
                out.glb.len(),
                glb_json_len(&out.glb).unwrap_or(0),
                opts.max_packed,
                opts.max_output,
            )
            .unwrap_or(1.0);
            // Re-anchor on what the pass actually ACHIEVED, not what it was
            // asked for — topology-preserving simplify stalls above the target
            // when it runs out of legal edge collapses, and multiplying the
            // requested ratio down further would change nothing.
            let achieved = out.stats.output_triangles as f64
                / out.stats.input_triangles.max(1) as f64;
            keep = (achieved * further).min(keep);
            // Stall: the pass barely moved the encoded size — no smaller target
            // can help while collapses are exhausted. Escalate to sloppy
            // (positional) simplification, which trades topology for the
            // ability to reach any triangle count. Only ever reached after
            // bounded simplification has provably hit its floor.
            if out.glb.len() as f64 > prev_encoded as f64 * 0.98 {
                aggressive = true;
            }
            prev_encoded = out.glb.len();
            smallest = smallest.min(out.glb.len());
        }
        return Err(ActionErr::new(
            "cannot_fit_budget",
            format!(
                "could not fit the size/render-weight budget (smallest {smallest}B, max {}B) \
                 after {AUTO_MAX_TARGETED_PASSES} targeted passes. {}",
                opts.max_output,
                warnings.join("; ")
            ),
        ));
    }

    // Explicit quality knobs: walk the caller's ladder as given, first rung
    // under both gates wins.
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
        let outcome = run_pass(rung, opts.auto_error, opts.simplify_aggressive)?;
        if fits(&outcome) {
            return Ok(outcome);
        }
        warnings.push(over_msg(&format!("rung {rung:?}"), &outcome));
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
            ladder,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "scratch probe: needs real STEP files in .ai/scratch/"]
    fn probe_real_model() {
        let scratch = concat!(env!("CARGO_MANIFEST_DIR"), "/../../.ai/scratch");
        let opts = crate::optimize_opts(&serde_json::json!({}), &serde_json::json!({}));
        eprintln!(
            "PROBE opts lin={} ang={} auto_scale={} max_packed={} max_output={}",
            opts.lin, opts.ang, opts.auto_scale, opts.max_packed, opts.max_output
        );
        let mut files: Vec<_> = std::fs::read_dir(scratch)
            .expect("scratch dir")
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                p.extension()
                    .and_then(|x| x.to_str())
                    .is_some_and(|x| ["step", "stp", "gltf", "glb", "stl"].contains(&x))
            })
            .collect();
        files.sort();
        assert!(!files.is_empty(), "no model files in {scratch}");
        for path in files {
            let p = path.to_str().unwrap();
            let name = path.file_name().unwrap().to_str().unwrap();
            let ext = path.extension().unwrap().to_str().unwrap();
            for (label, max_packed, max_output) in [
                ("prod-gates", opts.max_packed, opts.max_output),
                // Force the measured-overshoot predictor path.
                ("tight-gates", 8 * 1024 * 1024, 2 * 1024 * 1024),
            ] {
                let mut o = crate::optimize_opts(&serde_json::json!({}), &serde_json::json!({}));
                o.max_packed = max_packed;
                o.max_output = max_output;
                let t0 = std::time::Instant::now();
                let out = match run_optimize(p, ext, Some(ext), &o) {
                    Ok(r) => r,
                    Err(e) => panic!("optimize failed on {p} ({label}): {} {}", e.code, e.message),
                };
                eprintln!(
                    "PROBE {name} {label} in {:?}: ratio={:?} in_tris={} out_tris={} kept={:.1}% decoded={} glb={}",
                    t0.elapsed(),
                    out.ratio,
                    out.stats.input_triangles,
                    out.stats.output_triangles,
                    100.0 * out.stats.output_triangles as f64
                        / out.stats.input_triangles.max(1) as f64,
                    out.stats.decoded_bytes,
                    out.glb.len()
                );
            }
        }
    }

    /// A model under both gates must never be touched — `required_keep` returns
    /// `None` (no simplify pass runs at all). A weight-derived budget is what
    /// shredded the connector housing: 95% of its triangles deleted while it sat
    /// 5x under the output cap and 12x under the render-weight cap.
    #[test]
    fn required_keep_is_none_when_the_model_fits() {
        assert_eq!(required_keep(0, 0, 0, 100, 100), None);
        assert_eq!(required_keep(100, 100, 0, 100, 100), None);
        // The real connector's numbers vs the production gates.
        assert_eq!(
            required_keep(33_933_600, 9_957_924, 0, 419_430_400, 52_428_800),
            None
        );
    }

    /// The keep ratio is the inverse of the WORST gate overshoot times the
    /// safety margin — both gate metrics are ~linear in triangle count, so this
    /// is a prediction, not a guess.
    #[test]
    fn required_keep_tracks_the_worst_overshoot() {
        // 2x over the render-weight gate, encoded fine → keep 0.85/2.
        let k = required_keep(200, 10, 0, 100, 100).unwrap();
        assert!((k - 0.425).abs() < 1e-9, "got {k}");
        // Encoded gate is the worse one (4x) → it wins over decoded (2x).
        let k = required_keep(200, 400, 0, 100, 100).unwrap();
        assert!((k - 0.2125).abs() < 1e-9, "got {k}");
        // Barely over still shrinks (margin applies) and never exceeds 1.
        let k = required_keep(101, 0, 0, 100, 100).unwrap();
        assert!(k < 1.0 && k > 0.8, "got {k}");
    }

    /// Encoded bytes are structure + mesh; only the mesh term shrinks with
    /// triangles. The affine correction subtracts the JSON constant from both
    /// sides — without it the prediction is too optimistic on structure-heavy
    /// files (Vehicle: ~3 MB of scene JSON cost an extra full pass).
    #[test]
    fn required_keep_subtracts_the_structure_constant() {
        // encoded = 40 JSON + 360 mesh, cap 100: plain model says keep
        // 0.85/4 = 0.2125, but the mesh must fit in 100-40=60 → 0.85*60/360.
        let k = required_keep(0, 400, 40, 1_000_000, 100).unwrap();
        assert!((k - 0.85 * 60.0 / 360.0).abs() < 1e-9, "got {k}");
        // json_len at/over the cap is the caller's fast-fail case; the
        // prediction itself degrades to "keep nothing" rather than dividing
        // by zero.
        let k = required_keep(0, 400, 100, 1_000_000, 100).unwrap();
        assert!(k < 1e-12, "got {k}");
    }

    /// Convergence: re-predicting from a missed pass's real numbers shrinks the
    /// ratio geometrically — a 100x-over model reaches its target in two steps.
    #[test]
    fn required_keep_converges_geometrically() {
        let k1 = required_keep(10_000, 0, 0, 100, 100).unwrap(); // 100x over
        let after_pass = (10_000.0 * k1) as usize; // linear model holds
        assert!(after_pass <= 100, "one predicted pass should land under");
    }

    /// Header parse of our own encoder's GLB output, with the defensive
    /// fallbacks for anything malformed.
    #[test]
    fn glb_json_len_parses_and_guards() {
        let mut glb = Vec::new();
        glb.extend_from_slice(b"glTF");
        glb.extend_from_slice(&2u32.to_le_bytes()); // version
        glb.extend_from_slice(&28u32.to_le_bytes()); // total length
        glb.extend_from_slice(&8u32.to_le_bytes()); // JSON chunk length
        glb.extend_from_slice(b"JSON");
        glb.extend_from_slice(b"{\"a\":1} ");
        assert_eq!(glb_json_len(&glb), Some(8));
        assert_eq!(glb_json_len(b"not a glb"), None);
        assert_eq!(glb_json_len(&glb[..12]), None);
        // Declared JSON length larger than the blob → reject.
        let mut bad = glb.clone();
        bad[12..16].copy_from_slice(&10_000u32.to_le_bytes());
        assert_eq!(glb_json_len(&bad), None);
    }
}
