import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { CreateOrderSchema } from '@/features/orders/order.schema'

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const orders = await prisma.order.findMany({
    where: { userId: session.user.id },
    include: { items: true },
  })
  return NextResponse.json(orders)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = CreateOrderSchema.parse(await req.json())
  const order = await prisma.order.create({
    data: {
      userId: session.user.id,
      status: 'PENDING',
      total: body.total,
      items: {
        create: body.items,
      },
    },
  })
  return NextResponse.json(order, { status: 201 })
}
