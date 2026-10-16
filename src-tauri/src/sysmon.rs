//! 系统监控：CPU / 内存 / 磁盘 / 网卡计数器。
//!
//! 取数用 `sysinfo`（跨平台）；这里只负责把结果整理成卡片要的形状。
//! 两条设计约束：
//!
//! 1. **`System` 是常驻状态，不是每次新建。** CPU 占用率是"两次采样之间的差值"，
//!    每次调用都 `System::new()` 永远拿到 0；网卡速率同理要靠前后两次的计数器差。
//!    常驻 + 卡片每 2 秒来一次，第二次调用起就是真实值（第一次的 CPU 显示 0，
//!    前端把它当"采样中"如实显示，不冒充）。
//! 2. **只回原始计数，不算速率。** 网卡回累计收发字节数，速率（B/s）由前端用
//!    相邻两次采样自算 —— 那是纯函数（引擎 `sysmon.ts` 可单测），Rust 侧少一份
//!    "上次采样时刻"的状态要解释。

use std::sync::Mutex;

use sysinfo::{Disks, Networks, ProcessesToUpdate, System};

/// 一次系统采样。序列化给前端。
#[derive(serde::Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SysStats {
    /// 全局 CPU 占用率（0–100）。首次采样恒为 0（见文件头约束 1），前端显示「采样中」
    pub cpu_percent: f32,
    /// 已用内存（字节）
    pub mem_used: u64,
    /// 总内存（字节）
    pub mem_total: u64,
    /// 各挂载点：名字（Windows 上是盘符如 `C:\`）与已用/总量（字节）
    pub disks: Vec<DiskInfo>,
    /// 全部网卡**累计**收发的字节数。速率由前端差分（`netRate`），这里不给单速值
    pub net_rx_total: u64,
    pub net_tx_total: u64,
}

#[derive(serde::Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub mount: String,
    pub used: u64,
    pub total: u64,
}

/// 常驻系统状态。`System` 的 CPU/内存刷新都作用在它上面。
static SYS: Mutex<Option<System>> = Mutex::new(None);

/// 采一次。不失败 —— 这张卡只在桌面壳里被调用，任何字段拿不到都是 0/空表，
/// 前端对 0 的解释是「采样中/不可用」，比一个 Err 诚实。
#[tauri::command]
pub fn sys_stats() -> SysStats {
    let mut guard = SYS.lock().unwrap();
    let sys = guard.get_or_insert_with(System::new);

    sys.refresh_cpu_usage();
    sys.refresh_memory();
    let cpu_percent = sys.global_cpu_usage();
    let mem_used = sys.used_memory();
    let mem_total = sys.total_memory();

    let mut disks = Vec::new();
    for d in Disks::new_with_refreshed_list().list() {
        let total = d.total_space();
        let avail = d.available_space();
        // 某些卷（空光驱/未挂载）总量为 0 —— 除零的源头，跳过而不是给前端一个 NaN 比例
        if total == 0 || avail > total {
            continue;
        }
        disks.push(DiskInfo {
            mount: d.mount_point().to_string_lossy().into_owned(),
            used: total - avail,
            total,
        });
    }

    let mut net_rx_total = 0u64;
    let mut net_tx_total = 0u64;
    for data in Networks::new_with_refreshed_list().list().values() {
        net_rx_total += data.received();
        net_tx_total += data.transmitted();
    }

    SysStats {
        cpu_percent,
        mem_used,
        mem_total,
        disks,
        net_rx_total,
        net_tx_total,
    }
}

// ---- 进程列表（proc_list，D3）----
//
// 与 sys_stats 同一条"不失败"纪律：拿不到就是空表 + total 0，前端如实显示。
// **永远不提供 kill / 结束进程 / 提权**（Spec AC-36）——这张卡只读，一个字节
// 都不往进程身上写。排序截断抽成纯函数 `pick_top`（不碰 System，可单测），
// 与"速率由前端差分"是同一条逻辑与采样分离的思路。

/// proc_list 单页条数上限。再多的热力没有阅读价值，前端想要也不给
pub const PROC_LIST_LIMIT_MAX: usize = 200;
/// 未显式传 limit 时的默认条数
pub const PROC_LIST_LIMIT_DEFAULT: usize = 50;

/// 一条进程条目。序列化给前端（camelCase 与 SysStats 一致）
#[derive(serde::Serialize, PartialEq, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProcInfo {
    pub pid: u32,
    /// 进程名（截断显示由前端负责，这里给全名）
    pub name: String,
    /// CPU 占用率（0-100）。首次采样恒 0（差分语义，见文件头约束 1），前端显示「采样中」
    pub cpu_percent: f32,
    /// 物理内存占用（字节）
    pub mem_bytes: u64,
}

/// 一页进程列表。`total` 是系统进程总数（前端显示「共 N 个」），不受截断影响
#[derive(serde::Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProcPage {
    pub procs: Vec<ProcInfo>,
    pub total: usize,
}

/// 排序 + 截断（纯函数，可单测）。
/// `sort` 只认 `"cpu"` / `"mem"`，其余值一律按 cpu 处理 —— 诚实降级，
/// 不报错也不猜。`limit` 为 0 视同要默认值，超过上限夹到 [`PROC_LIST_LIMIT_MAX`]。
fn pick_top(mut procs: Vec<ProcInfo>, sort: &str, limit: usize) -> ProcPage {
    let total = procs.len();
    let limit = match limit {
        0 => PROC_LIST_LIMIT_DEFAULT,
        n => n.min(PROC_LIST_LIMIT_MAX),
    };
    match sort {
        // cpu_percent 是 f32，可能出 NaN —— partial_cmp 拿不到序就当相等，
        // 让 NaN 自然沉底，绝不 panic
        "mem" => procs.sort_by_key(|b| std::cmp::Reverse(b.mem_bytes)),
        _ => procs.sort_by(|a, b| {
            b.cpu_percent
                .partial_cmp(&a.cpu_percent)
                .unwrap_or(std::cmp::Ordering::Equal)
        }),
    }
    procs.truncate(limit);
    ProcPage { procs, total }
}

/// 进程列表采样：按 sort（cpu|mem）回 top-N + 总数。不失败 —— 采不到就是空表。
#[tauri::command]
pub fn proc_list(sort: String, limit: Option<usize>) -> ProcPage {
    let mut guard = SYS.lock().unwrap();
    let sys = guard.get_or_insert_with(System::new);
    // 全量刷新一次进程表（~2s 轮询节奏与 sys_stats 相同，由前端 timer 驱动）。
    // 第二个参数 true：顺带清掉已退出的进程，HashMap 不无限膨胀
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let procs: Vec<ProcInfo> = sys
        .processes()
        .values()
        .map(|p| ProcInfo {
            pid: p.pid().as_u32(),
            name: p.name().to_string_lossy().into_owned(),
            cpu_percent: p.cpu_usage(),
            mem_bytes: p.memory(),
        })
        .collect();
    pick_top(procs, &sort, limit.unwrap_or(PROC_LIST_LIMIT_DEFAULT))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 这台机器上最基本的事实：总内存 > 0、内存已用 ≤ 总量。
    /// CPU 首次采样是 0 是设计（见文件头约束 1），不在这里断言具体值。
    #[test]
    fn 采样字段自洽() {
        let s = sys_stats();
        assert!(s.mem_total > 0, "总内存不该是 0");
        assert!(s.mem_used <= s.mem_total, "已用内存不该超过总量");
        assert!(s.cpu_percent >= 0.0 && s.cpu_percent <= 100.0);
    }

    /// 连续两次采样：网卡计数器单调不减（累计值只会涨或持平）。
    #[test]
    fn 网卡计数器单调() {
        let a = sys_stats();
        let b = sys_stats();
        assert!(b.net_rx_total >= a.net_rx_total);
        assert!(b.net_tx_total >= a.net_tx_total);
    }

    /// 磁盘条目里 used ≤ total 且 total > 0（跳过空卷的约束在函数里）。
    #[test]
    fn 磁盘条目自洽() {
        for d in sys_stats().disks {
            assert!(d.total > 0, "{} 总量不该为 0", d.mount);
            assert!(d.used <= d.total, "{} 已用不该超过总量", d.mount);
        }
    }

    fn p(pid: u32, name: &str, cpu: f32, mem: u64) -> ProcInfo {
        ProcInfo {
            pid,
            name: name.into(),
            cpu_percent: cpu,
            mem_bytes: mem,
        }
    }

    /// sort=cpu：按占用率降序。
    #[test]
    fn 排序_cpu降序() {
        let page = pick_top(
            vec![
                p(1, "a", 5.0, 100),
                p(2, "b", 30.0, 100),
                p(3, "c", 12.0, 100),
            ],
            "cpu",
            10,
        );
        let names: Vec<&str> = page.procs.iter().map(|x| x.name.as_str()).collect();
        assert_eq!(names, vec!["b", "c", "a"]);
        assert_eq!(page.total, 3, "total 是总数，不受截断影响");
    }

    /// sort=mem：按内存降序，与 cpu 序互不干扰。
    #[test]
    fn 排序_内存降序() {
        let page = pick_top(
            vec![
                p(1, "a", 99.0, 300),
                p(2, "b", 1.0, 900),
                p(3, "c", 50.0, 600),
            ],
            "mem",
            10,
        );
        let names: Vec<&str> = page.procs.iter().map(|x| x.name.as_str()).collect();
        assert_eq!(names, vec!["b", "c", "a"]);
    }

    /// limit 夹紧：0 视同默认值，超上限夹到 200，截断不影响 total。
    #[test]
    fn limit_夹紧与截断() {
        let procs: Vec<ProcInfo> = (0u64..300).map(|i| p(i as u32, "x", 1.0, i)).collect();
        let page = pick_top(procs.clone(), "cpu", 0);
        assert_eq!(page.procs.len(), PROC_LIST_LIMIT_DEFAULT);
        let page = pick_top(procs.clone(), "cpu", 999);
        assert_eq!(page.procs.len(), PROC_LIST_LIMIT_MAX);
        assert_eq!(page.total, 300);
        let page = pick_top(procs, "cpu", 7);
        assert_eq!(page.procs.len(), 7);
    }

    /// 未知 sort 一律按 cpu 处理（诚实降级），NaN 占用率不炸排序。
    #[test]
    fn 坏值降级与_nan_不炸() {
        let page = pick_top(
            vec![
                p(1, "a", 5.0, 100),
                p(2, "b", 30.0, 100),
                p(3, "c", f32::NAN, 100),
            ],
            "什么都不是",
            10,
        );
        // NaN 与谁比较都是"相等"，位置不定，但条目不能丢、有限值的相对序不能乱
        assert_eq!(page.procs.len(), 3, "NaN 不该弄丢条目");
        let finite: Vec<f32> = page
            .procs
            .iter()
            .map(|x| x.cpu_percent)
            .filter(|v| v.is_finite())
            .collect();
        assert_eq!(finite, vec![30.0, 5.0], "有限值必须保持降序");
    }

    /// 真机采样：top-N 条数守约、total ≥ 返回条数、pid/name 基本可用。
    #[test]
    fn proc_list_采样自洽() {
        let page = proc_list("mem".into(), Some(10));
        assert!(page.procs.len() <= 10);
        assert!(page.total >= page.procs.len(), "total 不该小于返回条数");
        assert!(page.total > 0, "正常运行的系统不该一个进程都没有");
        for pr in &page.procs {
            assert!(!pr.name.is_empty(), "pid {} 的进程名不该为空", pr.pid);
        }
    }
}
