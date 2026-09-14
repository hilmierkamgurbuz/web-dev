<script setup lang="ts">
const todos = ref(await fetchTodos())
const newTitle = ref('')

async function handleAdd() {
  const todo = await createTodo(newTitle.value)
  todos.value.push(todo)
  newTitle.value = ''
}
</script>

<template>
  <div>
    <h1>Todos</h1>
    <input v-model="newTitle" />
    <button @click="handleAdd">Add</button>
    <TodoList :todos="todos" />
  </div>
</template>
