import { todos } from '~/server/utils/todos'
import { CreateTodoSchema } from '~/server/utils/todo.schema'

export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  const body = await readValidatedBody(event, CreateTodoSchema.parse)
  const todo = {
    id: crypto.randomUUID(),
    title: body.title,
    done: false,
  }
  todos.push(todo)
  return todo
})
