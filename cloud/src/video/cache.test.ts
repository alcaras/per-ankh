import { describe, expect, it } from "vitest";
import { getVideosCached } from "./cache";
import { UncacheableVideos, type Video, type VideoEnv } from "./types";

const video = (id: string, published_at: string): Video => ({
	id,
	title: id,
	url: `https://www.youtube.com/watch?v=${id}`,
	thumbnail_url: null,
	published_at,
	platform: "youtube",
});

const AIRED = [video("BROADCAST01", "2026-07-31T01:04:43Z")];
const VOD_DATED = [video("BROADCAST01", "2026-07-31T15:27:03Z")];

// The cache only ever get()s and put()s one key, so a Map stands in for KV.
// `puts` records writes, which is what these tests are actually about.
function fakeEnv(): {
	env: VideoEnv;
	store: Map<string, string>;
	puts: string[];
} {
	const store = new Map<string, string>();
	const puts: string[] = [];
	const env = {
		SESSIONS_KV: {
			get: (k: string) => Promise.resolve(store.get(k) ?? null),
			put: (k: string, v: string) => {
				puts.push(k);
				store.set(k, v);
				return Promise.resolve();
			},
		},
	} as unknown as VideoEnv;
	return { env, store, puts };
}

// Collects the background refresh the stale path hands to waitUntil, so a test
// can await it instead of racing it.
function fakeCtx(): { ctx: ExecutionContext; settled: () => Promise<unknown> } {
	const pending: Promise<unknown>[] = [];
	const ctx = {
		waitUntil: (p: Promise<unknown>) => {
			pending.push(p);
		},
	} as unknown as ExecutionContext;
	return { ctx, settled: () => Promise.all(pending) };
}

// Age the single cached entry past the 1h soft TTL. Reads the key back out of
// the store rather than rebuilding it, so this doesn't pin CACHE_VERSION.
function makeStale(store: Map<string, string>): void {
	const [key] = [...store.keys()];
	const entry = JSON.parse(store.get(key) as string) as { fetched_at: number };
	entry.fetched_at = Date.now() - 2 * 60 * 60 * 1000;
	store.set(key, JSON.stringify(entry));
}

describe("getVideosCached", () => {
	it("caches a clean fetch", async () => {
		const { env, puts } = fakeEnv();
		const videos = await getVideosCached(env, "youtube", "UC1", () =>
			Promise.resolve(AIRED),
		);
		expect(videos).toEqual(AIRED);
		expect(puts).toHaveLength(1);
	});

	it("serves a degraded fetch without caching it", async () => {
		const { env, puts } = fakeEnv();
		const videos = await getVideosCached(env, "youtube", "UC1", () =>
			Promise.reject(new UncacheableVideos(VOD_DATED)),
		);
		// Cold miss: better to show the VOD dates than an empty feed — but they
		// must not be persisted, or they'd be served for the whole TTL.
		expect(videos).toEqual(VOD_DATED);
		expect(puts).toHaveLength(0);
	});

	it("keeps a stale entry's good dates when the refresh degrades", async () => {
		const { env, store, puts } = fakeEnv();
		await getVideosCached(env, "youtube", "UC1", () => Promise.resolve(AIRED));
		makeStale(store);
		puts.length = 0;

		const { ctx, settled } = fakeCtx();
		const served = await getVideosCached(
			env,
			"youtube",
			"UC1",
			() => Promise.reject(new UncacheableVideos(VOD_DATED)),
			ctx,
		);
		await settled();

		expect(served).toEqual(AIRED);
		expect(puts).toHaveLength(0);
		const [key] = [...store.keys()];
		expect(
			(JSON.parse(store.get(key) as string) as { videos: Video[] }).videos,
		).toEqual(AIRED);
	});

	it("still swallows a hard fetch failure on a cold miss", async () => {
		const { env, puts } = fakeEnv();
		const videos = await getVideosCached(env, "youtube", "UC1", () =>
			Promise.reject(new Error("youtube feed responded 503")),
		);
		expect(videos).toEqual([]);
		expect(puts).toHaveLength(0);
	});
});
