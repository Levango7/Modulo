//! `client` 的真子进程用例（F4c-2 补强）。单独成文件是因为 `client.rs` 已贴着
//! 「单文件 ≤300 行」的纪律，四条用例塞进去会越线；`#[path]` 声明让它仍挂在
//! `client::tests` 下，能直接摸到私有的 `session_for` 与 `McpState`。
//!
//! 全部跑真 node 子进程（`tests/fixtures/fake-mcp-server.js`），不用 mock：这里要验的
//! 就是 spawn / 管道 / EOF / 超时 kill 本身。假 server 的路径用 `CARGO_MANIFEST_DIR`
//! 拼绝对路径，不依赖 cwd。
//!
//! 用 `#[test]` + 自建 runtime，而不是 `#[tokio::test]`。
//!
//! **理由已经变了，记在这里免得后来人照抄一段过期解释**：2026-11-18 之前 `docs-check`
//! 只认字面 `#[test]`，写 `#[tokio::test]` 就是「cargo 数得到、脚本数不到」，facts 行只能
//! 写假数 —— 那时不用它**是被门禁口径逼的**。现在 `countRustTests` 两种写法都认，
//! 这条约束已经解除；仍然按老写法写，纯粹因为这里的用例都是 `block_on(...)` 串行跑，
//! 多一个 async 属性只会让「哪条用例占了多久」更难看清，而计数口径不再是理由了。

use std::future::Future;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde_json::json;

use super::{confirm_in, is_confirmed, session_for, shape_call, McpState};
use crate::ai::mcp::pure::{self, ServerCfg};
use crate::ai::mcp::views::parse_call_tool_result;
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

/// 顺序复用：与上面的并发用例互补 —— 那条测「同一时刻抢同一槽位」，这条测「前后三次
/// 调用拿到同一条会话、没有悄悄再起进程」。
#[test]
fn 顺序重复_session_for_只起一个子进程() {
    block_on(async {
        let counter = counter_path("seq");
        let c = cfg(&format!("counter={}", counter.to_string_lossy()));
        let state = McpState::default();
        let a = session_for(&state, &c).await.expect("第一次取会话应当成功");
        let b = session_for(&state, &c).await.expect("第二次取会话应当成功");
        let d = session_for(&state, &c).await.expect("第三次取会话应当成功");
        assert!(
            Arc::ptr_eq(&a, &b) && Arc::ptr_eq(&b, &d),
            "顺序三次调用应当拿到同一条会话"
        );
        let lines = std::fs::read_to_string(&counter).expect("假 server 应当写下 initialize 次数");
        assert_eq!(
            lines.lines().count(),
            1,
            "顺序复用时重复起了子进程（counter 文件多于一行）"
        );
        let _ = std::fs::remove_file(&counter);
    })
}

/// 幂等来自 `HashSet::insert`：同一个 id 记三次和记一次的状态完全相同。这里测的是
/// `mcp_confirm` 的状态部分（`confirm_in`，见 client.rs），不为一个 HashSet 起 Tauri 应用。
#[test]
fn mcp_confirm_重复调用幂等() {
    let state = McpState::default();
    assert!(!is_confirmed(&state, "s1"), "默认全部未确认");
    for i in 1..=3 {
        confirm_in(&state, "s1").unwrap_or_else(|e| panic!("第 {i} 次确认应当成功：{e}"));
    }
    assert!(is_confirmed(&state, "s1"), "三次确认之后必须是已确认");
    assert!(
        confirm_in(&state, "s1").is_ok(),
        "第四次确认仍然 Ok —— HashSet insert 幂等"
    );
}

/// 同参数连调两次，只比稳定字段（text / isError / truncated / notice）：JSON-RPC 的 id
/// 每次都不同，拿它比就会把「两次真的各跑了一轮」误判成不一致。
#[test]
fn 同参数_mcp_call_连续两次结果一致() {
    block_on(async {
        let c = cfg("ok");
        let state = McpState::default();
        let slot = session_for(&state, &c).await.expect("取会话应当成功");
        let mut s = slot.lock().await;
        let params = pure::call_params("ping", Some(json!({ "x": 1 })));
        let mut outs = Vec::new();
        for i in 1..=2 {
            let v = s
                .request("tools/call", Some(params.clone()))
                .await
                .unwrap_or_else(|e| panic!("第 {i} 次 tools/call 应当成功：{e}"));
            let r = parse_call_tool_result(&v)
                .unwrap_or_else(|e| panic!("第 {i} 次结果形状应当合法：{e}"));
            outs.push(shape_call(r));
        }
        assert_eq!(outs[0].text, "ok", "第一次的正文应当是假 server 的固定值");
        assert_eq!(outs[1].text, "ok", "第二次的正文应当与第一次相同");
        assert_eq!(outs[0].is_error, outs[1].is_error, "isError 两次应当一致");
        assert!(!outs[0].is_error, "假 server 回的是正常结果，不是工具失败");
        assert_eq!(outs[0].truncated, outs[1].truncated, "截断标记两次应当一致");
        assert_eq!(outs[0].notice, outs[1].notice, "提示文案两次应当一致");
    })
}
