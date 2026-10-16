/**
 * 浮窗入口（2026-10-13 第一批「脱离浮窗」）。
 *
 * 与主窗同一套依赖装配（storage / cardData / appearance），差别只在：
 * ① 只渲染一张卡；② 顶上一枚极窄把手条（拖动窗口 + 还原 + 关闭）；
 * ③ 监听主窗写入事件（`modulo:doc-written`），主窗改了版面/卡片内容就重读一遍 ——
 *   两个窗口共享同一份落盘文件，靠事件而不是轮询同步。
 */
import { createApp, h, ref } from 'vue'
import '../tokens/tokens.css'
import { createCardData } from '../vue/cardData'
import { createStorage } from '../vue/fileStorage'
import FloatShell from './FloatShell.vue'
import { fetchFloats, onDocWritten, unfloatCard } from './api'

void bootstrap()

async function bootstrap() {
  const cardId = new URLSearchParams(location.search).get('card') ?? ''
  const storage = await createStorage()
  const revision = ref(0)
  // 主窗写盘 → 浮窗重读：cardData 的 state 是 ref，重建一份即可让卡片拿到新数据
  const cardData = createCardData(storage)

  onDocWritten(() => {
    revision.value++
    // 内容变更时重建 cardData（简单可靠：浮窗卡少、数据量小，重建成本可忽略）
    Object.assign(cardData, createCardData(storage))
  })

  const app = createApp({
    setup() {
      return () =>
        h(FloatShell, {
          cardId,
          revision: revision.value,
          storage,
          cardData,
        })
    },
  })
  app.provide('storage', storage)
  app.provide('cardData', cardData)
  app.mount('#app')
  // 浮窗自己也核一次登记（防手拼 URL 开野窗）。**只在非空清单上判"不在其中"** ——
  // 命令失败会返回空数组，不能把"拿不到清单"当成"我是野窗"而自关。
  void fetchFloats().then((list) => {
    if (list.length > 0 && !list.some((e) => e.card_id === cardId)) void unfloatCard(cardId)
  })
}
