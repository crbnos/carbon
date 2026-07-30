//! Numerics on **ndarray**: pairwise summation for mean/std, sequential
//! row-reduction, LAPACK SVD/eigh, and BLAS world transforms. The float
//! evaluation order is fixed so planner ordering heuristics are reproducible.

use nalgebra::{DMatrix, Matrix3, Vector3};
#[cfg(not(target_os = "macos"))]
use ndarray::{Array1, Array2};
#[cfg(not(target_os = "macos"))]
use ndarray_linalg::{Eigh, JobSvd, SVDDC, UPLO};

// --- numpy pairwise summation (exact algorithm) ----------------------------

const PW_BLOCKSIZE: usize = 128;

/// numpy `pairwise_sum_DOUBLE` over a contiguous slice.
pub fn pairwise_sum(a: &[f64]) -> f64 {
    let n = a.len();
    if n < 8 {
        let mut res = 0.0;
        for &x in a {
            res += x;
        }
        res
    } else if n <= PW_BLOCKSIZE {
        let mut r = [a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7]];
        let mut i = 8;
        while i < n - (n % 8) {
            for j in 0..8 {
                r[j] += a[i + j];
            }
            i += 8;
        }
        let mut res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
        while i < n {
            res += a[i];
            i += 1;
        }
        res
    } else {
        let mut n2 = n / 2;
        n2 -= n2 % 8;
        pairwise_sum(&a[..n2]) + pairwise_sum(&a[n2..])
    }
}

/// `arr.sum(axis=0)` for a C-contiguous (n,3): numpy reduces the NON-contiguous
/// axis SEQUENTIALLY (pairwise summation only applies along the fast axis) —
/// verified bit-for-bit against numpy on real data.
fn sum_rows_sequential(rows: &[Vector3<f64>]) -> Vector3<f64> {
    let mut s = Vector3::zeros();
    for r in rows {
        s += r;
    }
    s
}

/// `np.mean(a)`.
pub fn mean(a: &[f64]) -> f64 {
    pairwise_sum(a) / a.len() as f64
}

/// `np.std(a)`: sqrt(mean(|x - mean|^2)), numpy summation.
pub fn std(a: &[f64]) -> f64 {
    let m = mean(a);
    let sq: Vec<f64> = a
        .iter()
        .map(|&x| {
            let d = x - m;
            d * d
        })
        .collect();
    mean(&sq).sqrt()
}

/// `arr.mean(axis=0)` over (n,3) rows.
pub fn mean_rows(rows: &[Vector3<f64>]) -> Vector3<f64> {
    sum_rows_sequential(rows) / rows.len() as f64
}

/// `np.percentile(a, 25)` (linear interpolation).
pub fn percentile25(a: &[f64]) -> f64 {
    let mut v = a.to_vec();
    v.sort_by(|x, y| x.partial_cmp(y).unwrap());
    let n = v.len();
    if n == 0 {
        return 0.0;
    }
    if n == 1 {
        return v[0];
    }
    let idx = 0.25 * (n as f64 - 1.0);
    let lo = idx.floor() as usize;
    let frac = idx - lo as f64;
    if lo + 1 < n {
        v[lo] * (1.0 - frac) + v[lo + 1] * frac
    } else {
        v[lo]
    }
}

// --- LAPACK via ndarray-linalg ---------------------------------------------

/// `np.linalg.svd(m, full_matrices=False)` for an (n,3) row matrix via LAPACK
/// dgesdd (`SVDDC`, JobSvd::Some == economy). Returns (singular values desc,
/// vt) — `vt` row i is numpy's `basis[i]`. None on LinAlgError (degenerate).
#[cfg(not(target_os = "macos"))]
pub fn svd_rows(m: &DMatrix<f64>) -> Option<(Vector3<f64>, Matrix3<f64>)> {
    if m.ncols() != 3 || m.nrows() < 1 {
        return None;
    }
    let mut arr = Array2::<f64>::zeros((m.nrows(), 3));
    for i in 0..m.nrows() {
        for j in 0..3 {
            arr[[i, j]] = m[(i, j)];
        }
    }
    let (_u, s, vt) = arr.svddc(JobSvd::Some).ok()?;
    let vt = vt?;
    let mut svals = Vector3::zeros();
    for (i, &v) in s.iter().take(3).enumerate() {
        svals[i] = v;
    }
    let mut out = Matrix3::zeros();
    for i in 0..vt.shape()[0].min(3) {
        for j in 0..3 {
            out[(i, j)] = vt[[i, j]];
        }
    }
    Some((svals, out))
}

/// `np.linalg.eigh(m)` for a symmetric 3x3 (UPLO='L', numpy's default).
/// Returns (eigenvalues asc, eigenvectors as columns).
#[cfg(not(target_os = "macos"))]
pub fn eigh3(m: &Matrix3<f64>) -> Option<(Vector3<f64>, Matrix3<f64>)> {
    let mut arr = Array2::<f64>::zeros((3, 3));
    for i in 0..3 {
        for j in 0..3 {
            arr[[i, j]] = m[(i, j)];
        }
    }
    let (w, v): (Array1<f64>, Array2<f64>) = arr.eigh(UPLO::Lower).ok()?;
    let mut vecs = Matrix3::zeros();
    for i in 0..3 {
        for j in 0..3 {
            vecs[(i, j)] = v[[i, j]];
        }
    }
    Some((Vector3::new(w[0], w[1], w[2]), vecs))
}

// --- macOS: Accelerate new-LAPACK (the exact library numpy >=2.0 mac wheels link) ---

#[cfg(target_os = "macos")]
mod accelerate {
    #[link(name = "Accelerate", kind = "framework")]
    extern "C" {
        #[link_name = "dgesdd$NEWLAPACK"]
        pub fn dgesdd(
            jobz: *const u8,
            m: *const i32,
            n: *const i32,
            a: *mut f64,
            lda: *const i32,
            s: *mut f64,
            u: *mut f64,
            ldu: *const i32,
            vt: *mut f64,
            ldvt: *const i32,
            work: *mut f64,
            lwork: *const i32,
            iwork: *mut i32,
            info: *mut i32,
        );
        #[link_name = "dsyevd$NEWLAPACK"]
        pub fn dsyevd(
            jobz: *const u8,
            uplo: *const u8,
            n: *const i32,
            a: *mut f64,
            lda: *const i32,
            w: *mut f64,
            work: *mut f64,
            lwork: *const i32,
            iwork: *mut i32,
            liwork: *const i32,
            info: *mut i32,
        );
        #[link_name = "cblas_dgemm$NEWLAPACK"]
        pub fn cblas_dgemm(
            layout: i32,
            transa: i32,
            transb: i32,
            m: i32,
            n: i32,
            k: i32,
            alpha: f64,
            a: *const f64,
            lda: i32,
            b: *const f64,
            ldb: i32,
            beta: f64,
            c: *mut f64,
            ldc: i32,
        );
    }
}

#[cfg(not(target_os = "macos"))]
mod openblas_cblas {
    #[link(name = "openblas")]
    extern "C" {
        pub fn cblas_dgemm(
            layout: i32,
            transa: i32,
            transb: i32,
            m: i32,
            n: i32,
            k: i32,
            alpha: f64,
            a: *const f64,
            lda: i32,
            b: *const f64,
            ldb: i32,
            beta: f64,
            c: *mut f64,
            ldc: i32,
        );
    }
}

const CBLAS_ROW_MAJOR: i32 = 101;
const CBLAS_NO_TRANS: i32 = 111;
const CBLAS_TRANS: i32 = 112;

unsafe fn dgemm(
    transa: i32,
    transb: i32,
    m: i32,
    n: i32,
    k: i32,
    a: *const f64,
    lda: i32,
    b: *const f64,
    ldb: i32,
    c: *mut f64,
    ldc: i32,
) {
    #[cfg(target_os = "macos")]
    accelerate::cblas_dgemm(
        CBLAS_ROW_MAJOR,
        transa,
        transb,
        m,
        n,
        k,
        1.0,
        a,
        lda,
        b,
        ldb,
        0.0,
        c,
        ldc,
    );
    #[cfg(not(target_os = "macos"))]
    openblas_cblas::cblas_dgemm(
        CBLAS_ROW_MAJOR,
        transa,
        transb,
        m,
        n,
        k,
        1.0,
        a,
        lda,
        b,
        ldb,
        0.0,
        c,
        ldc,
    );
}

/// numpy `a @ b` for row-major 4x4 f64 matrices (BLAS dgemm, matching
/// `parent_world @ local`). `a`, `b`, returned matrix: row-major [f64; 16].
pub fn mat4_matmul(a: &[f64; 16], b: &[f64; 16]) -> [f64; 16] {
    let mut c = [0.0f64; 16];
    unsafe {
        dgemm(
            CBLAS_NO_TRANS,
            CBLAS_NO_TRANS,
            4,
            4,
            4,
            a.as_ptr(),
            4,
            b.as_ptr(),
            4,
            c.as_mut_ptr(),
            4,
        );
    }
    c
}

/// numpy `positions @ r.T + t` (BLAS dgemm, matching `_collect_world_parts`).
/// `positions`: (n,3) row-major f64; `r`: row-major 3x3 (world[:3,:3]); `t`: world[:3,3].
pub fn transform_points(positions: &[f64], r: &[f64; 9], t: &[f64; 3]) -> Vec<f64> {
    let n = (positions.len() / 3) as i32;
    let mut out = vec![0.0f64; positions.len()];
    unsafe {
        // positions @ r.T == dgemm(NoTrans, Trans)
        dgemm(
            CBLAS_NO_TRANS,
            CBLAS_TRANS,
            n,
            3,
            3,
            positions.as_ptr(),
            3,
            r.as_ptr(),
            3,
            out.as_mut_ptr(),
            3,
        );
    }
    for chunk in out.chunks_exact_mut(3) {
        chunk[0] += t[0];
        chunk[1] += t[1];
        chunk[2] += t[2];
    }
    out
}

/// `np.linalg.svd(m, full_matrices=False)` via Accelerate dgesdd (macOS).
#[cfg(target_os = "macos")]
pub fn svd_rows(m: &DMatrix<f64>) -> Option<(Vector3<f64>, Matrix3<f64>)> {
    let n = m.nrows() as i32;
    if m.ncols() != 3 || n < 1 {
        return None;
    }
    let k = 3i32;
    let rows = m.nrows();
    let mut a = vec![0.0f64; rows * 3];
    for i in 0..rows {
        for j in 0..3 {
            a[i + j * rows] = m[(i, j)];
        }
    }
    let min_mn = n.min(3);
    let mut s = [0.0f64; 3];
    let mut u = vec![0.0f64; rows * (min_mn as usize)];
    let mut vt = vec![0.0f64; (min_mn as usize) * 3];
    let mut iwork = vec![0i32; 8 * 3];
    let mut info = 0i32;
    let jobz = b'S';
    let mut wq = [0.0f64; 1];
    let lq = -1i32;
    unsafe {
        accelerate::dgesdd(
            &jobz,
            &n,
            &k,
            a.as_mut_ptr(),
            &n,
            s.as_mut_ptr(),
            u.as_mut_ptr(),
            &n,
            vt.as_mut_ptr(),
            &min_mn,
            wq.as_mut_ptr(),
            &lq,
            iwork.as_mut_ptr(),
            &mut info,
        );
    }
    if info != 0 {
        return None;
    }
    let lwork = wq[0] as i32;
    let mut work = vec![0.0f64; lwork as usize];
    unsafe {
        accelerate::dgesdd(
            &jobz,
            &n,
            &k,
            a.as_mut_ptr(),
            &n,
            s.as_mut_ptr(),
            u.as_mut_ptr(),
            &n,
            vt.as_mut_ptr(),
            &min_mn,
            work.as_mut_ptr(),
            &lwork,
            iwork.as_mut_ptr(),
            &mut info,
        );
    }
    if info != 0 {
        return None;
    }
    let mut out = Matrix3::zeros();
    for i in 0..(min_mn as usize) {
        for j in 0..3 {
            out[(i, j)] = vt[i + j * (min_mn as usize)];
        }
    }
    Some((Vector3::new(s[0], s[1], s[2]), out))
}

/// `np.linalg.eigh` via Accelerate dsyevd (macOS).
#[cfg(target_os = "macos")]
pub fn eigh3(m: &Matrix3<f64>) -> Option<(Vector3<f64>, Matrix3<f64>)> {
    let n = 3i32;
    let mut a = [0.0f64; 9];
    for i in 0..3 {
        for j in 0..3 {
            a[i + j * 3] = m[(i, j)];
        }
    }
    let mut w = [0.0f64; 3];
    let mut info = 0i32;
    let (jobz, uplo) = (b'V', b'L');
    let mut wq = [0.0f64; 1];
    let mut iq = [0i32; 1];
    let m1 = -1i32;
    unsafe {
        accelerate::dsyevd(
            &jobz,
            &uplo,
            &n,
            a.as_mut_ptr(),
            &n,
            w.as_mut_ptr(),
            wq.as_mut_ptr(),
            &m1,
            iq.as_mut_ptr(),
            &m1,
            &mut info,
        );
    }
    if info != 0 {
        return None;
    }
    let lwork = wq[0] as i32;
    let liwork = iq[0];
    let mut work = vec![0.0f64; lwork as usize];
    let mut iwork = vec![0i32; liwork as usize];
    unsafe {
        accelerate::dsyevd(
            &jobz,
            &uplo,
            &n,
            a.as_mut_ptr(),
            &n,
            w.as_mut_ptr(),
            work.as_mut_ptr(),
            &lwork,
            iwork.as_mut_ptr(),
            &liwork,
            &mut info,
        );
    }
    if info != 0 {
        return None;
    }
    let mut vecs = Matrix3::zeros();
    for i in 0..3 {
        for j in 0..3 {
            vecs[(i, j)] = a[i + j * 3];
        }
    }
    Some((Vector3::new(w[0], w[1], w[2]), vecs))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairwise_and_stats() {
        let a: Vec<f64> = (0..1000).map(|i| (i as f64) * 0.1 + 0.01).collect();
        assert!((mean(&a) - 49.96).abs() < 1e-9);
        assert!(std(&a) > 28.0 && std(&a) < 29.0);
    }

    #[test]
    fn svd_rod_axis() {
        let mut m = DMatrix::zeros(100, 3);
        for i in 0..100 {
            m[(i, 0)] = i as f64 - 49.5;
            m[(i, 1)] = ((i % 7) as f64 - 3.0) * 0.01;
            m[(i, 2)] = ((i % 5) as f64 - 2.0) * 0.01;
        }
        let (s, vt) = svd_rows(&m).unwrap();
        assert!(s[0] > 10.0 * s[1]);
        assert!(vt[(0, 0)].abs() > 0.999);
    }

    #[test]
    fn eigh_diag() {
        let m = Matrix3::from_diagonal(&Vector3::new(1.0, 3.0, 2.0));
        let (w, v) = eigh3(&m).unwrap();
        assert!((w[0] - 1.0).abs() < 1e-12 && (w[2] - 3.0).abs() < 1e-12);
        assert!(v[(1, 2)].abs() > 0.999);
    }
}
