//! `client` 的真子进程用例（F4c-2 补强）。单独成文件是因为 `client.rs` 已贴着
//! 「单文件 ≤300 行」的纪律，四条用例塞进去会越线；`#[path]` 声明让它仍挂在
//! `client::tests` 下，能直接摸到私有的 `session_for` 与 `McpState`。
//!
//! 全部跑真 node 子进程（`tests/fixtures/fake-mcp-server.js`），不用 mock：这里要验的
//! 就是 spawn / 管道 / EOF / 超时 kill 本身。假 server 的路径用 `CARGO_MANIFEST_DIR`
//! 拼绝对路径，不依赖 cwd。
//!
//! 用 `#[test]` + 自建 runtime，而不是 `#[tokio::test]`：`docs-check.mjs` 数 Rust 单测
//! 的口径是字面 `#[test]`（`scripts/docs-check.mjs:241`），`#[tokio::test]` 它看不见 ——
//! 两边一错位，facts 行要么写假数、要么永远对不上。手搭 runtime 只多三行，计数口径一致。

use std::future::Future;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use super::{session_for, McpState};
use crate::ai::mcp::pure::ServerCfg;
use crate::ai::mcp::wire::Session;

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/fake-mcp-server.js"
);

fn cfg(mode: &str) -> ServerCfg {
    ServerCfg {
        id: "s1".to_string(),
        name: "假服务".to_string(),
        command: "node".to_string(),
        args: vec![FIXTURE.to_string(), format!("--mode={mode}")],
        enabled: true,
    }
}

/// 每个用例一个多线程 runtime：`hang` 那条到点后要 `kill` + `wait`（几毫秒），
/// 用多线程 flavor 不必担心把唯一的 worker 占住。
fn block_on<F: Future>(f: F) -> F::Output {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("测试 runtime 应当能起来")
        .block_on(f)
}

/// 每次先删掉旧文件：同一个测试重复跑时计数不会累加。
fn counter_path(tag: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!(
        "modulo-f4c2-counter-{}-{tag}.log",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&p);
    p
}

/// 并发调用同一服务必须复用同一条会话。**第一版这里会是 2**：那时「取表 → 释放锁 →
/// spawn → 再写回」不是原子的，两个调用各起一个进程、后写的覆盖前者。
#[test]
fn 并发调用同一服务只起一个子进程() {
    block_on(async {
        let counter = counter_path("dup");
        let c = cfg(&format!("counter={}", counter.to_string_lossy()));
        let state = McpState::default();

        let (a, b) = tokio::join!(session_for(&state, &c), session_for(&state, &c));
        let a = a.expect("第一次取会话应当成功");
        let b = b.expect("第二次取会话应当成功");
        assert!(Arc::ptr_eq(&a, &b), "并发调用应当拿到同一条会话");

        let lines = std::fs::read_to_string(&counter).expect("假 server 应当写下 initialize 次数");
        assert_eq!(
            lines.lines().count(),
            1,
            "同一个服务被起了多个子进程（槽位串行没生效）"
        );
        let _ = std::fs::remove_file(&counter);
    })
}

#[test]
fn 服务进程退出时报_eof() {
    block_on(async {
        let c = cfg("eof");
        let mut s = Session::spawn(&c).expect("进程应当能起来");
        let err = s
            .ensure_ready()
            .await
            .expect_err("读到 initialize 就退出的服务不可能握手成功");
        assert!(
            err.contains("关掉了 stdout"),
            "错误里应当说明 stdout 被关：{err}"
        );
    })
}

/// 超时 = 这个会话废了：`kill` + `wait` 收尸、phase 置 Failed。重建判据靠 phase，
/// 所以这里同时断言 `is_failed()` 与 `alive() == false`。
#[test]
fn 超时会杀进程并把会话判死() {
    block_on(async {
        let c = cfg("hang");
        let mut s =
            Session::spawn_with_timeout(&c, Duration::from_millis(200)).expect("进程应当能起来");
        let err = s.ensure_ready().await.expect_err("不回话的服务应当超时");
        assert!(err.contains("没回话"), "错误里应当说明超时：{err}");
        assert!(s.is_failed(), "超时之后会话必须判死（重建判据靠 phase）");
        assert!(!s.alive(), "超时之后进程必须已被收尸（不留僵尸）");
    })
}

#[test]
fn 非_json_帧报数据不合法() {
    block_on(async {
        let c = cfg("garbage");
        let mut s = Session::spawn(&c).expect("进程应当能起来");
        let err = s
            .ensure_ready()
            .await
            .expect_err("非 JSON 帧不可能握手成功");
        assert!(err.contains("不合法"), "错误里应当说明数据不合法：{err}");
    })
}
