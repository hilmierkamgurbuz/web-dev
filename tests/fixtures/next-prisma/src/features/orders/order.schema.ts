import { z } from 'zod'

export const CreateOrderSchema = z.object({
  total: z.number().positive(),
  items: z.array(
    z.object({
      productId: z.string(),
      quantity: z.number().int().positive(),
      price: z.number().positive(),
    })
  ),
})

export const CancelOrderSchema = z.object({
  orderId: z.string(),
})
