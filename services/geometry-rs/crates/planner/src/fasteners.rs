//! Fastener classification helpers: name/geometry test and head direction.

use crate::consts::world_axes;
use crate::types::{Component, FastenerInfo};
use nalgebra::Vector3;
use regex::Regex;
use std::collections::HashMap;
use std::sync::OnceLock;

fn fastener_name_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?i)\b(screw|bolt|nut|washer|rivet|stud|dowel)s?\b|\bM\d+(x[\d.]+)?\b|\bDIN ?\d+|\bISO ?\d+",
        )
        .unwrap()
    })
}

/// `_is_fastener`: does the part's name match the fastener pattern?
pub fn is_fastener(part: &Component) -> bool {
    fastener_name_re().is_match(&part.name)
}

/// `_head_direction`: tip → head sense of a fastener's axis.
pub fn head_direction(
    part: &Component,
    info: &FastenerInfo,
    units_by_id: Option<&HashMap<String, Component>>,
) -> Vector3<f64> {
    let axis = info.axis;
    let verts = &part.mesh.vertices;
    if verts.len() >= 8 {
        let center = (part.bbox_min + part.bbox_max) / 2.0;
        let mut projs = Vec::with_capacity(verts.len());
        let mut radials = Vec::with_capacity(verts.len());
        for v in verts {
            let rel = v - center;
            let proj = rel.dot(&axis);
            projs.push(proj);
            radials.push((rel - axis * proj).norm());
        }
        let pmax = projs.iter().cloned().fold(f64::MIN, f64::max);
        let pmin = projs.iter().cloned().fold(f64::MAX, f64::min);
        let span = pmax - pmin;
        if span > 1e-6 {
            let mut hi = 0.0f64;
            let mut lo = 0.0f64;
            let mut any_hi = false;
            let mut any_lo = false;
            for (i, &p) in projs.iter().enumerate() {
                if p > span * 0.25 {
                    hi = hi.max(radials[i]);
                    any_hi = true;
                }
                if p < -span * 0.25 {
                    lo = lo.max(radials[i]);
                    any_lo = true;
                }
            }
            let hi = if any_hi { hi } else { 0.0 };
            let lo = if any_lo { lo } else { 0.0 };
            if (hi - lo).abs() > 0.2 {
                return if hi > lo { axis } else { -axis };
            }
        }
    }
    if let Some(units) = units_by_id {
        if !info.mates.is_empty() {
            let mut centers = Vec::new();
            for m in info.mates.keys() {
                if let Some(u) = units.get(m) {
                    centers.push((u.bbox_min + u.bbox_max) / 2.0);
                }
            }
            if !centers.is_empty() {
                let f_center = (part.bbox_min + part.bbox_max) / 2.0;
                let mut mean = Vector3::zeros();
                for c in &centers {
                    mean += c;
                }
                mean /= centers.len() as f64;
                let away = f_center - mean;
                if away.dot(&axis) < 0.0 {
                    return -axis;
                }
            }
        }
    }
    axis
}

/// `_axis_span`: the part's bbox extent projected onto an axis line through origin.
pub fn axis_span(part: &Component, axis: &Vector3<f64>, origin: &Vector3<f64>) -> (f64, f64) {
    let mut lo = f64::INFINITY;
    let mut hi = f64::NEG_INFINITY;
    for xi in 0..2 {
        for yi in 0..2 {
            for zi in 0..2 {
                let corner = Vector3::new(
                    if xi == 0 {
                        part.bbox_min[0]
                    } else {
                        part.bbox_max[0]
                    },
                    if yi == 0 {
                        part.bbox_min[1]
                    } else {
                        part.bbox_max[1]
                    },
                    if zi == 0 {
                        part.bbox_min[2]
                    } else {
                        part.bbox_max[2]
                    },
                );
                let p = (corner - origin).dot(axis);
                lo = lo.min(p);
                hi = hi.max(p);
            }
        }
    }
    (lo, hi)
}

/// Snap an axis to a positive world axis when aligned (shared helper).
pub fn snap_world(axis: Vector3<f64>) -> Vector3<f64> {
    for w in world_axes() {
        if axis.dot(&w) > 0.999 {
            return w;
        }
    }
    axis
}
