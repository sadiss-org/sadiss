<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <BasePage>
        <div class="flex flex-1 flex-col items-center justify-around">
          <PerformanceInformation :text-color-danger="!isRegistered && wasRegisteredThisSession" />
          <div class="h-[60vw] w-[60vw]">
            <ion-button
              v-if="isRegistered"
              :disabled="true"
              class="pulse flex h-full w-full items-center justify-center rounded-full bg-highlight text-2xl font-bold uppercase">
              <p class="text-4xl text-primary">Active</p>
            </ion-button>
            <div
              v-else-if="wasRegisteredThisSession"
              class="flex h-full w-full flex-col items-center justify-center gap-8 rounded-full border-2 border-danger">
              <ion-spinner
                name="circular"
                class="scale-[200%] text-danger" />
              <span class="text-2xl uppercase text-danger">Reconnecting</span>
            </div>
            <div
              v-else
              class="flex h-full items-center justify-center">
              <ion-spinner
                name="circular"
                class="scale-[200%] text-highlight" />
            </div>
          </div>
          <div class="flex h-[100px] flex-col justify-center">
            <div
              v-if="!isRegistered && wasRegisteredThisSession"
              class="flex flex-col gap-5">
              <div class="flex w-full justify-center">
                <img
                  src="../../public/assets/broken-connection.svg"
                  class="h-[40px]" />
              </div>
              <p class="text-center text-sm leading-4 text-danger">
                Your connection is broken. The app is reconnecting by itself, please keep it open.
              </p>
            </div>
            <p
              v-else
              class="text-sm leading-4">
              To leave the performance or scan a different code you have to quit and re-start the app.
            </p>
          </div>
        </div>

        <p class="text-[12px]">v{{ appVersionNumber }}</p>
      </BasePage>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonPage, IonButton, useBackButton, IonSpinner } from '@ionic/vue'
import { watch, onUnmounted, onMounted, ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import { NavigationBar } from '@capawesome/capacitor-navigation-bar'
import { useMainStore } from '@/stores/MainStore'
import { useWebsocketConnection } from '@/composables/useWebsocketConnection'
import BasePage from '@/components/BasePage.vue'
import PerformanceInformation from '@/components/PerformanceInformation.vue'

const mainStore = useMainStore()
const { establishWebsocketConnection, isRegistered } = useWebsocketConnection()

// Disable hardware and NavigationBar back button on Android
useBackButton(10, () => {
  return
})

const appVersionNumber = import.meta.env.VITE_APP_VERSION

onMounted(async () => {
  if (!mainStore.expertMode) {
    establishWebsocketConnection()
  }

  try {
    if (Capacitor.getPlatform() === 'android') {
      await NavigationBar.hide()
    }
  } catch (error) {
    console.log(error)
  }
})

onUnmounted(async () => {
  if (Capacitor.getPlatform() === 'android') {
    await NavigationBar.show()
  }
})

const wasRegisteredThisSession = ref(false)
watch(
  () => isRegistered.value,
  (value) => {
    if (value) {
      wasRegisteredThisSession.value = true
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.pulse {
  animation-name: pulse;
  animation-duration: 2s;
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
}
@keyframes pulse {
  0% {
    @apply opacity-25;
  }
  50% {
    @apply opacity-100;
  }
  100% {
    @apply opacity-25;
  }
}
</style>
