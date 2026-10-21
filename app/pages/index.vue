<script setup lang="ts">
import Inbox from '../../src/Inbox';
import { api, info } from '../../src/session';
import { openCommandBar } from '../../src/commandRegistry';

// Kept alive by app.vue so loaded sections, filters and scroll survive a trip to a PR and back.
defineOptions({ name: 'InboxPage' });
</script>

<template>
  <!-- app.vue renders pages only once GitHub is connected. -->
  <Inbox :api="api!" :info="info!" :on-open-command-bar="openCommandBar" />
</template>
