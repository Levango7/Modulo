name: 拉取请求

body:
  - type: markdown
    attributes:
      value: |
        一次 PR 只做一件事。提交信息用中文，`<type>(<scope>): <一句话>`，正文写**为什么**。
        规矩与环境见 [CONTRIBUTING.md](../CONTRIBUTING.md)。

  - type: checkboxes
    id: verify
    attributes:
      label: 提交前
      options:
        - label: `npm run verify` 全绿（类型检查 → 单测含引擎覆盖门禁 → 构建 → E2E）
        - label: `npm run docs:check` 绿（若改动了认领规模数字的文档行）
        - label: 引擎层改动：确认没有 import vue / @tauri，也没出现 document / window
        - label: 新增判据有**反例**（校验函数只测「返回空」等于没测）

  - type: textarea
    id: what
    attributes:
      label: 改了什么
      placeholder: 一两句。说清"改了哪些层"比逐文件罗列有用
    validations:
      required: true
  - type: textarea
    id: why
    attributes:
      label: 为什么
      description: 解决了什么问题 / 修的是哪条真实缺陷。issue 链接、实测数据、失败的判据都放这里。
    validations:
      required: true
  - type: textarea
    id: verify_evidence
    attributes:
      label: 怎么验的
      description: 贴实跑输出（数字、单测数、覆盖率）。headless 数据请注明是 headless。
      placeholder: |
        单测 331 条（31 文件）全绿；受测层分支覆盖 93.75%（门禁 90）
        三档视口 1440/720/390：hScroll=false、clipped=0、最小字号 11px、零 console 报错
  - type: textarea
    id: visual
    attributes:
      label: 截图（涉及视觉/交互时必填）
      description: 三档视口各一张。`node scripts/shoot.mjs` 可以生成，但产物落在 `evidence/`（本机目录、不入库），请自行贴图。
  - type: checkboxes
    id: scope
    attributes:
      label: 影响面
      options:
        - label: 涉及引擎层（投影 / 排布 / 校验 / 序列化）
        - label: 涉及数据格式或持久化（含 schema 迁移）
        - label: 涉及桌面壳（Rust 侧 / 打包 / 权限清单）
        - label: 只碰文档
