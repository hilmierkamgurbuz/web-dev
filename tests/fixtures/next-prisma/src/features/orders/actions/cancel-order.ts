'use server'

import { auth } from '@/auth'
import { cancelOrder } from '@/features/orders/order.service'
import { CancelOrderSchema } from '@/features/orders/order.schema'

export async function cancelOrderAction(input: { orderId: string }) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }
  const { orderId } = CancelOrderSchema.parse(input)
  return cancelOrder(orderId)
}
