import { todos } from '~/server/utils/todos'

export default defineEventHandler((event) => {
  return todos
})
