import { auth } from '@/auth'
import { listOrders } from '@/features/orders/order.service'
import { OrderList } from '@/features/orders/components/OrderList'

export default async function OrdersPage() {
  const session = await auth()
  const orders = session?.user ? await listOrders(session.user.id) : []
  return (
    <main>
      <h1>Orders</h1>
      <OrderList orders={orders} />
    </main>
  )
}
