//! cxx bridge over C++ FCL 0.7.0: triangle-mesh BVH build, a persistent
//! `DynamicAABBTreeCollisionManager` broadphase, and the moving-object queries
//! the planner drives (max penetration depth per neighbor, with a skip set and
//! a threshold-classified early-stop variant).

#[cxx::bridge(namespace = "carbon_fcl")]
pub mod ffi {
    /// One FCL contact between the two BVHs, in the exact FCL definition.
    #[derive(Debug, Clone)]
    pub struct Contact {
        pub depth: f64,
        pub nx: f64,
        pub ny: f64,
        pub nz: f64,
        pub px: f64,
        pub py: f64,
        pub pz: f64,
        /// Triangle index in the first / second BVH (FCL `b1` / `b2`).
        pub b1: i32,
        pub b2: i32,
    }

    /// One internal all-pairs contact from the broadphase manager, in the
    /// manager's traversal order. `a`/`b` index into the manager's registered
    /// objects (registration order).
    #[derive(Debug, Clone)]
    pub struct InternalContact {
        pub a: usize,
        pub b: usize,
        pub depth: f64,
        pub nx: f64,
        pub ny: f64,
        pub nz: f64,
        pub px: f64,
        pub py: f64,
        pub pz: f64,
    }

    /// Max penetration depth of a moving object against ONE registered object
    /// (collapsed per-other — every planner sweep consumer wants max-depth).
    #[derive(Debug, Clone)]
    pub struct SingleContact {
        pub other: usize,
        pub depth: f64,
    }

    unsafe extern "C++" {
        include!("collision/src/shim.h");

        /// Opaque `fcl::BVHModel<fcl::OBBRSS<double>>`.
        type Bvh;

        /// `fcl::DynamicAABBTreeCollisionManager<double>`. All-pairs contact
        /// order is stable (registration order), which `seated_pair_depths`
        /// relies on (it caps points/normals at the first 64 in that order).
        type Manager;

        /// Total FCL contacts appended across all narrowphase `collide` calls
        /// (perf diagnostic; process-global, monotonic).
        fn raw_contacts_enumerated() -> u64;

        /// Total narrowphase pair `collide` calls (perf diagnostic; global).
        fn narrow_pairs_run() -> u64;

        fn manager_new() -> UniquePtr<Manager>;

        /// Register a BVH at identity transform (world-baked mesh). Index =
        /// registration order.
        fn manager_add(m: Pin<&mut Manager>, bvh: &Bvh);

        /// Build the broadphase tree. Call ONCE after registration changes
        /// (add / set_active); the collide queries then reuse it (never rebuild
        /// per query — that was the whole point of a persistent manager).
        fn manager_setup(m: Pin<&mut Manager>);

        /// All-pairs contacts in the manager's broadphase traversal order.
        fn manager_internal_contacts(m: &Manager, num_max_contacts: usize) -> Vec<InternalContact>;

        /// Toggle a registered object's participation (the `_unregistered`
        /// protocol: unregister a part while sweeping it, re-register after).
        /// Rebuilds the broadphase tree (`update`).
        fn manager_set_active(m: Pin<&mut Manager>, index: usize, active: bool);

        /// Collide a moving object (at translation `tx,ty,tz`, identity rot)
        /// against the currently-active registered objects — the broadphase
        /// equivalent of the planner's `contacts_at`. `moving_index` is the
        /// moving part's own registered index (to exclude self), or -1 when the
        /// moving object is not a registered part (a combined group mesh).
        /// Returns max depth per overlapping other.
        fn manager_collide_single(
            m: &Manager,
            moving: &Bvh,
            moving_index: i64,
            tx: f64,
            ty: f64,
            tz: f64,
            num_max_contacts: usize,
        ) -> Vec<SingleContact>;

        /// Like `manager_collide_single`, but skips a SET of registered objects
        /// (moving part + already-known blockers) at the broadphase callback —
        /// so a deep pass-through stops re-enumerating a known blocker's full
        /// contact set at every subsequent sample, without a manager rebuild.
        /// Returns max depth per remaining other.
        fn manager_collide_single_multi(
            m: &Manager,
            moving: &Bvh,
            skip_indices: &[i64],
            tx: f64,
            ty: f64,
            tz: f64,
            num_max_contacts: usize,
        ) -> Vec<SingleContact>;

        /// Threshold-classified variant of `manager_collide_single_multi`. The
        /// planner's sweep consumers only test three predicates per neighbor —
        /// blocked (depth > threshold), near (> tol/2), touching (any contact) —
        /// so a backend may EARLY-STOP a neighbor's traversal at the first pair
        /// past the relevant threshold instead of enumerating its full contact
        /// set, as long as the returned depth lands in the same predicate
        /// bracket. Per-neighbor thresholds: `ov_idx[i]` gets blocking threshold
        /// `max(tol, ov_am[i])` (mate/seated allowance + margin); +INF means
        /// "never reports". `want_touch_near=false` lets a backend skip the
        /// touch/near probes (free_travel / path_blockers only test blocking).
        ///
        /// Early-stops each neighbor's BVH traversal at the first pair past its
        /// threshold (FCL's own `canStop` hook); a miss has already fully
        /// enumerated, so near/touch classification stays exact.
        #[allow(clippy::too_many_arguments)]
        fn manager_classify_multi(
            m: &Manager,
            moving: &Bvh,
            skip_indices: &[i64],
            ov_idx: &[i64],
            ov_am: &[f64],
            tx: f64,
            ty: f64,
            tz: f64,
            tol: f64,
            want_touch_near: bool,
            num_max_contacts: usize,
        ) -> Vec<SingleContact>;

        /// Build a BVH from flat world-space vertices (n*3 f64) and triangles
        /// (m*3 u32), in the same vertex/triangle order the mesh stores them.
        fn new_bvh(verts: &[f64], tris: &[u32]) -> UniquePtr<Bvh>;

        /// Contacts of BVH `a` translated by (ax,ay,az) against BVH `b`
        /// translated by (bx,by,bz), identity rotation — the only transforms
        /// the planner uses (parts are pre-baked to world space; the moving
        /// part gets a pure translation). `num_max_contacts` matches the
        /// planner's `CollisionRequest(num_max_contacts=100000)`.
        fn collide_pair(
            a: &Bvh,
            ax: f64,
            ay: f64,
            az: f64,
            b: &Bvh,
            bx: f64,
            by: f64,
            bz: f64,
            num_max_contacts: usize,
        ) -> Vec<Contact>;

        /// Exact minimum distance between two BVHs at identity transforms
        /// (0.0 when touching/penetrating, as FCL reports). Used only for the
        /// ordering-adjacency near-contact query.
        fn distance_pair(a: &Bvh, b: &Bvh) -> f64;
    }
}

pub use ffi::{
    collide_pair, distance_pair, manager_add, manager_classify_multi, manager_collide_single,
    manager_collide_single_multi, manager_internal_contacts, manager_new, manager_set_active,
    manager_setup, narrow_pairs_run, new_bvh, raw_contacts_enumerated, Bvh, Contact,
    InternalContact, Manager, SingleContact,
};
