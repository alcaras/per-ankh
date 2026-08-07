// The shared key the integration Worker accepts as "this came from our SSR
// Worker" (SSR_TRUSTED_KEY, checked by adoptTrustedFrontend in
// cloud/src/util.ts).
//
// vitest.config.mts binds this value and ssrHeaders() presents it — both
// import it from here so they can't drift. Not a secret: it only has meaning
// against a Worker configured with the same string, and this one is a test
// isolate.
export const SSR_TRUSTED_TEST_KEY = "test-ssr-trusted-key";

// Headers a server-rendered page load arrives with: the frontend Worker's key
// plus the visitor's address, which is the whole point — the request itself
// comes from Cloudflare's SSR egress (`CF-Connecting-IP` below) and what the
// API must count is the visitor.
//
// The visitor's User-Agent is deliberately not among them. It doesn't survive
// the hop either, and forwarding it would hand the scraper exemption in
// games.ts to anyone who types `Discordbot/2.0` — see the SSR block in
// cloud/src/util.ts. So an SSR request carries no UA at all, which is the
// shape these tests are written against.
export function ssrHeaders(opts: {
	clientIp: string;
	// The address the subrequest itself arrives from — one shared egress in
	// production, so it defaults to a single fixed value here for the same
	// reason: any test that leaks it into a counter should collide loudly.
	egressIp?: string;
	// Presented instead of the real key, for the spoofing cases.
	key?: string;
	// Drop CF-RAY, which we don't control on a Worker-to-Worker subrequest.
	// The key is the stronger signal and getClientIp treats it that way.
	omitCfRay?: boolean;
}): Record<string, string> {
	const headers: Record<string, string> = {
		"CF-Connecting-IP": opts.egressIp ?? "203.0.113.200",
		"X-SSR-Key": opts.key ?? SSR_TRUSTED_TEST_KEY,
		"X-SSR-Client-IP": opts.clientIp,
	};
	if (!opts.omitCfRay) headers["CF-RAY"] = "test-ray";
	return headers;
}
