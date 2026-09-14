import { prisma } from '@/lib/db'

export async function listOrders(userId: string) {
  return prisma.order.findMany({
    where: { userId },
    include: { items: true },
  })
}

export async function getOrder(id: string) {
  return prisma.order.findUnique({
    where: { id },
    include: { items: true },
  })
}

export async function createOrder(
  userId: string,
  data: { total: number; items: { productId: string; quantity: number; price: number }[] }
) {
  return prisma.order.create({
    data: {
      userId,
      status: 'PENDING',
      total: data.total,
      items: {
        create: data.items,
      },
    },
  })
}

export async function cancelOrder(id: string) {
  const existing = await prisma.order.findUnique({ where: { id } })
  if (!existing) {
    return null
  }
  return prisma.order.update({
    where: { id },
    data: { status: 'CANCELLED' },
  })
}

function formatOrderTotal(total: number) {
  return Math.round(total * 100) / 100
}
