import { describe, expect, it, vi } from 'vitest'
import { listOrders } from './order.service'
import { prisma } from '@/lib/db'

vi.mock('@/lib/db', () => ({
  prisma: {
    order: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

describe('listOrders', () => {
  it('returns an empty array when there are no orders', async () => {
    const result = await listOrders('user_1')
    expect(result).toEqual([])
    expect(prisma.order.findMany).toHaveBeenCalled()
  })
})
