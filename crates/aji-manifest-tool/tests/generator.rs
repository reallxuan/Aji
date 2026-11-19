use std::collections::BTreeMap;
use std::path::PathBuf;

use aji_manager::manifest::{
    Backend, Digest, Engine, Manifest, Network, NetworkKind, Platform, parse_manifest,
};
use aji_manifest_tool::generate::{Options, generate};
use aji_manifest_tool::networks::{self, Head};
use aji_manifest_tool::releases::{self, Source};

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

fn text(name: &str) -> String {
    std::fs::read_to_string(fixture(name)).unwrap()
}

fn katago() -> Vec<Engine> {
    releases::engines(&text("katago-releases.json"), Source::KataGo).unwrap()
}

fn heads() -> Vec<Head> {
    networks::heads_from_json(&text("network-heads.json")).unwrap()
}

fn all_networks() -> Vec<Network> {
    networks::networks(&text("networks.html"), &heads()).unwrap()
}

fn options(out: PathBuf) -> Options {
    Options {
        out: Some(out),
        sequence: Some(1763500000),
        katago_releases: Some(fixture("katago-releases.json")),
        metal_releases: Some(fixture("metal-releases.json")),
        networks_page: Some(fixture("networks.html")),
        network_heads: Some(fixture("network-heads.json")),
        nvidia_dir: Some(fixture("")),
        licence_texts: Some(fixture("licence-text.txt")),
    }
}

async fn generated() -> Manifest {
    let dir = tempdir("gen");
    let bytes = generate(&options(dir.join("m.json"))).await.unwrap();
    parse_manifest(&bytes).unwrap()
}

fn tempdir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("aji-manifest-tool-{tag}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn of<'a>(engines: &'a [Engine], version: &str, platform: Platform) -> Vec<&'a Engine> {
    engines
        .iter()
        .filter(|e| e.version.to_string() == version && e.platform == platform)
        .collect()
}

#[test]
fn allow_list_windows_1_18_1() {
    let engines = katago();
    let win = of(&engines, "1.18.1", Platform::WindowsX64);
    assert_eq!(
        win.len(),
        11,
        "{:#?}",
        win.iter().map(|e| &e.id).collect::<Vec<_>>()
    );
    let count = |b: Backend| win.iter().filter(|e| e.backend == b).count();
    assert_eq!(count(Backend::Cuda), 2);
    assert_eq!(count(Backend::Directml), 1);
    assert_eq!(count(Backend::Openvino), 1);
    assert_eq!(count(Backend::Rocm), 4);
    assert_eq!(count(Backend::Opencl), 1);
    assert_eq!(count(Backend::Eigenavx2), 1);
    assert_eq!(count(Backend::Eigen), 1);
    let provider = |b: Backend| {
        win.iter()
            .find(|e| e.backend == b)
            .unwrap()
            .config
            .get("onnxProvider")
            .cloned()
    };
    assert_eq!(provider(Backend::Directml).as_deref(), Some("directml"));
    assert_eq!(provider(Backend::Openvino).as_deref(), Some("openvino"));
    let mut families: Vec<_> = win
        .iter()
        .filter(|e| e.backend == Backend::Rocm)
        .map(|e| e.gpu_family.clone().unwrap())
        .collect();
    families.sort();
    assert_eq!(families, ["gfx103X", "gfx110X", "gfx1151", "gfx120X"]);
}

#[test]
fn allow_list_linux_1_18_1() {
    let engines = katago();
    let mut backends: Vec<_> = of(&engines, "1.18.1", Platform::LinuxX64)
        .iter()
        .map(|e| format!("{:?}", e.backend))
        .collect();
    backends.sort();
    assert_eq!(backends, ["Eigen", "Eigenavx2", "Opencl"]);
}

#[test]
fn no_bs50_or_cudnn8_or_tensorrt() {
    for e in katago() {
        assert!(
            !e.id.contains("+bs50") && !e.id.contains("cudnn8.9.7") && !e.id.contains("trt"),
            "{}",
            e.id
        );
    }
}

#[test]
fn engine_uses_the_github_digest() {
    let engines = katago();
    let e = engines
        .iter()
        .find(|e| e.id == "katago-v1.18.2-cuda13.2-cudnn9.24.0-windows-x64")
        .unwrap();
    assert_eq!(e.file.size, 9825374);
    assert_eq!(
        e.file.digest,
        Digest::Sha256("4b26f1889bed56b91964aa565f324eeab816e77f2ee79197be04f7291a2e7514".into())
    );
    assert_eq!(
        e.file.urls,
        [
            "https://github.com/lightvector/KataGo/releases/download/v1.18.2/katago-v1.18.2-cuda13.2-cudnn9.24.0-windows-x64.zip"
        ]
    );
    assert_eq!(e.released, "2026-08-30");
    assert_eq!(
        e.runtime.as_deref(),
        Some("nvidia-cuda13.2-cudnn9.24.0-windows-x64")
    );
}

#[test]
fn versions_start_at_1_17_0() {
    let mut releases_json: serde_json::Value =
        serde_json::from_str(&text("katago-releases.json")).unwrap();
    releases_json.as_array_mut().unwrap().push(serde_json::json!({
        "tag_name": "v1.9.0",
        "published_at": "2021-01-01T00:00:00Z",
        "assets": [{
            "name": "katago-v1.9.0-opencl-windows-x64.zip",
            "size": 1000,
            "digest": format!("sha256:{}", "a".repeat(64)),
            "browser_download_url": "https://github.com/lightvector/KataGo/releases/download/v1.9.0/katago-v1.9.0-opencl-windows-x64.zip"
        }]
    }));
    let engines = releases::engines(&releases_json.to_string(), Source::KataGo).unwrap();
    assert!(engines.iter().all(|e| e.version.to_string() != "1.9.0"));
    assert!(engines.iter().any(|e| e.version.to_string() == "1.17.0"));
}

#[test]
fn metal_engine_from_aji_manifest_releases() {
    let engines = releases::engines(&text("metal-releases.json"), Source::Metal).unwrap();
    assert_eq!(engines.len(), 1);
    let e = &engines[0];
    assert_eq!(e.id, "katago-v1.18.2-metal-macos-arm64");
    assert_eq!(
        (e.platform, e.backend, e.variant.as_str()),
        (Platform::MacosArm64, Backend::Metal, "metal")
    );
    assert_eq!(e.runtime, None);
    assert_eq!(e.released, "2026-08-31");
}

fn main_networks() -> Vec<Network> {
    all_networks()
        .into_iter()
        .filter(|n| n.kind == NetworkKind::Main)
        .collect()
}

#[test]
fn network_list_matches_the_page() {
    let got: Vec<_> = main_networks()
        .iter()
        .map(|n| {
            (
                n.id.clone(),
                n.elo.unwrap(),
                n.elo_games.unwrap(),
                n.uploaded.clone(),
            )
        })
        .collect();
    let want = [
        (
            "kata1-tf3-b11c768-s12382M-d6533M",
            14639.0,
            2833,
            "2026-11-01",
        ),
        (
            "kata1-zhizi-b40c768nbt-s11272M-d5935M",
            14523.8,
            7194,
            "2026-06-06",
        ),
        (
            "kata1-tf3-b10c512-s3203M-d5937M",
            14175.1,
            4318,
            "2026-08-25",
        ),
        (
            "kata1-zhizi-b28c512nbt-muonfd2",
            14164.6,
            5062,
            "2026-03-22",
        ),
        (
            "kata1-b28c512nbt-s13255194368-d5935380940",
            14111.3,
            4315,
            "2026-06-07",
        ),
        (
            "kata1-tf2-b10c384-s2941M-d5872M",
            13715.8,
            4072,
            "2026-08-25",
        ),
        (
            "kata1-b18c384nbt-s9996604416-d4316597426",
            13629.0,
            3991,
            "2024-05-26",
        ),
        (
            "kata1-b60c320-s9356080896-d3824355768",
            13557.6,
            3220,
            "2023-11-17",
        ),
    ];
    let want: Vec<_> = want
        .iter()
        .map(|(a, b, c, d)| (a.to_string(), *b, *c, d.to_string()))
        .collect();
    assert_eq!(got, want);
    let sizes: Vec<_> = main_networks().iter().map(|n| n.file.size).collect();
    assert_eq!(
        sizes,
        [
            262041254, 863210287, 94281753, 271447864, 271440852, 38245507, 97898094, 403507095
        ]
    );
}

fn by_id(id: &str) -> Network {
    all_networks().into_iter().find(|n| n.id == id).unwrap()
}

#[test]
fn network_digest_from_etag() {
    let n = by_id("kata1-tf3-b11c768-s12382M-d6533M");
    assert_eq!(
        n.file.digest,
        Digest::Md5("db954878202524766e2f75ac61ae34c3".into())
    );
    assert_eq!(n.file.size, 262041254);
}

fn with_etag(etag: &str) -> Result<Vec<Network>, String> {
    let mut heads = heads();
    heads
        .iter_mut()
        .find(|h| h.url.contains("kata1-tf3-b10c512-s3203M-d5937M"))
        .unwrap()
        .etag = etag.into();
    networks::networks(&text("networks.html"), &heads)
}

#[test]
fn a_multipart_etag_fails() {
    let err = with_etag("\"56d884632364106ca7f99ba428b468b6-232\"").unwrap_err();
    assert!(err.contains("kata1-tf3-b10c512-s3203M-d5937M"), "{err}");
    let err = with_etag("W/\"991c1e06764931ef797ad3098675b981\"").unwrap_err();
    assert!(err.contains("kata1-tf3-b10c512-s3203M-d5937M"), "{err}");
}

#[test]
fn transformers_need_1_17() {
    let min = |id: &str| by_id(id).min_engine_version.map(|v| v.to_string());
    assert_eq!(
        min("kata1-tf3-b11c768-s12382M-d6533M").as_deref(),
        Some("1.17.0")
    );
    assert_eq!(
        min("kata1-tf2-b10c384-s2941M-d5872M").as_deref(),
        Some("1.17.0")
    );
    assert_eq!(min("kata1-zhizi-b40c768nbt-s11272M-d5935M"), None);
    assert_eq!(min("kata1-b60c320-s9356080896-d3824355768"), None);
}

#[test]
fn human_sl_network_is_listed() {
    let n = by_id("b18c384nbt-humanv0");
    assert_eq!(n.kind, NetworkKind::HumanSl);
    assert_eq!(n.elo, None);
    assert_eq!(
        n.file.digest,
        Digest::Md5("dc7ce241411b05ef2a5416d6406313a4".into())
    );
    assert_eq!(n.file.size, 99066230);
    assert_eq!(n.uploaded, "2025-04-22");
    assert_eq!(
        n.file.urls,
        [
            "https://media.katagotraining.org/uploaded/networks/models_extra/b18c384nbt-humanv0.bin.gz"
        ]
    );
}

#[tokio::test]
async fn nvidia_sets_from_redist() {
    let m = generated().await;
    let set = |id: &str| m.runtimes.iter().find(|r| r.id == id).unwrap();
    let r13 = set("nvidia-cuda13.2-cudnn9.24.0-windows-x64");
    assert_eq!(
        r13.components
            .iter()
            .map(|c| c.archive.size)
            .collect::<Vec<_>>(),
        [388113288, 288218786, 1274017601]
    );
    assert_eq!(
        r13.components[0].archive.digest,
        Digest::Sha256("bc6f590490134f4dbe29672b72e536c44362cc5f738a0f7e48c8c3c141e9b24a".into())
    );
    assert!(
        r13.components[2]
            .archive
            .path
            .ends_with("_cuda13-archive.zip")
    );
    assert_eq!(r13.min_driver.as_deref(), Some("580.00"));
    assert_eq!(r13.min_compute_capability.as_deref(), Some("7.5"));
    assert_eq!(
        r13.components[0].extract,
        ["cublas64_13.dll", "cublasLt64_13.dll"]
    );
    assert_eq!(
        r13.components[0].archive.path,
        "compute/cuda/redist/libcublas/windows-x86_64/libcublas-windows-x86_64-13.4.1.3-archive.zip"
    );
    assert_eq!(
        r13.notice.lines().next().unwrap(),
        "NVIDIA CUDA cuBLAS 13.4.1.3, \u{a9} NVIDIA Corporation. Licensed under the NVIDIA CUDA Toolkit EULA. Not covered by Aji's AGPL licence."
    );
    assert_eq!(r13.notice.lines().count(), 3);
    let r12 = set("nvidia-cuda12.8-cudnn9.8.0-windows-x64");
    let total: u64 = r12.components.iter().map(|c| c.archive.size).sum();
    assert_eq!(total, 1544599496);
    assert_eq!(r12.min_driver.as_deref(), Some("572.61"));
    assert_eq!(r12.min_compute_capability.as_deref(), Some("5.0"));
}

#[tokio::test]
async fn licence_text_is_hashed() {
    let want = aji_manifest_tool::sha256_hex(&std::fs::read(fixture("licence-text.txt")).unwrap());
    let m = generated().await;
    let mut n = 0;
    for r in &m.runtimes {
        for c in &r.components {
            assert_eq!(c.licence.text_sha256, want);
            n += 1;
        }
    }
    assert_eq!(n, 6);
}

#[tokio::test]
async fn generate_is_deterministic() {
    let dir = tempdir("det");
    let a = generate(&options(dir.join("a.json"))).await.unwrap();
    let b = generate(&options(dir.join("b.json"))).await.unwrap();
    assert_eq!(a, b);
    let v: serde_json::Value = serde_json::from_slice(&a).unwrap();
    assert_eq!(v["generated"], "2025-11-18T21:06:40Z");
}

#[tokio::test]
async fn generated_manifest_parses() {
    let m = generated().await;
    assert_eq!(m.sequence, 1763500000);
    assert!(m.engines.iter().any(|e| e.backend == Backend::Metal));
    assert_eq!(m.runtimes.len(), 2);
    assert_eq!(m.networks.len(), 9);
    let ids: BTreeMap<_, _> = m.engines.iter().map(|e| (&e.id, ())).collect();
    assert_eq!(ids.len(), m.engines.len());
}

#[test]
fn an_empty_or_garbled_networks_page_fails() {
    for page in [
        "",
        "<html><body><table></table></body></html>",
        "not html at all",
    ] {
        assert!(networks::networks(page, &heads()).is_err(), "{page:?}");
        assert!(networks::head_urls(page).is_err(), "{page:?}");
    }
}

#[test]
fn a_page_with_too_few_networks_fails() {
    let page = text("networks.html");
    let start = page.find("<tr class=\"normalNetworkStyle\">").unwrap();
    // Keep the header and the first row only.
    let end = page[start..].find("</tr>").unwrap() + start + 5;
    let head = &page[..start];
    let tail = &page[page.rfind("</table>").unwrap()..];
    let small = format!("{head}{}{tail}", &page[start..end]);
    assert!(networks::networks(&small, &heads()).is_err());
}

#[test]
fn a_linked_row_with_an_unknown_family_fails() {
    let row = r#"<tr class="normalNetworkStyle"><td> kata1-weirdname </td><td> 2026-01-01 00:00:00 UTC </td><td> 1000.0 ± 10.0 - (5,000 games) </td><td><a href="https://media.katagotraining.org/x.bin.gz">[Download]</a></td></tr>"#;
    let page = text("networks.html").replacen(
        "<tr class=\"normalNetworkStyle\">",
        &format!("{row}<tr class=\"normalNetworkStyle\">"),
        1,
    );
    let err = networks::networks(&page, &heads()).unwrap_err();
    assert!(err.contains("kata1-weirdname"), "{err}");
}

#[test]
fn a_release_list_without_allow_listed_engines_fails() {
    assert!(releases::engines("[]", Source::KataGo).is_err());
    let only_other = r#"[{"tag_name":"v1.18.2","published_at":"2026-08-30T01:54:00Z","assets":[{"name":"katago-v1.18.2-trt10.2-windows-x64.zip","size":1,"digest":"sha256:4b26f1889bed56b91964aa565f324eeab816e77f2ee79197be04f7291a2e7514","browser_download_url":"https://example.com/a.zip"}]}]"#;
    assert!(releases::engines(only_other, Source::KataGo).is_err());
    // An empty Metal list parses, but `generate` refuses it (see below).
    assert!(releases::engines("[]", Source::Metal).unwrap().is_empty());
}

#[tokio::test]
async fn generate_creates_a_missing_output_folder() {
    // The caller (main) creates the folder; here we check the generated bytes are written there.
    let dir = tempdir("nested").join("site").join("v1");
    let _ = std::fs::remove_dir_all(dir.parent().unwrap());
    let bytes = generate(&options(dir.join("manifest.json"))).await.unwrap();
    aji_manifest_tool::write_output(&dir.join("manifest.json"), &bytes).unwrap();
    assert_eq!(std::fs::read(dir.join("manifest.json")).unwrap(), bytes);
}

#[tokio::test]
async fn an_empty_metal_list_fails_and_names_macos_metal() {
    let dir = tempdir("nometal");
    let empty = dir.join("empty.json");
    std::fs::write(&empty, "[]").unwrap();
    let mut o = options(dir.join("m.json"));
    o.metal_releases = Some(empty);
    let err = generate(&o).await.unwrap_err();
    assert!(err.contains("macos-arm64 metal"), "{err}");
}

#[tokio::test]
async fn a_katago_list_without_linux_eigen_fails() {
    let dir = tempdir("noeigen");
    let list = text("katago-releases.json");
    let mut v: serde_json::Value = serde_json::from_str(&list).unwrap();
    for r in v.as_array_mut().unwrap() {
        r["assets"].as_array_mut().unwrap().retain(|a| {
            !a["name"]
                .as_str()
                .unwrap()
                .ends_with("-eigen-linux-x64.zip")
        });
    }
    let path = dir.join("katago.json");
    std::fs::write(&path, serde_json::to_string(&v).unwrap()).unwrap();
    let mut o = options(dir.join("m.json"));
    o.katago_releases = Some(path);
    let err = generate(&o).await.unwrap_err();
    assert!(err.contains("linux-x64 eigen"), "{err}");
}

#[test]
fn licence_hash_covers_raw_bytes() {
    // A BOM and a non-UTF-8 byte must survive into the hash, which `Response::text()` would not.
    let raw = b"\xef\xbb\xbf\xa9 NVIDIA\xff";
    assert_ne!(
        aji_manifest_tool::sha256_hex(raw),
        aji_manifest_tool::sha256_hex(String::from_utf8_lossy(raw).as_bytes())
    );
}
