// A shared, low-frequency reactive clock in epoch milliseconds. Time-relative
// display helpers (match status, schedule ordering, "up next" filtering) read
// `nowMs()` so any Svelte $derived or template that transitively calls them
// recomputes as the clock crosses a scheduled time. Without it a match keeps
// reading "Scheduled" past its start time — and an already-played sitting
// lingers in "Up next" — until an unrelated navigation forces a re-render.
//
// Ticks every 30s (scheduled times are minute-precision, so this bounds the
// visible lag well under a minute) and only in the browser; the server reads
// the clock directly instead — see nowMs.
let now = $state(Date.now());

if (typeof window !== "undefined") {
	setInterval(() => {
		now = Date.now();
	}, 30_000);
}

// Reactive current time (epoch ms). Reading this inside a reactive context (a
// $derived, $effect, or component template) subscribes to the 30s tick; reading
// it anywhere else just returns the current value.
export function nowMs(): number {
	// The server reads the clock directly rather than the module value. `now` is
	// seeded when the module is instantiated, which under adapter-cloudflare is
	// once per ISOLATE — and an isolate serves requests for minutes or hours, so
	// an SSR pass could be rendering against a clock that far behind. That paint
	// then disagrees with the hydrated one about which sittings are live, and
	// every surface built on the split visibly reshuffles on load: rows appear,
	// a LIVE badge flows in, a panel changes height. Workers freezes Date.now()
	// between I/O, so every call inside one synchronous render still returns the
	// same instant — the single-pass consistency the seeded value was for,
	// without the staleness.
	if (typeof window === "undefined") return Date.now();
	return now;
}
