# Modulo

自适应的自由编排工作台。**一份布局，从 1920 桌面到 390 窄屏都能编排、都能读、都能用键盘操作。**

## 跑起来

```bash
npm ci
npm run dev            # 浏览器预览 http://localhost:1430
npm run verify         # 类型检查 + 单测 + 构建 + 真浏览器 E2E
npm run tauri:dev      # 桌面窗口（需 Rust 工具链，见下）
```

Windows 上若用 **MSYS2 的 GNU 工具链**（本机情况：`rustc` host 为 `x86_64-pc-windows-gnu`，`gcc`/`windres` 在 MSYS2 里而不在 PATH），构建前需要把它注入到该次命令的 PATH：

```bash
export PATH="/d/msys64/mingw64/bin:$PATH"
npm run tauri:build
```

`tauri-build` 在 GNU 目标上要 `windres` 打资源，缺它会报找不到资源编译器 —— 这是环境 PATH 问题，不是代码问题。

## 它跟同类产品的差别

| 能力 | 做法 |
|---|---|
| 真响应式 | 逻辑 12 列恒定，物理列数按容器宽度**投影**（12/8/6/4/1），投影只读、不回写你的布局 |
| 调不坏 | 尺寸约束挂在"形态"的 `minW/minH` 上，缩放低于最小值会被拒绝而不是把内容压碎 |
| 键盘可达 | 方向键移动、`Shift+方向键`缩放、空格多选、`Enter`切形态、`Delete`移回库、`L`锁定、`Ctrl+Z` 撤销 |
| 可回退 | 50 步历史栈，一次拖拽 = 一步；组合动作（紧凑）保留分步撤销 |
| 版面工具 | 整理（聚拢空洞）、撑满（按行铺满）、收紧（按内容实测降高） |
| 多版面 | 命名方案册 + 布局/方案两套 JSON 导入导出，导入前逐条校验 |
| 三套外观 | 墨纸 / 柔光 / 亮彩，纯令牌层切换，含模块身份色与强调色 |

## 结构

```
src/engine/     纯函数：几何、碰撞、落位、形态、投影、历史、校验、方案册
                ★ 不引用框架与 DOM，由 tests/engine-purity.test.ts 执法
src/vue/        适配层：store、指针拖拽、键盘、FLIP、皮肤、持久化
src/app/cards/  卡片：全部用容器查询连续缩放
tests/          单测 + fast-check 属性测试（投影不变量）+ 真浏览器 E2E
docs/ARCHITECTURE.md   设计定稿与决策记录（含被测试逼出来的修正）
```

## 验证

CI（`.github/workflows/ci.yml`）跑四步：类型检查 → 单测与属性测试 → 构建 → E2E。
投影算法有四条不变量，用随机版面 × 7 档列数各 200 例做属性断言：只读、幂等、无重叠、尺寸充分。

## 许可

待定。
