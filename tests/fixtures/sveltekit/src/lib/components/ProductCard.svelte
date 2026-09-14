<script lang="ts">
  let { product, onRemove } = $props<{
    product: { id: string; slug: string; name: string; price: number }
    onRemove?: () => void
  }>()
</script>

<div>
  <h2>{product.name}</h2>
  <p>{product.price}</p>
  {#if onRemove}
    <button onclick={onRemove}>Remove</button>
  {/if}
</div>
