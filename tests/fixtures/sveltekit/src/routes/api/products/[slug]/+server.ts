import { error, json } from '@sveltejs/kit'
import { deleteProductBySlug, findProductBySlug } from '$lib/server/db'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ params }) => {
  const product = findProductBySlug(params.slug)
  if (!product) {
    throw error(404, 'Not found')
  }
  return json(product)
}

export const DELETE: RequestHandler = async ({ params }) => {
  deleteProductBySlug(params.slug)
  return json({ success: true })
}
