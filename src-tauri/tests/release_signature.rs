//! 发布门禁：用**插件同一套实现**（`minisign-verify` —— `tauri-plugin-updater` 的依赖）验一遍
//! 发版产物的更新签名，并念出签名里的版本绑定。
//!
//! 为什么要有它：`desktop:probe` 证明"应用能跑"，本地假端点那次端到端证明"更新链路能跑"，
//! 但**没人验过"我要发出去的这颗包，签名对得上应用里内嵌的那把公钥"** —— 而这一条错了，
//! 用户点「下载更新」就会在验签那步被拒，且只有他们看得见。这个测试就是补这一条。
//!
//! 默认 `#[ignore]`：CI 上没有产物（也不该为了它去构建安装包），与本机探针同一性质的门禁 ——
//! 发布前在本机跑：
//!
//! ```text
//! set TAURI_SIGNING_PRIVATE_KEY=%USERPROFILE%\.modulo\modulo-updater.key
//! npm run tauri:build
//! cd src-tauri && cargo test --test release_signature -- --ignored
//! ```
//!
//! 判定口径与 `tauri-plugin-updater` 的 `verify_signature()` 逐行对应：
//! 公钥/签名都先 base64 解码成 minisign 文本，再 `decode` → `verify`。

use std::fs;
use std::path::PathBuf;

use base64::Engine as _;

#[test]
#[ignore = "发布门禁：需要先构建带签名的安装包（设 TAURI_SIGNING_PRIVATE_KEY 后跑 npm run tauri:build）"]
fn release_installer_signature_matches_embedded_pubkey() {
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri 应该在仓库根下")
        .to_path_buf();
    let conf: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(repo.join("src-tauri/tauri.conf.json")).expect("读不到 tauri.conf.json"),
    )
    .expect("tauri.conf.json 不是 JSON");
    let pubkey_b64 = conf["plugins"]["updater"]["pubkey"]
        .as_str()
        .expect("tauri.conf.json 里没有 plugins.updater.pubkey")
        .to_string();

    let version = env!("CARGO_PKG_VERSION");
    let name = format!("Modulo_{version}_x64-setup.exe");
    let installer = repo.join("src-tauri/target/release/bundle/nsis").join(&name);
    let sig_path = repo
        .join("src-tauri/target/release/bundle/nsis")
        .join(format!("{name}.sig"));

    let artifact = fs::read(&installer)
        .unwrap_or_else(|e| panic!("读不到安装包 {}：{e}（先带签名环境变量构建）", installer.display()));
    let sig_b64 = fs::read_to_string(&sig_path)
        .unwrap_or_else(|e| panic!("读不到 {}：{e}", sig_path.display()));

    // base64 → minisign 文本。两步与插件一致，少一步都会 decode 失败。
    let decode = |b64: &str| -> String {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64.trim())
            .expect("base64 解码失败");
        String::from_utf8(bytes).expect("不是 UTF-8 的 minisign 文本")
    };

    let public_key = minisign_verify::PublicKey::decode(&decode(&pubkey_b64)).expect("公钥 decode 失败");
    let signature = minisign_verify::Signature::decode(&decode(&sig_b64)).expect("签名 decode 失败");
    public_key
        .verify(artifact.as_slice(), &signature, true)
        .expect("签名验证失败 —— 这个包客户端会拒收，绝不能发");

    // requireSignedVersion 依赖的是"受信任注释里的版本"，而它由全局签名覆盖 ——
    // verify() 通过之后读它才有意义（插件源码里也写着这句）。
    let comment = signature.trusted_comment();
    assert!(
        comment.contains(&format!("version:{version}")),
        "签名里没有 version:{version} 绑定（应用开着 requireSignedVersion，会拒收）: {comment}"
    );
    println!("✓ {name} 的更新签名验证通过；版本绑定: {comment}");
}
