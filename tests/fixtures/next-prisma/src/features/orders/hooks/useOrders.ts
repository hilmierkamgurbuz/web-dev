'use client'

import { useEffect, useState } from 'react'

export function useOrders() {
  const [orders, setOrders] = useState([])

  useEffect(() => {
    fetch('/api/orders')
      .then((res) => res.json())
      .then(setOrders)
  }, [])

  return orders
}

export function useOrder(id: string) {
  const [order, setOrder] = useState(null)

  useEffect(() => {
    fetch(`/api/orders/${id}`)
      .then((res) => res.json())
      .then(setOrder)
  }, [id])

  return order
}

export async function updateOrderStatus(id: string, status: string) {
  const res = await fetch(`/api/orders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  return res.json()
}

export async function removeCartItem(itemId: string) {
  const res = await fetch('/api/cart/items', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId }),
  })
  return res.json()
}
