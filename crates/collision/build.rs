/// Resolve a library prefix deterministically: `<ENV_KEY>_PREFIX` when set,
/// else a fixed per-target default. No `brew` shell-out, so the build never
/// depends on Homebrew being installed or on PATH. Docker/CI set the `*_PREFIX`
/// envs explicitly (see apps/assembler/Dockerfile); local macOS falls back to
/// the standard Homebrew `opt` layout, Linux to the distro `/usr` layout.
fn prefix(pkg: &str, env_key: &str) -> String {
    if let Ok(p) = std::env::var(format!("{env_key}_PREFIX")) {
        if !p.is_empty() {
            return p;
        }
    }
    // CARGO_CFG_TARGET_* are always set for build scripts — the target we build
    // for, so the default matches where its headers/libs live.
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    match os.as_str() {
        "macos" if arch == "aarch64" => format!("/opt/homebrew/opt/{pkg}"),
        "macos" => format!("/usr/local/opt/{pkg}"),
        _ => "/usr".to_string(),
    }
}

/// Link `lib` from `prefix`, statically when a `.a` is present there, else
/// dynamically. Static keeps the archive's code in the binary (no runtime .so).
fn link_lib(prefix: &str, lib: &str) {
    let static_archive = ["lib", "lib/x86_64-linux-gnu"]
        .iter()
        .any(|sub| std::path::Path::new(&format!("{prefix}/{sub}/lib{lib}.a")).exists());
    let kind = if static_archive { "static" } else { "dylib" };
    println!("cargo:rustc-link-lib={kind}={lib}");
}

fn main() {
    let fcl = prefix("fcl", "FCL");
    let ccd = prefix("libccd", "LIBCCD");
    let eigen = prefix("eigen", "EIGEN");
    let octomap = prefix("octomap", "OCTOMAP");

    let mut build = cxx_build::bridge("src/lib.rs");
    build
        .file("src/shim.cc")
        // C++17 is load-bearing on x86: with AVX (x86-64-v3 below) Eigen's
        // fixed-size types are alignas(32), and pre-17 `new` ignores
        // over-alignment — heap-allocated FCL structures then trip Eigen's
        // "data is not aligned" assert (SIGABRT in prod Lambda). C++17
        // aligned-new allocates them correctly; the FCL .a is built C++17 in
        // the Dockerfile for the same reason.
        .std("c++17")
        .include(format!("{fcl}/include"))
        .include(format!("{ccd}/include"))
        .include(format!("{eigen}/include/eigen3"))
        .include(format!("{octomap}/include"))
        .warnings(false);
    // The hot path is here: FCL's OBBRSS BVH + Eigen math are header-only
    // templates instantiated in this shim, so its SIMD baseline — not the FCL
    // .a's — governs their vectorization. On x86_64 deploy targets raise it to
    // AVX2+FMA (x86-64-v3); a conservative fleet baseline, not target-cpu=native
    // (which would SIGILL on older CPUs). Other arches (macOS/arm) keep NEON.
    // FMA shifts FP rounding by ~1 ULP — the calibration fixture's 1e-6 rounding
    // is built to absorb exactly that, but CI must confirm `cargo test -p
    // collision --test calibration` on the x86_64 build.
    if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("x86_64") {
        build.flag_if_supported("-march=x86-64-v3");
    }
    build.compile("carbon_fcl_shim");

    for p in [&fcl, &ccd] {
        println!("cargo:rustc-link-search=native={p}/lib");
        println!("cargo:rustc-link-search=native={p}/lib/x86_64-linux-gnu");
    }
    // Prefer a static archive when the prefix ships one (the deployment build
    // installs libfcl.a/libccd.a → a self-contained binary with no FCL runtime
    // .so); fall back to dynamic where only a shared lib exists (macOS/brew dev).
    // FCL depends on ccd, so fcl must be listed before ccd for the static link.
    link_lib(&fcl, "fcl");
    link_lib(&ccd, "ccd");

    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=src/shim.cc");
    println!("cargo:rerun-if-changed=src/shim.h");
    // Rebuild when a prefix override changes (dynamic ↔ static, moved libs).
    for k in ["FCL_PREFIX", "LIBCCD_PREFIX", "EIGEN_PREFIX", "OCTOMAP_PREFIX"] {
        println!("cargo:rerun-if-env-changed={k}");
    }
}
