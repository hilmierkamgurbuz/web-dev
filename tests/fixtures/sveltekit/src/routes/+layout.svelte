<script lang="ts">
  import SiteHeader from '$lib/components/SiteHeader.svelte'
  let { children } = $props()
</script>

<SiteHeader />
{@render children()}
