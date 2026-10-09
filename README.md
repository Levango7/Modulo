# Modulo

自适应的自由编排工作台。**一份布局，从 1920 桌面到 390 窄屏都能编排、都能读、都能用键盘操作。**

[![CI](https://github.com/Levango7/Modulo/actions/workflows/ci.yml/badge.svg)](https://github.com/Levango7/Modulo/actions/workflows/ci.yml)

**先试 30 秒（不用装任何东西）**：[网页版](https://levango7.github.io/Modulo/)。打开后**把窗口从宽拖到窄** —— 这就是这个产品的全部：12 列逻辑版面会按容器宽度投影成 12 / 8 / 6 / 4 / 1 列，卡片按形态降档而不是被压成碎片。数据存在浏览器 localStorage 里，与桌面版各存各的。

**想要装起来用**：[Releases](https://github.com/Levango7/Modulo/releases/latest) 里有 Windows x64 的 NSIS 安装包。**装过一次之后，以后的新版本可以在设置页里直接更新**（下载 → 本地验签 → 重启安装）。安装包**暂未做 Authenticode 代码签名**（SignPath 免费签名申请进行中，签名政策见 [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md)），首次运行 Windows SmartScreen 会提示「未知发布者」。数据落在 `%APPDATA%\app.modulo\data\*.json`，整个目录拷走就是备份。

> 链接指向 `latest` 而不是写死某个版本号 —— 写死的那个迟早和仓库里的版本对不上，而读者不会知道。仓库当前源码版本以 `package.json` 为准（版本号 7 处同源，`npm run docs:check` 守）。

![工作台：出厂版面就是铺满的 —— 12 列、行带之间不留中缝](docs/assets/workbench-starter-1440.png)

## 核心能力

| 能力 | 做法 |
|---|---|
| 真响应式 | 逻辑 12 列恒定，物理列数按容器宽度**投影**（12/8/6/4/1），投影只读、不回写你的布局 |
| 调不坏 | 尺寸约束挂在"形态"的 `minW/minH` 上，缩放低于最小值会被拒绝而不是把内容压碎 |
| 键盘可达 | 方向键移动、`Shift+方向键`缩放、空格选入、`Enter`循环切形态、`Delete`/`Backspace`移回库、`L`锁定、`Ctrl/Cmd+A`全选、`Esc`取消、`Ctrl+Z`/`Ctrl+Shift+Z`·`Ctrl+Y` 撤销重做 |
| 可回退 | 50 步历史栈，一次拖拽 = 一步；紧凑等组合动作保留分步撤销 |
| 版面工具 | 整理 / 撑满 / 收紧 / 紧凑（收紧+整理），全部可撤销 |
| 版面模板 | 出厂默认 + 8 张推荐排法，首启自动弹一次；自己排的存进方案册 |
| 添加卡片 | 工具条「添加卡片」把还没在版面上的卡加进来：**41 种卡**按分组排列，出厂版面只放 5 张；目录见 `docs/CARD-CATALOG.md` |<!-- facts -->
| 计时 | **秒表**（往上数）、**倒计时**（往下数到 0）、**间歇计时**（专注一段休一段，内含「番茄 25/5」预设）、**呼吸计时**（方箱 4-4-4-4 / 助眠 4-7-8 / 平缓 4-6）—— 四个钟共用一套机制，时间不靠 `setInterval` 累加，所以**后台标签页被节流也不会少记时间** |
| 卡片 | 联网卡（天气 / 空气 / 汇率 / GitHub 仓库 / HN，全部首次渲染才查、缓存、取不到保留上一份）、时间日期（月历 / 进度 / 世界时钟 / 倒数日 / 正计时 / 日期工具）、工具类（计算器无 eval / 单位换算 / 颜色 / 文本统计 / 随机数 / 进制 / 习惯打卡）、便签 / 待办 / 速记 / 最近改动 |
| 备份 | 设置页「导出备份（含内容）」：版面、方案册和卡片正文打进一个 JSON；恢复前逐项确认 |
| 多版面 | 命名方案册（新建空白、拖拽或 `Alt+↑/↓` 排序）+ 布局/方案两套 JSON 导入导出，导入前逐条校验 |
| 三套外观 | 墨纸 / 柔光 / 亮彩，纯令牌层切换 |
| 桌面壳 | 无边框自制标题栏、托盘、系统级快捷键（可录制改键）；启动尺寸按显示器工作区逐轴夹取（默认 1280×800）；能力清单刻意不含 `allow-create` / `allow-destroy` |

## 跑起来

```bash
npm ci
npm run dev            # 浏览器预览 http://localhost:1430
npm run verify         # 类型检查 + 单测（含引擎覆盖率门禁）+ 构建 + 真浏览器 E2E
npm run tauri:dev      # 桌面窗口（需 Rust 工具链，见下）
npm run desktop:probe  # 桌面壳真机自检（发布前的本机门禁，不在 CI 跑）
```

Windows 上若用 **MSYS2 的 GNU 工具链**，构建前需要把它注入到该次命令的 PATH：

```bash
export PATH="/d/msys64/mingw64/bin:$PATH"
npm run tauri:build -- --no-bundle   # 只出 exe；去掉 --no-bundle 会去下载 NSIS 打安装包
```

`tauri-build` 在 GNU 目标上要 `windres` 打资源，缺它会报找不到资源编译器 —— 这是环境 PATH 问题，不是代码问题。

## 结构

```
packages/engine/  **@levango7/engine**：纯函数引擎（几何、碰撞、落位、形态、投影、历史、校验、方案册、模板 + 各卡纯逻辑）
                ★ 2026-10-09 起对外发布这个包（此前叫 @modulo/engine，见 docs/ARCHITECTURE.md §12）
                ★ 不引用框架与 DOM，由 tests/engine-purity.test.ts 与包构建（lib 只有 ES2022、无 DOM）双重执法
src/vue/        适配层：store、useCanvasDrag、keyboard（纯函数意图）、useProjection、useCellFocus、
                useElementWidth、useDensity、皮肤/备份/方案册/外壳/更新等 composables + components/
src/app/cards/  卡片：全部用容器查询连续缩放
tests/          单测 + fast-check 属性测试（投影不变量）+ 真浏览器 E2E
docs/ARCHITECTURE.md   设计定稿与决策记录（含被测试逼出来的修正）
CHANGELOG.md           迭代变更历史
```

## 验证

CI 有 **4 个 job**：`verify` 跑六步（类型检查 → 单测与属性测试（**顺带卡受测层分支覆盖 ≥90%**）→ 构建 → 引擎包独立构建 → E2E → 文档数字核对）；`desktop` 在 windows-latest 上跑 `cargo fmt --check` → `clippy -D warnings` → `cargo test` → 真打包出 exe；`release` 只在 `v*` tag 上签名出包并挂 GitHub Release；`web` 只在 `v*` tag（或手动派发）上把网页版部署到 gh-pages。**桌面自检探针（`npm run desktop:probe`）不在 CI 跑**，而且它的**项数是条件量**、不是一个固定数字：`PROBE_NET=1` 才跑探针里那一段取数与边界断言（`scripts/desktop-probe.mjs:838` 那块，共 4 条：每日一图能真取到壁纸 + 网页监控的私网回环/云元数据端点/明文 http 三条边界），那一轮 55 项，不带就是 51 项（出处：`evidence/probe-report.json` 里 `2026-10-06T09:14:20Z 55/55` 与 `2026-10-06T09:12:55Z 51/51` 两行；`evidence/` 在 `.gitignore` 里，是**本机**证据、不随仓库分发）—— runner 上 WebView2 不把远调端口参数写进浏览器进程，探针停在「连 CDP」那一步，与产品好坏无关；它是**发布前的本机门禁**（见 `docs/ARCHITECTURE.md` §10.3 / §11.4）。⚠️ 同一个症状还有另一个成因：用 `cargo build --release` 直接出的 exe 没开 `custom-protocol`，是一颗会去连 dev server 的「开发二进制」，判据是 `/json/list` 里页面的 `url`（空或 `localhost:1430` 就是二进制不对），出包要走 `npm run tauri:build -- --no-bundle` —— 见 §10.26.3。<!-- facts -->

投影算法有**五条**断言（只读、幂等、无重叠、尺寸充分、分区完整），随机版面 × 7 档列数各 200 例。量化门禁：受测层（`packages/engine/src/**` + 7 个 vue 纯模块）分支覆盖 ≥90%（当前 **≥94%**）、真拖期间帧距中位数 ≤18.2ms。<!-- facts -->

`npm run docs:check` 实跑单测与构建，核对文档里**认领了规模数字**（行尾有 `<!-- facts -->`）的那几行与实跑是否一致；未标记的历史数字不检查。

## 许可

Apache-2.0，全文见 [LICENSE](LICENSE)。选它而不是 MIT 的原因：带显式专利授权与商标条款。
