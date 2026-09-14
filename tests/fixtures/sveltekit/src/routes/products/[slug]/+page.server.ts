import { error } from '@sveltejs/kit'
import { z } from 'zod'
import { requireUser } from '$lib/server/auth'
import { findProductBySlug } from '$lib/server/db'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params }) => {
  const product = findProductBySlug(params.slug)
  if (!product) {
    throw error(404, 'Not found')
  }
  return { product }
}

const AddToCartSchema = z.object({
  quantity: z.coerce.number().int().positive(),
})

export const actions: Actions = {
  default: async ({ request, params }) => {
    const form = await request.formData()
    const product = findProductBySlug(params.slug)
    return { success: true, product, note: form.get('note') }
  },
  addToCart: async ({ request, locals, params }) => {
    requireUser(locals)
    const form = await request.formData()
    const data = AddToCartSchema.parse({ quantity: form.get('quantity') })
    return { success: true, slug: params.slug, quantity: data.quantity }
  },
}
