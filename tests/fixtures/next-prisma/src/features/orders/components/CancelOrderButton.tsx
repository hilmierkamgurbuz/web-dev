'use client'

import { useState } from 'react'
import { cancelOrderAction } from '@/features/orders/actions/cancel-order'

const stripeKey = process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY

export function CancelOrderButton({ orderId }: { orderId: string }) {
  const [pending, setPending] = useState(false)

  async function handleClick() {
    setPending(true)
    await cancelOrderAction({ orderId })
    setPending(false)
  }

  return (
    <div>
      <button onClick={handleClick} disabled={pending}>
        Cancel order
      </button>
      <span data-key={stripeKey} />
    </div>
  )
}
