<script setup lang="ts">
import App from '../src/App';

const home = () => window.location.assign(window.location.pathname);
</script>

<template>
  <NuxtErrorBoundary>
    <App />
    <template #error="{ error, clearError }">
      <main class="empty-state">
        <h1>Something went wrong</h1>
        <p>{{ error?.message || 'The workspace could not render.' }}</p>
        <button class="button" title="Retry rendering the workspace" @click="clearError()">Try again</button>
        <button class="text-button" title="Reload the app and return to your inbox" @click="home">Return to inbox</button>
      </main>
    </template>
  </NuxtErrorBoundary>
</template>
