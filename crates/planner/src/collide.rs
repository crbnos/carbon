//! Collision-query core over the FCL bridge: `contacts_at` (max penetration
//! depth per neighbor), the `classify` early-stop path, path/free-travel sweeps,
//! and the mate/seated/self exemption maps.

use crate::consts::*;
use crate::types::{Component, FastenerInfo};
use nalgebra::Vector3;
use smallvec::SmallVec;
use std::collections::HashMap;

/// Per-query contact list. Almost every sample touches ≤8 others, so the list
/// lives inline on the stack — millions of `contacts_at` calls (2.9M on the
/// 431-part BCU) stop paying a heap alloc each.
pub type Contacts = SmallVec<[(String, f64); 8]>;

/// Global count of `contacts_at` calls (perf diagnostic; read via `contacts_at_calls`).
pub static CONTACTS_AT_CALLS: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

/// Snapshot the current `contacts_at` call count.
pub fn contacts_at_calls() -> usize {
    CONTACTS_AT_CALLS.load(std::sync::atomic::Ordering::Relaxed)
}

/// Per-query FCL contact budget. Every consumer collapses contacts to
/// max-depth-per-neighbor, so this only bounds pathological deep overlaps; the
/// classify path early-stops well before it.
const NUM_MAX_CONTACTS: usize = 100_000;

/// An allowance map: partner nodeId -> allowed seated interference (mm).
/// `f64::INFINITY` means "the moving part / group member itself" — never counts
/// as touching or blocking.
pub type Exempt = HashMap<String, f64>;

/// One FCL broadphase manager built from a set of static parts, reused across
/// all samples of a sweep — the algorithmic replacement for the old
/// per-sample-per-other pairwise `collide`. The moving part is expected to be
/// absent from `others` (callers pass `others` = the current set minus the
/// moving part), so no self-collision cost is paid.
pub struct Broadphase {
    manager: cxx::UniquePtr<collision::Manager>,
    index_to_node: Vec<String>,
}

impl Broadphase {
    pub fn new(others: &[&Component]) -> Self {
        let mut manager = collision::manager_new();
        let mut index_to_node = Vec::with_capacity(others.len());
        for o in others {
            collision::manager_add(manager.pin_mut(), &o.bvh());
            index_to_node.push(o.node_id.clone());
        }
        collision::manager_setup(manager.pin_mut());
        Broadphase {
            manager,
            index_to_node,
        }
    }

    /// `_contacts_at`: (otherName, max_depth) for `part` translated by
    /// `translation` against the registered others. One broadphase query.
    pub fn contacts_at(&self, part: &Component, translation: &Vector3<f64>) -> Contacts {
        CONTACTS_AT_CALLS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let bvh = part.bvh();
        let cs = collision::manager_collide_single(
            &self.manager,
            &bvh,
            -1,
            translation[0],
            translation[1],
            translation[2],
            NUM_MAX_CONTACTS,
        );
        cs.into_iter()
            .map(|c| (self.index_to_node[c.other].clone(), c.depth))
            .collect()
    }
}

/// `_contacts_at` (one-shot): builds a broadphase over `others` and queries once.
/// Prefer building a `Broadphase` when sweeping many samples.
pub fn contacts_at(
    part: &Component,
    others: &[&Component],
    translation: &Vector3<f64>,
) -> Contacts {
    Broadphase::new(others).contacts_at(part, translation)
}

/// A PERSISTENT broadphase manager for a working set of parts — built once and
/// reused across the whole plan. Sweeps exclude the moving part by its index
/// (no per-sweep rebuild, no unregister); parts are set inactive on removal.
/// This is the algorithmic key to matching/beating Python's speed: Python keeps
/// one `DynamicAABBTreeCollisionManager` for the entire greedy loop.
pub struct CollisionWorld {
    manager: cxx::UniquePtr<collision::Manager>,
    node_to_index: HashMap<String, usize>,
    index_to_node: Vec<String>,
}

// SAFETY: the parallel greedy sweeps share ONE `&CollisionWorld` across rayon
// workers, each issuing read-only `contacts_at*` queries. Those bottom out in
// FCL's `DynamicAABBTreeCollisionManager::collide(obj, cdata, cb) const` — a pure
// read (BV overlap + callback; the manager has no `mutable` members and the
// narrowphase result/contact state is call-local), over BVHModels frozen after
// `endModel` (see `SharedBvh`). The only structural mutations (`add`,
// `set_active`) take `&mut self`, so Rust statically forbids them from
// overlapping the shared `&self` queries. `manager_new`/`manager_add`/etc. are
// never called concurrently on one instance.
unsafe impl Sync for CollisionWorld {}

impl CollisionWorld {
    pub fn new(parts: &[&Component]) -> Self {
        let mut manager = collision::manager_new();
        let mut node_to_index = HashMap::new();
        let mut index_to_node = Vec::with_capacity(parts.len());
        for (i, p) in parts.iter().enumerate() {
            collision::manager_add(manager.pin_mut(), &p.bvh());
            node_to_index.insert(p.node_id.clone(), i);
            index_to_node.push(p.node_id.clone());
        }
        collision::manager_setup(manager.pin_mut());
        CollisionWorld {
            manager,
            node_to_index,
            index_to_node,
        }
    }

    pub fn from_components(parts: &[Component]) -> Self {
        let refs: Vec<&Component> = parts.iter().collect();
        Self::new(&refs)
    }

    pub fn index_of(&self, node_id: &str) -> i64 {
        self.node_to_index
            .get(node_id)
            .map(|&i| i as i64)
            .unwrap_or(-1)
    }

    /// Register a new body (a merged/combined mesh) mid-plan. Returns its index.
    pub fn add(&mut self, node_id: &str, part: &Component) -> usize {
        collision::manager_add(self.manager.pin_mut(), &part.bvh());
        collision::manager_setup(self.manager.pin_mut());
        let idx = self.index_to_node.len();
        self.node_to_index.insert(node_id.to_string(), idx);
        self.index_to_node.push(node_id.to_string());
        idx
    }

    /// Toggle a body's participation (removal, or the group unregister protocol).
    pub fn set_active(&mut self, node_id: &str, active: bool) {
        if let Some(&i) = self.node_to_index.get(node_id) {
            collision::manager_set_active(self.manager.pin_mut(), i, active);
        }
    }

    /// `_contacts_at`: (otherName, max_depth) for `part` (moving) translated by
    /// `translation`, against the active bodies — one broadphase query, self
    /// excluded by index.
    pub fn contacts_at(&self, part: &Component, translation: &Vector3<f64>) -> Contacts {
        CONTACTS_AT_CALLS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let bvh = part.bvh();
        let mi = self.index_of(&part.node_id);
        let cs = collision::manager_collide_single(
            &self.manager,
            &bvh,
            mi,
            translation[0],
            translation[1],
            translation[2],
            NUM_MAX_CONTACTS,
        );
        cs.into_iter()
            .map(|c| (self.index_to_node[c.other].clone(), c.depth))
            .collect()
    }

    /// Resolve an exempt map (name → allowance) into index-space blocking
    /// thresholds for `classify`: each finite allowance becomes
    /// `allowance + MATE_DEPTH_MARGIN_MM` (the exact skip predicate the Rust
    /// consumers apply); infinite allowances pass through as +INF (the backend
    /// drops those neighbors entirely — they can never block, near, or touch).
    pub fn resolve_exempt(&self, exempt: Option<&Exempt>) -> (Vec<i64>, Vec<f64>) {
        let mut idx = Vec::new();
        let mut am = Vec::new();
        if let Some(ex) = exempt {
            for (name, &allow) in ex {
                if let Some(&i) = self.node_to_index.get(name) {
                    idx.push(i as i64);
                    am.push(if allow == f64::INFINITY {
                        f64::INFINITY
                    } else {
                        allow + MATE_DEPTH_MARGIN_MM
                    });
                }
            }
        }
        (idx, am)
    }

    /// Threshold-classified `_contacts_at` for the sweep consumers: same
    /// (other, depth) shape, but the backend may early-stop each neighbor at
    /// the first pair past its predicate threshold (see the bridge doc). On
    /// the FCL backend this is EXACTLY `contacts_at` (hints ignored) — parity
    /// holds by construction. `want_touch_near=false` when the caller only
    /// tests blocking (free_travel / path_blockers).
    #[allow(clippy::too_many_arguments)]
    pub fn classify(
        &self,
        part: &Component,
        translation: &Vector3<f64>,
        skip_nodes: &std::collections::BTreeSet<String>,
        ov: &(Vec<i64>, Vec<f64>),
        tol: f64,
        want_touch_near: bool,
    ) -> Contacts {
        CONTACTS_AT_CALLS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let bvh = part.bvh();
        let mut skip: SmallVec<[i64; 16]> = SmallVec::with_capacity(skip_nodes.len() + 1);
        skip.push(self.index_of(&part.node_id));
        for n in skip_nodes {
            if let Some(&i) = self.node_to_index.get(n) {
                skip.push(i as i64);
            }
        }
        let cs = collision::manager_classify_multi(
            &self.manager,
            &bvh,
            &skip,
            &ov.0,
            &ov.1,
            translation[0],
            translation[1],
            translation[2],
            tol,
            want_touch_near,
            NUM_MAX_CONTACTS,
        );
        cs.into_iter()
            .map(|c| (self.index_to_node[c.other].clone(), c.depth))
            .collect()
    }

    /// `_contacts_at` with extra bodies culled at the broadphase — the moving
    /// part plus any `skip_nodes` (known blockers a sweep no longer needs to
    /// re-enumerate). One broadphase query; skipped bodies never narrowphase.
    pub fn contacts_at_excluding(
        &self,
        part: &Component,
        translation: &Vector3<f64>,
        skip_nodes: &std::collections::BTreeSet<String>,
    ) -> Contacts {
        CONTACTS_AT_CALLS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let bvh = part.bvh();
        let mut skip: SmallVec<[i64; 16]> = SmallVec::with_capacity(skip_nodes.len() + 1);
        skip.push(self.index_of(&part.node_id));
        for n in skip_nodes {
            if let Some(&i) = self.node_to_index.get(n) {
                skip.push(i as i64);
            }
        }
        let cs = collision::manager_collide_single_multi(
            &self.manager,
            &bvh,
            &skip,
            translation[0],
            translation[1],
            translation[2],
            NUM_MAX_CONTACTS,
        );
        cs.into_iter()
            .map(|c| (self.index_to_node[c.other].clone(), c.depth))
            .collect()
    }
}

/// `_blocking_depth`: max blocking penetration over a sample's contacts.
pub fn blocking_depth(contacts: &[(String, f64)], exempt: Option<&Exempt>) -> f64 {
    let mut depth = 0.0;
    for (other, cd) in contacts {
        if let Some(ex) = exempt {
            if let Some(&allow) = ex.get(other) {
                if *cd <= allow + MATE_DEPTH_MARGIN_MM {
                    continue;
                }
            }
        }
        if *cd > depth {
            depth = *cd;
        }
    }
    depth
}

/// `_mate_exempt`: bore-engagement allowances for this part along `direction`.
pub fn mate_exempt(
    part: &Component,
    direction: &Vector3<f64>,
    fasteners: &HashMap<String, FastenerInfo>,
) -> Option<Exempt> {
    let info = fasteners.get(&part.node_id)?;
    if info.mates.is_empty() && info.sliding.is_empty() {
        return None;
    }
    if direction.dot(&info.axis).abs() > 0.99 {
        let mut merged: Exempt = info.sliding.clone();
        for (k, v) in &info.mates {
            merged.insert(k.clone(), *v); // mates win on collision, per {**sliding, **mates}
        }
        return Some(merged);
    }
    None
}

/// `_seated_exempt`: sandwich-squish allowances valid along `direction`.
pub fn seated_exempt(part: &Component, direction: &Vector3<f64>) -> Option<Exempt> {
    if part.seated_allowance.is_empty() {
        return None;
    }
    let mut allowed: Exempt = HashMap::new();
    for (partner, depth) in &part.seated_allowance {
        if let Some(axis) = part.seated_allowance_axes.get(partner) {
            if direction.dot(axis).abs() > 0.99 {
                allowed.insert(partner.clone(), *depth);
            }
        }
    }
    if allowed.is_empty() {
        None
    } else {
        Some(allowed)
    }
}

/// `_self_exempt`: merge an infinite allowance for the moving part(s).
pub fn self_exempt(exempt: Option<Exempt>, self_ids: &[&str]) -> Exempt {
    let mut merged = exempt.unwrap_or_default();
    for id in self_ids {
        merged.insert((*id).to_string(), f64::INFINITY);
    }
    merged
}

/// numpy `np.linspace(start, end, n, endpoint=True)[1:]`.
fn linspace_tail(start: f64, end: f64, n: usize) -> Vec<f64> {
    if n <= 1 {
        return vec![end];
    }
    let step = (end - start) / (n as f64 - 1.0);
    (1..n).map(|i| start + i as f64 * step).collect()
}

/// Python `int(x)` truncation toward zero, used for the sample-count formula.
fn sample_count(samples: usize, span: f64) -> usize {
    let by_spacing = (span / MAX_SAMPLE_SPACING_MM).trunc() as i64 + 1;
    samples
        .max(by_spacing.max(0) as usize)
        .min(MAX_PATH_SAMPLES)
}

/// `_path_is_clear`: dense sampling; None if blocked, else the last touching
/// distance (0.0 for a free flight).
#[allow(clippy::too_many_arguments)]
pub fn path_is_clear(
    part: &Component,
    world: &CollisionWorld,
    direction: &Vector3<f64>,
    start: f64,
    end: f64,
    samples: usize,
    tolerance: f64,
    base_offset: Option<&Vector3<f64>>,
    exempt: Option<Exempt>,
    check_until: Option<f64>,
) -> Option<f64> {
    if end <= start {
        return None;
    }
    // Compliant squish along the sandwich axis never blocks; explicit
    // exemptions keep precedence when larger.
    let mut exempt = exempt;
    if let Some(seated) = seated_exempt(part, direction) {
        let mut merged = seated;
        if let Some(ex) = &exempt {
            for (k, v) in ex {
                let e = merged.entry(k.clone()).or_insert(f64::MIN);
                *e = e.max(*v);
            }
        }
        exempt = Some(merged);
    }
    let n = sample_count(samples, end - start);
    let offsets = linspace_tail(start, end, n);
    let spacing = (end - start) / (n.max(2) as f64 - 1.0);

    let no_skip = std::collections::BTreeSet::new();
    let ov = world.resolve_exempt(exempt.as_ref());
    let blocked_at = |distance: f64| -> (bool, bool, bool) {
        let mut translation = direction * distance;
        if let Some(off) = base_offset {
            translation += off;
        }
        let contacts = world.classify(part, &translation, &no_skip, &ov, tolerance, true);
        if contacts.is_empty() {
            return (false, false, false);
        }
        let depth = blocking_depth(&contacts, exempt.as_ref());
        let touching = contacts.iter().any(|(other, _)| {
            !matches!(exempt.as_ref().and_then(|e| e.get(other)), Some(&a) if a == f64::INFINITY)
        });
        (depth > tolerance, depth > tolerance * 0.5, touching)
    };

    let mut last_touch = 0.0;
    for &s in &offsets {
        if let Some(cu) = check_until {
            if s > cu {
                break;
            }
        }
        let (blocked, near, touching) = blocked_at(s);
        if blocked {
            return None;
        }
        if touching {
            last_touch = s;
        }
        if near {
            let half = spacing / 2.0;
            for probe in [s - half, s + half] {
                if probe <= start || probe >= end {
                    continue;
                }
                if blocked_at(probe).0 {
                    return None;
                }
            }
        }
    }
    Some(last_touch)
}

/// `_free_travel`: furthest clear translation along `direction` from `base_offset`.
#[allow(clippy::too_many_arguments)]
pub fn free_travel(
    part: &Component,
    world: &CollisionWorld,
    direction: &Vector3<f64>,
    base_offset: &Vector3<f64>,
    cap: f64,
    samples: usize,
    exempt: Option<&Exempt>,
    tolerance: f64,
) -> f64 {
    if cap <= 0.0 {
        return 0.0;
    }
    let n = sample_count(samples, cap);
    let offsets = linspace_tail(0.0, cap, n);
    let no_skip = std::collections::BTreeSet::new();
    let ov = world.resolve_exempt(exempt);
    let mut clear = 0.0;
    for s in offsets {
        let translation = direction * s + base_offset;
        let contacts = world.classify(part, &translation, &no_skip, &ov, tolerance, false);
        if !contacts.is_empty() {
            let depth = blocking_depth(&contacts, exempt);
            if depth > tolerance {
                return clear;
            }
        }
        clear = s;
    }
    clear
}

/// `_path_blockers`: every present part the removal path cuts through
/// (union over segments). Mirrors Python's unregister-mid-sweep: once a partner
/// is a confirmed blocker its identity is all this returns, so it is culled from
/// every later sample (`contacts_at_excluding`) — otherwise a deep pass-through
/// re-enumerates that blocker's full triangle-contact set at every sample (the
/// dominant cost). Sound: a recorded blocker can't be un-recorded, and FCL
/// enumerates pairs independently, so culling one never hides another's contacts.
#[allow(clippy::too_many_arguments)]
pub fn path_blockers(
    part: &Component,
    world: &CollisionWorld,
    segments: &[(Vector3<f64>, f64)],
    samples: usize,
    fasteners: &HashMap<String, FastenerInfo>,
    extra_exempt: Option<&Exempt>,
    tolerance: f64,
) -> std::collections::BTreeSet<String> {
    let mut blockers = std::collections::BTreeSet::new();
    let mut offset = Vector3::zeros();
    for (direction, distance) in segments {
        let mut exempt = mate_exempt(part, direction, fasteners);
        if let Some(seated) = seated_exempt(part, direction) {
            let mut merged = seated;
            if let Some(ex) = exempt {
                for (k, v) in ex {
                    merged.insert(k, v);
                }
            }
            exempt = Some(merged);
        }
        if let Some(extra) = extra_exempt {
            let mut merged = exempt.unwrap_or_default();
            for (k, v) in extra {
                merged.insert(k.clone(), *v);
            }
            exempt = Some(merged);
        }
        let count = sample_count(samples, *distance);
        let ov = world.resolve_exempt(exempt.as_ref());
        for s in linspace_tail(0.0, *distance, count) {
            let translation = offset + direction * s;
            for (other, depth) in
                world.classify(part, &translation, &blockers, &ov, tolerance, false)
            {
                if let Some(ex) = &exempt {
                    if let Some(&allow) = ex.get(&other) {
                        if depth <= allow + MATE_DEPTH_MARGIN_MM {
                            continue;
                        }
                    }
                }
                if depth > tolerance {
                    blockers.insert(other);
                }
            }
        }
        offset += direction * *distance;
    }
    blockers
}
