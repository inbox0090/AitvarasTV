<script>
  import { onMount } from "svelte"
  import { getActiveEntry } from "@/scripts/lib/creds.js"
  import { getCached, hydrate as hydrateCache } from "@/scripts/lib/cache.js"
  import { fmtImdbRating } from "@/scripts/lib/format.js"
  import { cachedImg } from "@/scripts/lib/img-cache.ts"

  const ROW_LIMIT = 12
  let rows = $state([])

  const text = (value) => String(value || "").trim()
  const categoryOf = (movie) => text(movie.categoryName || movie.category_name || movie.genre || movie.genres)
  const ratingOf = (movie) => Number(movie.rating) || 0
  const addedOf = (movie) => Number(movie.added || movie.added_at || movie.created_at) || 0

  function uniqueMovies(items) {
    const seen = new Set()
    return items.filter((movie) => {
      const id = String(movie?.id ?? "")
      if (!id || seen.has(id)) return false
      seen.add(id)
      return movie && movie.logo
    })
  }

  function buildRows(items) {
    const base = uniqueMovies(items)
    const trending = [...base].sort((a, b) => (ratingOf(b) * 100000 + addedOf(b)) - (ratingOf(a) * 100000 + addedOf(a)))
    const newest = [...base].sort((a, b) => addedOf(b) - addedOf(a))
    const topRated = [...base].sort((a, b) => ratingOf(b) - ratingOf(a))
    const featuredGenres = base.filter((movie) => /action|drama|comedy|thriller|kriminal|veiksmo|drama/i.test(categoryOf(movie)))
    return [
      { id: "trending", title: "Trending now", eyebrow: "Popular with your library", items: trending.slice(0, ROW_LIMIT) },
      { id: "new", title: "New on your shelf", eyebrow: "Recently added", items: newest.slice(0, ROW_LIMIT) },
      { id: "top", title: "Top rated movies", eyebrow: "Highest audience scores", items: topRated.slice(0, ROW_LIMIT) },
      ...(featuredGenres.length ? [{ id: "genres", title: "Genre spotlight", eyebrow: "Stories worth the evening", items: featuredGenres.slice(0, ROW_LIMIT) }] : []),
    ].filter((row) => row.items.length)
  }

  async function reload() {
    const active = await getActiveEntry()
    if (!active) { rows = []; return }
    await hydrateCache(active._id, "vod").catch(() => {})
    rows = buildRows(getCached(active._id, "vod")?.data || [])
  }

  onMount(() => {
    reload()
    const events = ["xt:active-changed", "xt:catalog-warmed", "xt:entries-updated"]
    for (const eventName of events) document.addEventListener(eventName, reload)
    return () => events.forEach((eventName) => document.removeEventListener(eventName, reload))
  })
</script>

{#if rows.length}
  <div class="curated-movie-rows" aria-label="Movie collections">
    {#each rows as row (row.id)}
      <section class="curated-movie-row" aria-labelledby={`curated-${row.id}`}>
        <div class="curated-movie-row__head">
          <div>
            <p>{row.eyebrow}</p>
            <h2 id={`curated-${row.id}`}>{row.title}</h2>
          </div>
          <span>{row.items.length} titles</span>
        </div>
        <div class="curated-movie-row__rail" tabindex="0">
          {#each row.items as movie, idx (movie.id)}
            <a class="curated-movie-card" href={`/movies/detail?id=${encodeURIComponent(movie.id)}`} style={`--row-delay:${Math.min(idx, 8) * 24}ms`}>
              <div class="curated-movie-card__poster">
                <img use:cachedImg={{ url: movie.logo, kind: "poster" }} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="240" height="360" />
                <span class="curated-movie-card__play" aria-hidden="true">▶</span>
                {#if movie.rating}
                  <span class="curated-movie-card__rating">★ {fmtImdbRating(movie.rating)}</span>
                {/if}
              </div>
              <span class="curated-movie-card__name">{movie.name || "Movie"}</span>
              <span class="curated-movie-card__meta">{movie.year || "Movie"} <b>•</b> {categoryOf(movie) || "Feature"}</span>
            </a>
          {/each}
        </div>
      </section>
    {/each}
  </div>
{/if}
