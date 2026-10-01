import { createApp } from 'vue'
import App from './App.vue'
import './tokens/tokens.css'
import { createLayoutStore } from './vue/store'
import { REGISTRY } from './vue/cardRegistry'
import { createCardData } from './vue/cardData'
import { createStorage } from './vue/fileStorage'

void bootstrap()

async function bootstrap() {
  // 桌面壳必须先 hydrate 磁盘数据再建 store：存储适配器是同步接口，
  // 晚一步就只能拿到空版面，然后第一帧就把空版面写回磁盘，把用户的作品覆盖掉。
  const storage = await createStorage()
  const app = createApp(App)
  app.provide('storage', storage)
  app.provide('store', createLayoutStore({ registry: REGISTRY, storage }))
  app.provide('cardData', createCardData(storage))
  app.mount('#app')
}
