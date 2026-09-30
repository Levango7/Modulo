<script setup lang="ts">
import { inject } from 'vue'
import { StickyNote } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'

defineProps<{ variant: string; chromeless?: boolean }>()
const cards = inject<CardDataApi>('cardData')!
</script>

<template>
  <div class="card">
    <div v-if="!chromeless" class="card-head"><StickyNote :size="14" /><span>便签</span></div>
    <div class="card-body">
      <textarea v-model="cards.state.sticky" class="pad" placeholder="随手记…" spellcheck="false" />
    </div>
  </div>
</template>

<style scoped>
.card-body {
  display: flex;
}
.pad {
  flex: 1;
  min-height: 0;
  resize: none;
  border: none;
  background: transparent;
  font-size: clamp(12px, 1.5cqw, 15px);
  line-height: 1.6;
  padding: 0;
}
.pad:focus {
  outline: none;
  box-shadow: none;
}
.hint {
  margin-left: auto;
  font-size: 11px;
}
</style>
