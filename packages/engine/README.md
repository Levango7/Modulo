# @levango7/engine

Modulo 的布局投影引擎。**一份 12 列逻辑版面，按容器宽度投影成 12 / 8 / 6 / 4 / 1 档**，
并保证五条不变量（只读、幂等、无重叠、尺寸充分、分区完整）。纯函数、零框架依赖 ——
不 import vue、不碰 DOM，所以能脱离 UI 直接单测（仓库里的属性测试与覆盖门禁就是冲着这层来的）。

```js
import { project, projectForWidth, parseLayout, EMPTY_REGISTRY } from '@levango7/engine'
```

## 包内有什么

- `projection` / `breakpoints` / `downgrade` / `fit` / `fitHeight` —— 投影与降档；
- `ops` / `history` / `tidy` / `spread` / `spot` / `geometry` —— 版面操作与不变量；
- `serialize`（含 `migrate` 迁移表）/ `validate` / `schemes` / `templates` —— 存档、校验与模板；
- `update` —— 版本比较与发布清单解析（纯逻辑部分）。

## 两种消费方式（同一条源码）

- **仓库内**（应用、测试、E2E）：走 `vite.config.ts` / `vitest.config.ts` / `tsconfig.json` 里的
  `@levango7/engine` 别名，直接吃 `src/` —— 改引擎不用先构建，编辑器跳到源码。
- **包外**（`npm install @levango7/engine`）：吃 `dist/`（`tsc` 产出，`prepack` 会先构建，
  tarball 里只有 `dist/` 与这份 README，外加 `LICENSE`）。

## 名字

这个包在 2026-10-03 抽出来时叫 `@modulo/engine`，**2026-10-09 起对外发布名是 `@levango7/engine`** ——
`@modulo` 这个作用域在 npm 上已经不是我们的了（实测 `npmjs.com/org/modulo` 落到别人的账号页）。
仓库内与发布名**是同一个名字**，`tests/release/engine-package.test.ts` 逐处点名守着这一点：
别名、`tsconfig` 的 `paths`、根 `package.json` 的依赖与脚本，任何一处漂了就红。
（改名那次就吃过这个亏：别名写的是转义正则 `@modulo\/engine`，纯文本替换一条都没命中。）

## 版本与发布

版本**与应用同源**（`scripts/docs-check.mjs` 的 `VERSION_PLACES` 机器核对），
所以每个应用版本都会同时发一次这个包 —— 打 `v*` tag 时 CI 的 `release` job 里那条
`npm run engine:publish` 负责，仓库 secret 里没配 `NPM_TOKEN` 就跳过。
**代价要认下来**：引擎自己没改动时也会发一个新版本号（npm 上会有一串版本差异很小的条目），
换来的是"版本号永远能对上"这件事不需要人去记。等真有独立消费者再谈解耦。

**测试不在这个包里**：它们在仓库的 `tests/`（属性测试、边界用例、引擎纯度守卫），跑 `npm test` 即可；
把测试塞进包里只会让"覆盖门禁"和"包分发"两件事互相牵制。
