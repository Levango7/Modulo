# nexusloom 织布机侧载（β）：把文档生成流水线变成 Modulo 安装包里的一部分

状态：**β1 已落地（2026-11-25，可选组件形态）** —— 方案 B′ 已定（2026-11-24 侦察后修订，
原「方案 B = zipapp」的打包形态作废），**安装包体积不变**、运行时按需下载。
｜α（把 nexusloom 当 MCP server 消费）已闭环：见 §12.88 / §12.90 / §12.93 与 nexusloom 仓 `72abe1e`

**β1 实测（不是估算）**：`loom-runtime-v0.1.0.tar.bz2` = **14,745,837 字节（14.1 MiB）**，
sha256 `b8e7a5b11f1b7a9cd8e98a7844a3cb92bfb8e2643c1a3fc27151730142d235ec` —— 比侦察时估计的
63–70 MB 小得多，因为最小集只装了唯一硬依赖 PyYAML（其余依赖织布机按自身设计「如实回报跳过原因」），
而嵌入式 CPython 本身就是压缩分发的。Release `loom-runtime-v0.1.0` 已挂（immutable）。

## 这一笔解决的是哪个问题

α 已经让 Modulo **能调**织布机：用户在 Modulo 的 MCP 配置里填一条 `loom --mcp`，六个工具面
（`generate_document` / `run_workflow` / `get_task` / `list_tasks` / `list_pipelines` /
`get_pipeline_info`）就能真的跑，真机验收 5/5 过，还顺手抓出并修掉了 nexusloom 的一个真 bug
（通知帧只认 `"initialized"`）。但 α 的**前提是用户机器上有 Python + 有装好的 nexusloom** ——
这不是「Modulo 的能力」，这是「用户自己搭的能力」。

β 要的是**随安装包分发**：装好 Modulo 就有织布机，配置里选一条就能用，不需要用户懂 Python。

## 侦察结论（2026-11-24 只读侦察，全文见记忆 `nexusloom-sidecar-plan-b-recon`）

- 真仓在 **`F:\Nexus\Workflow\nexusloom`**（用户口述的 `F:/Nexus/nexusloom` 不存在）；
  依赖核心 6 个（只有 PyYAML 是硬需求，其余缺失时逐节点「如实回报跳过原因」）。
- **`.pyz`（zipapp）形态不成立**：全仓 **26 处 `Path(__file__)` 锚点**（`loom_core/paths.py` /
  `state_paths.py` / `task_queue.py` / `message_store.py` / `mcp_server.py` / `run.py` …）、
  agent 与 pipeline 的发现全靠**磁盘 glob**、**0 处 `importlib.resources`** —— 硬做 zipapp 要改的
  代码面覆盖六七个模块，收益却与「解压后的目录树」完全相同。
- Windows 友好度比预期高：`fcntl` 缺失时有 `O_CREAT|O_EXCL` 自旋锁、`os.kill(pid,0)` 在 nt 上
  改 ctypes `OpenProcess`、无 `os.symlink` 顶层依赖。**两个真痛点**：Windows 管道默认 cp936
  会坏 MCP 帧（首行必须 `reconfigure(encoding="utf-8")`）；Modulo 的 MCP 配置**没有 cwd 字段**，
  而默认输出与 MCP 输出白名单都相对项目根。

## 用户裁决（2026-11-24，生效）

**β 按「可选组件」做**：安装包体积不变（10 MB 量级），织布机运行时**按需下载**。

这条裁决同时定死了后面几件事（此前稿里悬着的都在这里落地）：

1. **形态**：仍是 B′（嵌入式 CPython + 解压目录树 + 目录外可写数据区），但**不进安装包** ——
   `tauri.conf.json` **不加 `externalBin`**、CI 桌面壳 job **不加拷贝 step**；改成运行时下载一个
   自包含的运行时包（解释器 + 依赖闭包 + nexusloom 树，合计 ~63–70 MB 量级），落 `%APPDATA%` 下的
   `app.modulo/ai/loom/<版本>/`（释义：`<版本>` 是占位符）。安装包内容门禁那条断言**不做**（没有要打进包的东西）。
2. **完整性**：下载包带 sha256 清单（**单一出处**在本仓的 `loom-runtime.json`，与 Modulo 版本一起演进）；
   校验不过 = 拒绝解压 + 人话说明，**不留半个目录**（先落临时目录、校验通过再原子改名）。
3. **可回退**：版本目录并列（`<版本>/`），`loom.json` 只记"当前用哪一个"；换版本 = 改一行，旧版本目录
   保留到用户显式清理 —— 与「锚点存活」同一哲学：**删之前先有别的 ref 能到**。
4. **离线姿态**：不下载 = 不显示 MCP 配置建议（设置里那句「复制到 MCP 配置」只在运行时装好后出现）；
   下载失败一律人话 + 可重试，**不静默重试**（静默重试会替用户烧流量，与「错过不补跑」同一条纪律）。
5. **下载源**：默认 GitHub Release asset（本仓 `loom-runtime-v*` tag），URL 可按设置覆盖（私有网关/离线盘）。

**没变的**：`.env` 绝不进包；Windows cp936 的 UTF-8 首行；cwd/输出白名单；ocr/embed 禁带。
## 决策：方案 B′ —— 嵌入式 CPython + 解压后的目录树 + 目录外可写数据区

| 形态 | 体积（解压后） | 结论 |
|---|---|---|
| A 源码分发 + 用户自备 Python 3.11 | ~5 MB | 否决：等于没做，用户仍要自己搭 |
| **B′ 嵌入式 CPython + 解压目录树** | **最小 63–70 MB** | **采纳** |
| B（旧）zipapp `.pyz` | ~20–25 MB | **作废**：26 处 `Path(__file__)` + 磁盘 glob，见上 |
| C PyInstaller onefile | ~40–50 MB | 备选： Defender 暴露面与启动开销都更大 |
| D 全 render/ingest extras | ~130–140 MB | 后置：pymupdf 单件 48 MB，按真需求再加 |

**禁带**：`ocr` / `embed` 两个 extra（GB 级，且 pyproject 自己就写了「故意不进 all」）。

### B′ 的组成

1. **嵌入式 CPython 3.12 win64**（Tauri `externalBin` 旁边放可执行目录，不用 `python.exe`
   走注册表的形态，避免与用户机器上的 Python 相互影响）。
2. **nexusloom 源码/数据整棵树**（含 `pipelines/` / `packs/` / `agents/` / `scripts/` /
   `loom_core/dashboard/`）解压到安装目录内，**zipimport 优先、缺失回落磁盘**的口径留给后续加固。
3. **可写数据区在安装目录外**（`LOOM_STATE_DIR` / `LOOM_VERSIONS_DIR` 指向 appdata）——
   安装目录可能只读（Program Files），SQLite WAL 也要落在能写的地方。
4. **启动 shim（launcher）**三件事：第一行 `reconfigure(encoding="utf-8")`；`chdir` 到 LOOM_ROOT
   （解掉 cwd 耦合）；`sys.path` 指向解压树，然后 `run_mcp_server()`（α 已经踩过：
   `mcp_server.py` 没有 `__main__`，`python -m` 直跑会定义完即退）。
5. **绝不打包 nexusloom 仓根的 `.env`** —— 那里现存真实 API key（侦察实证）。本地密钥走
   Modulo 既有的凭据管理器通道，不走 sidecar 的环境文件。

## 分期（β1 起步，β2/β3 依次）

- **β1 打包与接线**：`tauri.conf.json` 的 `externalBin` + CI 桌面壳 job 的拷贝 step
  （sherpa DLL 那条 step 是现成模板）+ 安装包内容门禁（`$need` 断言打包进来的解释器与
  nexusloom 树非空）+ launcher shim + 设置页一条新增（指向安装目录里那个树）。**本笔不接面板。**
- **β2 面板与内容门禁**：内置交付面板（`loom_core/dashboard/`，stdlib http.server）经 Rust 打开；
  **硬门槛 = CSP 不含本机端口 + Rust net 策略拒回环** ⇒ `net-policy.json` 三处 carve-out（§2.3）。
- **β3 CI 冒烟 + Windows 真机**：把「Modulo 起 sidecar → initialize → tools/list → 一次
  `generate_document`」塞进 Modulo 构建（nexusloom 自己的 CI **只跑 Linux**，Windows 回归
  今天只靠作者本机，这是 β 最大的隐性成本）。

## 五条风险与对策（按严重度）

1. **stdio 编码**：Windows cp936 坏 MCP 帧 ⇒ shim 第一行 reconfigure UTF-8，并有反例测试。
2. **cwd / 输出路径耦合**：默认输出 `output/<task>_result.md` 与 MCP 输出白名单都相对项目根
   ⇒ shim chdir + 显式 `LOOM_ROOT`；数据目录两项指到安装目录外。
3. **原生 ABI**：selectolax（C）/ orjson（Rust）必须按**目标 CPython + win_amd64** 预编译，
   CI 装机时锁版本；不做 free-threaded 构建。
4. **密钥**：`.env` 绝不进包；密钥只走 Modulo 凭据管理器。
5. **回归面**：nexusloom CI 只 Linux ⇒ β3 的 Windows 冒烟必须进 Modulo 的 CI，否则回退成本全押本机。

## 明确不做（如实记）

① 不做 zipapp / PyInstaller-in-app（写在上面的「作废」里，理由是可复现的代码事实）；② 不带
ocr/embed extra；③ render（docx/pdf/xlsx/pptx）与 ingest（PDF）先不做进 B′ 最小集 ——
缺了它们织布机会「如实回报跳过原因」，这是它自己的设计，不是缺陷；④ 不改 nexusloom 的产品行为
（β 只做打包与接线，织布机的 bug 修在它自己仓里，α 的 #146 就是先例）。