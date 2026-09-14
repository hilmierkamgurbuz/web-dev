<script setup lang="ts">
const route = useRoute()
const id = route.params.id as string
const todos = ref(await fetchTodos())
const todo = computed(() => todos.value.find((item: { id: string }) => item.id === id))

async function handleDelete() {
  await removeTodo(id)
  await navigateTo('/')
}
</script>

<template>
  <div>
    <TodoItem v-if="todo" :todo="todo" />
    <button @click="handleDelete">Delete</button>
  </div>
</template>
