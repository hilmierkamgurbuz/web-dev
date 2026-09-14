import { z } from 'zod'
import { createProduct, deleteProductBySlug, products } from '$lib/server/db'
import { protectedProcedure, publicProcedure, router } from './trpc'

const CreateProductSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  price: z.number().positive(),
})

export const productRouter = router({
  list: publicProcedure.query(() => {
    return products
  }),
  create: protectedProcedure.input(CreateProductSchema).mutation(({ input }) => {
    return createProduct(input)
  }),
  remove: publicProcedure.input(z.string()).mutation(({ input }) => {
    deleteProductBySlug(input)
    return { success: true }
  }),
})
