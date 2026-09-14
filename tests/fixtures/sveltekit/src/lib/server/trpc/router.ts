import { publicProcedure, router } from './trpc'
import { productRouter } from './product'

export const appRouter = router({
  product: productRouter,
  health: publicProcedure.query(() => 'ok'),
})

export type AppRouter = typeof appRouter
