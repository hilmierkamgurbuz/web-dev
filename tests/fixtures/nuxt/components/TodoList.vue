<script setup lang="ts">
defineProps<{
  todos: { id: string; title: string; done: boolean }[]
}>()
</script>

<template>
  <ul>
    <TodoItem v-for="todo in todos" :key="todo.id" :todo="todo" />
  </ul>
</template>
