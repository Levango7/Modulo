import { createApp } from 'vue'
import App from './App.vue'
import './tokens/tokens.css'
import { createLayoutStore } from './vue/store'
import { REGISTRY } from './vue/cardRegistry'
import { createCardData } from './vue/cardData'
import { createContentHistory } from './vue/contentHistory'
import { createStorage } from './vue/fileStorage'
import { createSyncStore, watchSectionWrites } from './vue/syncStore'
import { migrateStorage } from './vue/migrate'

void bootstrap()

async function bootstrap() {
  // 桌面壳必须先 hydrate 磁盘数据再建 store：存储适配器是同步接口，
  // 晚一步就只能拿到空版面，然后第一帧就把空版面写回磁盘，把用户的作品覆盖掉。
  const storage = await createStorage()
  // 多端同步的"本机各段最后写过"的戳：包一层存储适配器盯写入，**不侵入任何调用点**
  // （靠每处保存时手动记一笔，迟早漏掉一条）。口令不在这里，见 `syncStore.ts` 文件头。
  const syncStore = createSyncStore(storage)
  const watched = watchSectionWrites(storage, syncStore)
  // 数据迁移（P0-⑤）：**在任何 store 读盘之前**把老版本数据升上来并写回；
  // 它自己绝不抛，写失败只会留下 notes —— 启动不能被一份坏数据拦住。
  const migration = migrateStorage(watched)
  const app = createApp(App)
  app.provide('storage', watched)
  app.provide('syncStore', syncStore)
  app.provide('migrationNotes', migration.notes)
  // cardData 必须先于 store：**首次 parseLayout 的注册表要已含扩展卡** ——
  // 旧版面里的 `ext:<id>` 条目若在静态表上解析，会被当未知模块清洗掉（E2E 实测）。
  const cardData = createCardData(watched)
  app.provide('cardData', cardData)
  app.provide('store', createLayoutStore({ registry: REGISTRY, storage: watched, extensions: cardData.state.extCards }))
  // 内容级撤销（P0-②）：与版面历史各自独立，由 App 的 undoLatest() 按时间戳择近
  app.provide('contentHistory', createContentHistory(cardData.state))
  app.mount('#app')
}
