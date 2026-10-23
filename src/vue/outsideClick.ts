/**
 * 文档级外点关闭判定（2026-10-24 从 `App.vue` 的 `onDocMousedown` 抽出）。
 *
 * 「排布」下拉搬进 `AppToolbar.vue` 后，父组件拿不到它的 DOM ref，改判
 * 「mousedown 的 target 在不在 `.add-wrap` 里」。`closest` 从 target **自身**
 * 开始匹配，与原来 `arrangeWrap.contains(e.target)` 语义一致（`contains` 也含自身），
 * 所以渲染与行为都不变。
 *
 * `instanceof Element` 那道判断不是保险：`closest` 只长在 `Element` 上，直接调会在
 * 非元素 target（文本节点也算）上抛 `TypeError`，而 `contains` 收的是 `Node`。
 * 这三行是 App.vue 里少数「不开浏览器就能断言」的判定，所以单独成模块进受测层。
 */
export function insideAddWrap(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.add-wrap') !== null
}
