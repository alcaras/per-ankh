// Per-POP Cache API tier in front of the R2 reads for `games/*`.
//
// Workers run *before* Cloudflare's edge cache, so a body built with
// `new Response()` is never stored at the edge — the `s-maxage` directives on
// the game routes constrain browsers and intermediaries only. Without a tier
// here every blob read is a full round trip to the bucket's ENAM region, for
// every viewer worldwide; R2 buckets are single-region and cannot be
// replicated, so caching is the only lever available. See issue #150.
//
// This caches the *R2 object bytes*, not the HTTP response, and that choice is
// what keeps the invalidation surface to a single path:
//
//   - Authorization is a fresh D1 read on every request, ahead of the R2 read
//     (handleGameDetail, handleGameDownload, and both admin readers all check
//     the games row first). The cache holds bytes, never a decision — so an
//     is_public flip, linkTournamentMatch() forcing a game public, or a delete
//     needs no invalidation at all: the gate re-evaluates and 404s/403s before
//     the cache is ever consulted. That covers the admin CLI's out-of-band
//     `wrangler r2 object delete` too, which drops the games row alongside the
//     object (scripts/admin/commands/games.ts deleteGames).
//   - The response body is the blob merged with D1 metadata (display_name,
//     collection_id, user_nation, user_won, …) *after* the read, and
//     stripOnlineIds runs per request. So metadata edits never stale an entry,
//     and the PII strip is never cached in either direction.
//
// That leaves exactly one event that stales an entry: a re-import overwriting
// the blob with fresh parser output. The key carries the game's parser_version
// so that event *drifts the key* rather than needing a purge — see cacheKey.
//
// Only `games/*` reads go through here today. `saves/*` (the raw ZIP download)
// deliberately does not — see the note at the R2 read in handleGameDownload.

import { beginR2Read, setLogField } from "./log";

// Synthetic key origin — same idiom as the download rate-limit counter in
// share-legacy.ts. R2 keys are `games/{id}.json.gz` where id is a nanoid(21)
// over [A-Za-z0-9_-], so they're URL-path-safe as-is with no escaping.
const CACHE_ORIGIN = "https://blob-cache.internal/r2/";

// 24h, matching the stats bundle cache. The TTL is purely a retention knob
// here, not a staleness bound (see cacheKey), and Cache API entries are evicted
// under POP pressure well before expiry anyway — so a long TTL costs nothing
// and is what gives a low-traffic game any chance of a second reader in the
// same colo hitting a warm entry.
const BLOB_CACHE_TTL_SECONDS = 24 * 60 * 60;

// The game's parser_version is part of the key, mirroring the PARSER_VERSION
// segment in stats/cache.ts (and the `updated_at` segment its tournament keys
// use). A re-import is the only path that overwrites a blob in place, and it
// only runs when the incoming parser_version is strictly newer
// (compareSemver > 0 in handleGameUpload) — which then lands on the games row.
// So the version advances exactly when the bytes change, the key drifts with
// it, and every POP misses at once.
//
// That matters because Cache API entries are per-POP and don't replicate: a
// delete() only clears the colo the Worker ran in, and zone purge can't reach
// these keys at all (they're synthetic, so they belong to no zone). Key drift
// is what makes reparse propagation global instead of local, which in turn is
// what lets the TTL above be long.
function cacheKey(r2Key: string, parserVersion: string): Request {
	return new Request(`${CACHE_ORIGIN}p${parserVersion}/${r2Key}`, {
		method: "GET",
	});
}

// Uncached read. Returns null when the object is absent, which callers map to
// their own BLOB_MISSING response.
//
// r2_ms is accumulated here rather than by wrapping the binding, because
// bucket.get() resolves as soon as the object's metadata is known — the bytes
// move in arrayBuffer(), so timing the get alone would report a fraction of
// the crossing. Wrapping the read is also what keeps the cache hit in
// getBlobCached *out* of r2_ms, which is the whole point of the number.
export async function readBlob(
	bucket: R2Bucket,
	r2Key: string,
): Promise<ArrayBuffer | null> {
	const end = beginR2Read();
	try {
		const obj = await bucket.get(r2Key);
		return obj ? await obj.arrayBuffer() : null;
	} finally {
		end();
	}
}

// Read an R2 object through the per-POP cache, filling it on a miss.
//
// Owners must NOT call this. Their response is `private, no-store` precisely so
// a reload right after a reparse shows the new bytes, and an entry filled in
// another POP would undercut that guarantee. Gating on isOwner also means
// cached bytes are only ever read on the path that strips online_id.
export async function getBlobCached(
	bucket: R2Bucket,
	r2Key: string,
	parserVersion: string,
	ctx: ExecutionContext,
): Promise<ArrayBuffer | null> {
	const cache = caches.default;
	const key = cacheKey(r2Key, parserVersion);

	// blob_cache rides the access log so the tier's hit rate is measurable per
	// route (issue #150). The owner branch tags its direct read `bypass`
	// instead, which is what keeps an absent field meaning "this route read no
	// blob at all" — see handleGameDetail.
	const hit = await cache.match(key);
	if (hit) {
		setLogField("blob_cache", "hit");
		return await hit.arrayBuffer();
	}
	setLogField("blob_cache", "miss");

	const bytes = await readBlob(bucket, r2Key);
	// A missing object isn't cached — negative caching would keep a game
	// unreadable for the whole TTL after an operator restores a blob.
	if (!bytes) return null;

	// Cache-Control is what gives the entry its TTL. This response is only ever
	// handed to the cache, never to a client, so it doesn't interact with the
	// headers the handler builds. waitUntil keeps the fill off the response path.
	ctx.waitUntil(
		cache.put(
			key,
			new Response(bytes, {
				headers: { "Cache-Control": `max-age=${BLOB_CACHE_TTL_SECONDS}` },
			}),
		),
	);
	return bytes;
}

// Best-effort eviction of the entry under the *outgoing* parser_version.
//
// Key drift (see cacheKey) already handles the successful re-import: nothing
// reads the old key again. This covers the documented failure path instead —
// if the D1 batch fails after the R2 put, handleGameUpload deliberately leaves
// the new bytes in place and the old games row intact, so reads keep resolving
// to the old key and are meant to render the fresher data. Without this the
// stale entry would shadow those bytes for the full TTL.
//
// Per-POP, so it only clears the colo the Worker ran in; other colos age out.
export async function invalidateBlob(
	r2Key: string,
	parserVersion: string,
): Promise<void> {
	await caches.default.delete(cacheKey(r2Key, parserVersion));
}
