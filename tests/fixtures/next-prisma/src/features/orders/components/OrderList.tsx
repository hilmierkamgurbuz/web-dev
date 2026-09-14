import { OrderCard } from './OrderCard'

type OrderListProps = {
  orders: { id: string; status: string; total: number }[]
}

export function OrderList({ orders }: OrderListProps) {
  return (
    <ul>
      {orders.map((order) => (
        <li key={order.id}>
          <OrderCard order={order} />
        </li>
      ))}
    </ul>
  )
}
