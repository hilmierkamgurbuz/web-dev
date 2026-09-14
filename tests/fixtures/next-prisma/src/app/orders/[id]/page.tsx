import { getOrder } from '@/features/orders/order.service'
import { OrderCard } from '@/features/orders/components/OrderCard'
import { CancelOrderButton } from '@/features/orders/components/CancelOrderButton'

export const metadata = {
  title: 'Order Details',
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const order = await getOrder(id)
  if (!order) {
    return (
      <main>
        <p>Order not found</p>
      </main>
    )
  }
  return (
    <main>
      <OrderCard order={order} />
      <CancelOrderButton orderId={order.id} />
    </main>
  )
}
