# @modulo/engine

Modulo 的布局投影引擎。**一份 12 列逻辑版面，按容器宽度投影成 12 / 8 / 6 / 4 / 1 档**，
并保证五条不变量（只读、幂等、无重叠、尺寸充分、分区完整）。纯函数、零框架依赖 ——
不 import vue、不碰 DOM，所以能脱离 UI 直接单测（仓库里的属性测试与覆盖门禁就是冲着这层来的）。

```js
import { project, projectForWidth, parseLayout, EMPTY_REGISTRY } from '@modulo/engine'
```

## 包内有什么

- `projection` / `breakpoints` / `downgrade` / `fit` / `fitHeight` —— 投影与降档；
- `ops` / `history` / `tidy` / `spread` / `spot` / `geometry` —— 版面操作与不变量；
- `serialize`（含 `migrate` 迁移表）/ `validate` / `schemes` / `templates` —— 存档、校验与模板；
- `update` —— 版本比较与发布清单解析（纯逻辑部分）。

## 两种消费方式（同一条源码）

- **仓库内**（应用、测试、E2E）：走 `vite.config.ts` / `vitest.config.ts` / `tsconfig.json` 里的
  `@modulo/engine` 别名，直接吃 `src/` —— 改引擎不用先构建，编辑器跳到源码。
- **包外**（`npm install @modulo/engine`）：吃 `dist/`（`npm run build` 用 `tsc` 产出，
  `prepack` 会先构建，`npm pack` 出来的 tarball 里只有 `dist/` 与这份 README）。

## 版本

暂与应用同版本走（应用发 0.4.0，这里也是 0.4.0），`scripts/docs-check.mjs` 会机器核对两边一致 ——
等真有独立消费者再谈独立版本。**测试不在这个包里**：它们在仓库的 `tests/`（属性测试、边界用例、
引擎纯度守卫），跑 `npm test` 即可；把测试塞进包里只会让"覆盖门禁"和"包分发"两件事互相牵制。
