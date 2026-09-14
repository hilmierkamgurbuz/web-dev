import { json } from '@sveltejs/kit'
import { z } from 'zod'
import { requireUser } from '$lib/server/auth'
import { createProduct, products } from '$lib/server/db'
import type { RequestHandler } from './$types'

const CreateProductSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  price: z.number().positive(),
})

export const GET: RequestHandler = async () => {
  return json(products)
}

export const POST: RequestHandler = async ({ request, locals }) => {
  requireUser(locals)
  const body = await request.json()
  const data = CreateProductSchema.parse(body)
  const product = createProduct(data)
  return json(product, { status: 201 })
}
