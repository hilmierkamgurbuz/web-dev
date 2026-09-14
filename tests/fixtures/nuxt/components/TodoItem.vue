<script setup lang="ts">
defineProps<{
  todo: { id: string; title: string; done: boolean }
}>()
</script>

<template>
  <li>
    <span>{{ todo.title }}</span>
    <span>{{ todo.done ? 'done' : 'pending' }}</span>
  </li>
</template>
