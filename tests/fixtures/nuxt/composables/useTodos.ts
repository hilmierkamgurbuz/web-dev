export async function fetchTodos() {
  return $fetch('/api/todos')
}

export async function createTodo(title: string) {
  return $fetch('/api/todos', {
    method: 'POST',
    body: { title },
  })
}

export async function removeTodo(id: string) {
  return $fetch(`/api/todos/${id}`, {
    method: 'DELETE',
  })
}

export function useStats() {
  return useFetch('/api/stats')
}
