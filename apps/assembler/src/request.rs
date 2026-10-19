// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! Every action's request, parsed in ONE place. The create handler parses the
//! HTTP body here and the Lambda worker parses the same body here again, so a
//! default cannot differ between the standing service and Lambda. (They did:
//! convert tessellated at 0.15 rad on one and 0.5 on the other, so the same
//! model got different nodeIds depending on where it ran.)

use crate::{actions, config, error::ApiError, AppState};
use serde_json::Value;

/// Default optimise output ceiling (encoded bytes) — the served-bucket safety net.
pub const DEFAULT_MAX_OUTPUT_BYTES: u64 = 52_428_800; // 50 MiB
/// Default decoded (render-weight) ceiling — guards viewer hangs on huge meshes.
pub const DEFAULT_MAX_RENDER_WEIGHT_BYTES: u64 = 419_430_400; // 400 MiB

/// The actions a job can run.
pub const ACTIONS: [&str; 6] = ["convert", "optimize", "plan", "compact", "thumbnail", "fetch"];

/// A parsed request, ready to spawn.
pub enum ActionReq {
    Convert(actions::convert::ConvertReq),
    Optimize(actions::optimize::OptimizeReq),
    Plan(actions::plan::PlanReq),
    Compact(actions::compact::CompactReq),
    Thumbnail(actions::thumbnail::ThumbnailReq),
    Fetch(actions::fetch::FetchReq),
}

/// Parse and validate a create body for `action`. Errors are 400s (an
/// unknown action is a 404), raised before any job is recorded.
pub fn parse(action: &str, req: &Value) -> Result<ActionReq, ApiError> {
    if !ACTIONS.contains(&action) {
        return Err(ApiError::new(404, "not_found", format!("no action {action}")));
    }
    let source_url = req["source"]["url"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::invalid("missing source.url"))?;
    config::validate_url(source_url)?;
    let source_url = source_url.to_string();
    let path = |v: &Value| v.as_str().map(str::to_string);

    Ok(match action {
        "convert" => ActionReq::Convert(actions::convert::ConvertReq {
            source_url,
            declared_hash: req["source"]["contentHash"]
                .as_str()
                .map(str::trim)
                .filter(|s| !s.is_empty() && s.len() <= 128)
                .map(str::to_string),
            glb_path: path(&req["outputs"]["glb"]["path"]),
            graph_path: path(&req["outputs"]["graph"]["path"]),
            lin: req["options"]["linearDeflection"]
                .as_f64()
                .unwrap_or(config::TESSELLATION_LINEAR),
            ang: req["options"]["angularDeflection"]
                .as_f64()
                .unwrap_or(config::TESSELLATION_ANGULAR),
            optimize: req["options"]["optimize"].as_bool().unwrap_or(true),
        }),
        "optimize" => {
            let (compact, thumbnail) = optimize_ingest(req);
            ActionReq::Optimize(actions::optimize::OptimizeReq {
                source_url,
                // `auto` content-detects the format in the action.
                format: req["source"]["format"].as_str().unwrap_or("auto").to_string(),
                glb_path: path(&req["output"]["path"]),
                opts: optimize_opts(&req["output"], &req["quality"]),
                compact,
                thumbnail,
            })
        }
        "plan" => ActionReq::Plan(actions::plan::PlanReq {
            source_url,
            plan_path: path(&req["meta"]["planPath"])
                .filter(|p| !p.is_empty())
                .ok_or_else(|| ApiError::invalid("missing meta.planPath"))?,
            model_upload_id: path(&req["meta"]["modelUploadId"]),
            options: req["options"].clone(),
        }),
        "compact" => ActionReq::Compact(actions::compact::CompactReq {
            source_url,
            mode: actions::compact::Mode::from_str(req["mode"].as_str().unwrap_or("xbf"))
                .ok_or_else(|| ApiError::invalid("mode must be 'xbf' or 'zstd'"))?,
            raw_path: path(&req["output"]["path"]),
        }),
        "fetch" => ActionReq::Fetch(actions::fetch::FetchReq {
            source_url,
            authorization: req["source"]["authorization"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(str::to_string),
            max_bytes: req["maxBytes"].as_u64().filter(|&b| b > 0),
            content_type: req["output"]["contentType"]
                .as_str()
                .unwrap_or("application/octet-stream")
                .to_string(),
            path: path(&req["output"]["path"]),
        }),
        _ => ActionReq::Thumbnail(thumbnail_req(&source_url, &req["output"])),
    })
}

/// Start a parsed request as job `job_id` (already `set_pending`).
pub fn spawn(state: &AppState, job_id: &str, req: ActionReq) {
    match req {
        ActionReq::Convert(r) => actions::convert::spawn(state, job_id, r),
        ActionReq::Optimize(r) => actions::optimize::spawn(state, job_id, r),
        ActionReq::Plan(r) => actions::plan::spawn(state, job_id, r),
        ActionReq::Compact(r) => actions::compact::spawn(state, job_id, r),
        ActionReq::Thumbnail(r) => actions::thumbnail::spawn(state, job_id, r),
        ActionReq::Fetch(r) => actions::fetch::spawn(state, job_id, r),
    }
}

/// Build the optimise `Opts` from the request's `output` + `quality` objects
/// (snake_case).
pub(crate) fn optimize_opts(out: &Value, q: &Value) -> actions::optimize::Opts {
    actions::optimize::Opts {
        codec: out["codec"]
            .as_str()
            .and_then(optimize::Codec::from_str_opt)
            .unwrap_or_default(),
        ladder: parse_ladder(q),
        simplify_aggressive: q["simplify_aggressive"].as_bool().unwrap_or(false),
        weld: q["weld"].as_bool().unwrap_or(true),
        reorder: q["reorder"].as_bool().unwrap_or(true),
        // The quality/perf knob: max simplify deviation in mm. Absent = ratio-only.
        tolerance: q["tolerance_mm"].as_f64().map(|f| f as f32),
        // Auto mode by default (scale-invariant, per-mesh adaptive); `auto_error: 0`
        // disables it for a lossless optimise (weld/reorder/encode only).
        auto_error: Some(
            q["auto_error"]
                .as_f64()
                .unwrap_or(optimize::DEFAULT_AUTO_ERROR as f64) as f32,
        )
        .filter(|&e| e > 0.0),
        // Size-adaptive quality applies only when the caller pinned no explicit
        // quality knob (the eager-optimise job's case). Any explicit ladder /
        // simplify / tolerance / auto_error is a full override and disables it.
        auto_scale: q["ladder"].is_null()
            && q["simplify"].is_null()
            && q["tolerance_mm"].is_null()
            && q["auto_error"].is_null(),
        draco_bits: (
            q["draco_position_bits"].as_i64().unwrap_or(14) as i32,
            q["draco_normal_bits"].as_i64().unwrap_or(10) as i32,
            q["draco_texcoord_bits"].as_i64().unwrap_or(12) as i32,
        ),
        quantize_normals: q["quantize_normals"].as_bool().unwrap_or(true),
        merge_primitives: q["merge_primitives"].as_bool().unwrap_or(true),
        max_packed: out["max_render_weight_bytes"]
            .as_u64()
            .unwrap_or(DEFAULT_MAX_RENDER_WEIGHT_BYTES) as usize,
        max_output: out["max_bytes"]
            .as_u64()
            .unwrap_or(DEFAULT_MAX_OUTPUT_BYTES) as usize,
        lin: q["linear_deflection"].as_f64().unwrap_or(0.1),
        // The preview GLB only — no nodeId comes from it, so it is free to
        // tessellate finer than `config::TESSELLATION_ANGULAR`. 0.15 rad ≈ 42
        // segments per circle (0.25 gave 25, 0.5 a blocky 13). Angular
        // deflection is the only SCALE-INVARIANT constraint: a small hole's sag
        // budget is satisfied after a handful of chords, so segment count on
        // holes/grooves/fillets comes from this value alone. The bridge also
        // scales linear deflection to each shape, which covers the large curved
        // faces where sag does bind.
        ang: q["angular_deflection"].as_f64().unwrap_or(0.15),
        // Per-request budget wins; else the env default (set on the Lambda path).
        budget: q["time_budget_secs"]
            .as_u64()
            .filter(|&s| s > 0)
            .or_else(config::optimize_budget_secs)
            .map(std::time::Duration::from_secs),
        // Turned into an absolute deadline in `optimize::spawn` (charges the
        // download + tessellation already spent).
        deadline: None,
    }
}

/// The simplify ladder: `quality.ladder` (array of number|null) if present, else
/// a single rung from `quality.simplify`, else an aggressive default ladder
/// (performance-first: walk down until the output fits the size/render gates).
fn parse_ladder(quality: &Value) -> Vec<Option<f32>> {
    if let Some(arr) = quality["ladder"].as_array() {
        return arr.iter().map(|v| v.as_f64().map(|f| f as f32)).collect();
    }
    match quality["simplify"].as_f64() {
        Some(f) => vec![Some(f as f32)],
        None => vec![None, Some(0.5), Some(0.25), Some(0.1)],
    }
}

/// The ingest outputs an optimize may also write: `compact: { path? }` (the
/// retained raw's compact form, output `raw`) and `thumbnail: { path?, size?,
/// direction? }` (output `thumbnail`).
fn optimize_ingest(
    req: &Value,
) -> (Option<Option<String>>, Option<actions::optimize::ThumbnailOut>) {
    let compact = req["compact"]
        .is_object()
        .then(|| req["compact"]["path"].as_str().map(str::to_string));
    let thumbnail = req["thumbnail"].is_object().then(|| {
        let t = thumbnail_req("", &req["thumbnail"]);
        actions::optimize::ThumbnailOut {
            path: t.path,
            size: t.size,
            direction: t.direction,
        }
    });
    (compact, thumbnail)
}

/// `output: { path?, size?, direction? }`. `direction` is `[x, y, z]`, model
/// towards camera.
fn thumbnail_req(source_url: &str, output: &Value) -> actions::thumbnail::ThumbnailReq {
    actions::thumbnail::ThumbnailReq {
        source_url: source_url.to_string(),
        size: output["size"]
            .as_u64()
            .map_or(thumbnail::DEFAULT_SIZE, |s| s.min(u32::MAX as u64) as u32),
        path: output["path"].as_str().map(str::to_string),
        direction: view_direction(&output["direction"]),
    }
}

/// Three finite numbers that are not all zero, else the viewer's home direction.
fn view_direction(value: &Value) -> [f32; 3] {
    let parsed: Option<Vec<f32>> = value
        .as_array()
        .filter(|a| a.len() == 3)
        .and_then(|a| a.iter().map(|n| n.as_f64().map(|n| n as f32)).collect());
    match parsed.as_deref() {
        Some(&[x, y, z])
            if [x, y, z].iter().all(|c| c.is_finite()) && (x, y, z) != (0.0, 0.0, 0.0) =>
        {
            [x, y, z]
        }
        _ => thumbnail::DEFAULT_DIRECTION,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn convert_and_plan_tessellate_alike_by_default() {
        let body = json!({ "source": { "url": "https://storage.test/model.step" } });
        let ActionReq::Convert(convert) = parse("convert", &body).unwrap() else {
            panic!("not a convert");
        };
        assert_eq!(convert.ang, config::TESSELLATION_ANGULAR);
        assert_eq!(convert.lin, config::TESSELLATION_LINEAR);
    }

    #[test]
    fn a_plan_without_a_plan_path_is_refused() {
        let body = json!({ "source": { "url": "https://storage.test/model.step" } });
        let err = parse("plan", &body).err().unwrap();
        assert_eq!(err.message, "missing meta.planPath");
    }

    #[test]
    fn a_bad_compact_mode_is_refused_before_a_job_exists() {
        let body = json!({ "source": { "url": "https://storage.test/m.step" }, "mode": "gzip" });
        assert!(parse("compact", &body).is_err());
    }

    #[test]
    fn an_unknown_action_is_not_found() {
        let body = json!({ "source": { "url": "https://storage.test/m.step" } });
        assert_eq!(parse("render", &body).err().unwrap().status, 404);
    }

    #[test]
    fn a_declared_hash_is_trimmed_and_bounded() {
        let body = json!({
            "source": { "url": "https://storage.test/m.step", "contentHash": "  abc  " }
        });
        let ActionReq::Convert(convert) = parse("convert", &body).unwrap() else {
            panic!("not a convert");
        };
        assert_eq!(convert.declared_hash.as_deref(), Some("abc"));
    }
}
