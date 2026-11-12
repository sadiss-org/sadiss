<template>
  <ion-app>
    <ion-router-outlet />
  </ion-app>
</template>

<script setup lang="ts">
import { IonApp, IonRouterOutlet } from '@ionic/vue'
</script>

<style>
body,
html,
ion-toolbar {
  --background: #3e5b53;
  --ion-background-color: #3e5b53;
  @apply bg-primary;
}

ion-button {
  --background-hover: #253833;
  --background-activated: #253833;
  --background-focused: #253833;
}

ion-back-button {
  --color: white !important;
}
</style>
