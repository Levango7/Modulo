//! MCP 的**线**这一层（F4c-2 第一笔拆出）：一个子进程会话 + 一次 JSON-RPC 往返。
//!
//! `std::process::Child` + 专用线程 `read_until(b'\n')` + `tokio::sync::mpsc` 递行：
//! `Cargo.toml` 的 tokio 只开了 `sync` / `time` / `macros`，没有 `process` / `io-util`，
//! `tokio::process` 用不了，也不为本笔引新 crate。分帧复用 F4b 的 [`LineReader`]
//! （半包保留、超 1 MiB 报错），超时复用现有 `tokio::time::timeout`。
//!
//! 这里只管「怎么把一条请求发出去、把它的响应等回来」，**不读配置、不做确认判定**
//! （那是 `super::pure` 的事），也不记进程表（那是 `super::client` 的事）。

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::time::Duration;

use serde_json::Value;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};

use crate::net_policy;

use super::protocol::{decode_line, encode_line, LineReader};
use super::pure::ServerCfg;
use super::state::{initialize_request, on_incoming, on_outgoing, Phase};
use super::types::{describe_rpc_error, label_incoming, Id, Incoming, Outgoing};

/// 一个子进程会话。一个 `enabled` 服务一个（J2），首次真正调用时才起，之后复用。
pub(super) struct Session {
    child: Child,
    stdin: ChildStdin,
    rx: UnboundedReceiver<Result<String, String>>,
    lines: LineReader,
    phase: Phase,
    next_id: i64,
    /// 一次往返的墙钟上限。生产路径由 [`Self::spawn`] 从单源 `mcpCallMs` 取；测试用
    /// [`Self::spawn_with_timeout`] 注入短值 —— 否则超时分支要真等 30 秒才测得到。
    timeout: Duration,
}

impl Drop for Session {
    fn drop(&mut self) {
        // Windows 没有 SIGTERM 这一档：`TerminateProcess` 之后再 `wait` 收尸。不写假的
        // 「优雅关闭」—— 对用户可验证的结果是「进程一定不会留在后台」。
        let _ = self.stdin.flush();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Session {
    /// 起进程 + 起读线程 + 把 `initialize` 写出去（同步）。等回话在 [`Self::ensure_ready`]。
    /// 生产路径：超时取单源 `mcpCallMs`，`scripts/net-policy-check.mjs` 的 `wired` 断言钉着
    /// 这一行的注入，另一条钉 [`Self::recv_matching`] 真用 `self.timeout` 计时。
    pub(super) fn spawn(cfg: &ServerCfg) -> Result<Session, String> {
        Self::spawn_with_timeout(cfg, net_policy::mcp_call_timeout())
    }

    /// [`Self::spawn`] 的可注入版本：只给测试缩短超时用，其余逐字相同。
    pub(super) fn spawn_with_timeout(
        cfg: &ServerCfg,
        timeout: Duration,
    ) -> Result<Session, String> {
        let mut child = Command::new(&cfg.command)
            .args(&cfg.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // stderr 不接：MCP 只走 stdout，混进来会污染帧。代价是 server 自己的报错
            // 看不到 —— 如实记，本笔不假装有日志。
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("启动「{}」失败（命令 {}）：{e}", cfg.name, cfg.command))?;
        let stdin = child.stdin.take().ok_or("拿不到子进程的 stdin")?;
        let stdout = child.stdout.take().ok_or("拿不到子进程的 stdout")?;

        let (tx, rx) = unbounded_channel();
        std::thread::Builder::new()
            .name(format!("mcp-read-{}", cfg.id))
            .spawn(move || {
                let mut reader = BufReader::new(stdout);
                let mut buf: Vec<u8> = Vec::new();
                loop {
                    buf.clear();
                    match reader.read_until(b'\n', &mut buf) {
                        Ok(0) => break, // EOF：进程关了 stdout
                        Ok(_) => match std::str::from_utf8(&buf) {
                            Ok(s) => {
                                if tx.send(Ok(s.to_string())).is_err() {
                                    break; // 会话已经没人要了
                                }
                            }
                            // 协议规定是 UTF-8 JSON。不是就别猜，直接报。
                            Err(_) => {
                                let _ = tx.send(Err(
                                    "服务往 stdout 写了不是 UTF-8 的东西（是不是把日志打进来了）"
                                        .to_string(),
                                ));
                                break;
                            }
                        },
                        Err(e) => {
                            let _ = tx.send(Err(format!("读子进程输出失败：{e}")));
                            break;
                        }
                    }
                }
            })
            .map_err(|e| format!("起读线程失败：{e}"))?;

        let (phase, init) = initialize_request();
        let mut s = Session {
            child,
            stdin,
            rx,
            lines: LineReader::new(),
            phase,
            next_id: 1,
            timeout,
        };
        s.write_raw(&init)?;
        Ok(s)
    }

    pub(super) fn alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    /// 会话是否已经被判死。**重建判据必须先看它**：超时分支 `kill` 之后，`try_wait`
    /// 仍可能返回 `Ok(None)`（`kill` 是异步的，收尸那一刻之前进程状态还没翻），
    /// 只看进程状态就会把这条废会话再复用一次、再白等一次超时。
    pub(super) fn is_failed(&self) -> bool {
        matches!(&self.phase, Phase::Failed(_))
    }

    fn write_raw(&mut self, msg: &Outgoing) -> Result<(), String> {
        let mut buf = encode_line(msg)
            .map_err(|e| format!("消息编码失败：{e}"))?
            .into_bytes();
        buf.push(b'\n');
        self.stdin
            .write_all(&buf)
            .and_then(|()| self.stdin.flush())
            .map_err(|e| format!("写进 MCP 子进程失败：{e}"))
    }

    /// 带状态机校验的写：`on_outgoing` 挡住「还没 Ready 就发 tools/call」。
    fn write(&mut self, msg: &Outgoing) -> Result<(), String> {
        on_outgoing(&self.phase, msg).map_err(|e| format!("现在不能发这条消息：{e}"))?;
        self.write_raw(msg)
    }

    /// 等一条 id 匹配的响应，顺手把通知 / 初始化结果消化掉。超时**对每次等待独立计时**：
    /// 通知一条接一条地来也照样在下一次等待上被 mcpCallMs 掐断，不会无限拖住。
    async fn recv_matching(&mut self, want: &Id) -> Result<Incoming, String> {
        loop {
            let chunk = match tokio::time::timeout(self.timeout, self.rx.recv()).await {
                Err(_) => {
                    // 超时 = 这个会话已经废了。一次失败不能放大成「以后每次调用都要
                    // 等满 30 秒」：kill 之后 wait 收尸（不留僵尸），再把 phase 置
                    // Failed —— 重建判据靠 phase，不能靠 `try_wait` 的时序。
                    let secs = self.timeout.as_secs().max(1);
                    let _ = self.child.kill();
                    let _ = self.child.wait();
                    self.phase =
                        Phase::Failed(format!("上一次调用等了 {secs} 秒没回话，进程已终止"));
                    return Err(format!(
                        "MCP 服务 {secs} 秒没回话，已终止它；下次调用会重新拉起"
                    ));
                }
                Ok(None) => return Err("MCP 服务关掉了 stdout（进程退出或崩了）".into()),
                Ok(Some(Err(e))) => return Err(e),
                Ok(Some(Ok(s))) => s,
            };
            // 空行是 server 把日志打到 stdout 的典型症状，这里如实报出来。
            let lines = self
                .lines
                .push(&chunk)
                .map_err(|e| format!("服务发来的数据不合法：{e}"))?;
            for line in lines {
                let msg = decode_line(&line).map_err(|e| format!("服务发来的数据不合法：{e}"))?;
                let (phase, outs) = on_incoming(&self.phase, msg.clone());
                self.phase = phase;
                for o in &outs {
                    self.write(o)?;
                }
                if let Phase::Failed(reason) = &self.phase {
                    return Err(format!("MCP 会话失败：{reason}"));
                }
                if let Incoming::Response { id, .. } = &msg {
                    if id == want {
                        return Ok(msg);
                    }
                }
            }
        }
    }

    /// 把 `initialize` 的响应等回来。已经 Ready 就直接过。
    pub(super) async fn ensure_ready(&mut self) -> Result<(), String> {
        let want = match &self.phase {
            Phase::Ready => return Ok(()),
            Phase::Failed(reason) => return Err(format!("这个 MCP 会话已经失败：{reason}")),
            Phase::AwaitingInitialize { request_id } => request_id.clone(),
        };
        self.recv_matching(&want).await?;
        match &self.phase {
            Phase::Ready => Ok(()),
            Phase::Failed(reason) => Err(format!("初始化失败：{reason}")),
            Phase::AwaitingInitialize { .. } => Err("初始化还没走完就返回了".to_string()),
        }
    }

    fn take_id(&mut self) -> Id {
        self.next_id += 1;
        Id::Num(self.next_id)
    }

    /// 发一条请求并等它的响应。协议层 error 原样上抛，由调用方决定怎么讲。
    pub(super) async fn request(
        &mut self,
        method: &str,
        params: Option<Value>,
    ) -> Result<Value, String> {
        let id = self.take_id();
        self.write(&Outgoing::Request {
            id: id.clone(),
            method: method.to_string(),
            params,
        })?;
        match self.recv_matching(&id).await? {
            Incoming::Response { result, error, .. } => {
                if let Some(e) = error {
                    return Err(describe_rpc_error(&e));
                }
                result.ok_or_else(|| format!("{method} 的响应里没有 result"))
            }
            other => Err(format!(
                "等 {method} 的响应，却收到了{}",
                label_incoming(&other)
            )),
        }
    }
}
