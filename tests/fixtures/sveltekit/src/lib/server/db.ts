import { DATABASE_URL } from '$env/static/private'

export const connectionString = DATABASE_URL

export type Product = {
  id: string
  slug: string
  name: string
  price: number
}

export const products: Product[] = [
  { id: '1', slug: 'widget', name: 'Widget', price: 19.99 },
  { id: '2', slug: 'gadget', name: 'Gadget', price: 29.99 },
]

export function findProductBySlug(slug: string) {
  return products.find((product) => product.slug === slug)
}

export function createProduct(data: { slug: string; name: string; price: number }) {
  const product = { id: crypto.randomUUID(), ...data }
  products.push(product)
  return product
}

export function deleteProductBySlug(slug: string) {
  const index = products.findIndex((product) => product.slug === slug)
  if (index !== -1) {
    products.splice(index, 1)
  }
}
