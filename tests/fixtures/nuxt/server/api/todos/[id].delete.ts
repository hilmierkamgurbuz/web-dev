import { todos } from '~/server/utils/todos'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const index = todos.findIndex((todo) => todo.id === id)
  if (index !== -1) {
    todos.splice(index, 1)
  }
  return { success: true }
})
