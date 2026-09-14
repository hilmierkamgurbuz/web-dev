<script lang="ts">
  import ProductCard from '$lib/components/ProductCard.svelte'
  import { trpc } from '$lib/trpc-client'

  const products = await trpc.product.list.query()

  let newSlug = $state('')
  let newName = $state('')
  let newPrice = $state(0)

  async function handleCreate() {
    return trpc.product.create.mutate({ slug: newSlug, name: newName, price: newPrice })
  }

  async function refreshFromRest() {
    const res = await fetch('/api/products')
    return res.json()
  }

  async function handleRemove(slug: string) {
    return fetch(`/api/products/${slug}`, { method: 'DELETE' })
  }

  async function loadReviews() {
    const res = await fetch('/api/reviews')
    return res.json()
  }
</script>

<div>
  {#each products as product (product.id)}
    <ProductCard {product} onRemove={() => handleRemove(product.slug)} />
  {/each}
  <input bind:value={newSlug} placeholder="slug" />
  <input bind:value={newName} placeholder="name" />
  <input bind:value={newPrice} type="number" />
  <button onclick={handleCreate}>Add product</button>
  <button onclick={refreshFromRest}>Refresh</button>
  <button onclick={loadReviews}>Load reviews</button>
</div>
