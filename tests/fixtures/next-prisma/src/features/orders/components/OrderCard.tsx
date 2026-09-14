type OrderCardProps = {
  order: {
    id: string
    status: string
    total: number
  }
}

export function OrderCard({ order }: OrderCardProps) {
  return (
    <div>
      <p>{order.id}</p>
      <p>{order.status}</p>
      <p>{order.total}</p>
    </div>
  )
}
