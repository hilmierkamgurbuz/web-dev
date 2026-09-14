<script lang="ts">
  import ProductCard from '$lib/components/ProductCard.svelte'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()
</script>

<ProductCard product={data.product} />

<form method="POST" action="?/addToCart">
  <input type="number" name="quantity" value="1" />
  <button type="submit">Add to cart</button>
</form>
