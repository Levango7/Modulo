import { createApp } from 'vue'
import App from './App.vue'
import './tokens/tokens.css'
import { createLayoutStore } from './vue/store'
import { REGISTRY } from './vue/cardRegistry'
import { createCardData } from './vue/cardData'

const app = createApp(App)
app.provide('store', createLayoutStore({ registry: REGISTRY }))
app.provide('cardData', createCardData())
app.mount('#app')
