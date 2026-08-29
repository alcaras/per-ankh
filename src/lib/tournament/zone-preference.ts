// Sticky UTC/local clock preference, shared app-wide by every match-time
// surface (the matches page toggle and the overview's Up Next panel). The
// choice persists in a long-lived, JS-readable cookie so it survives reloads
// and carries across tournaments — toggle once and every clock remembers it.
//
// Resolution precedence (see resolveInitialZone): an explicit ?zone= query
// param wins (so a shared deep link forces a clock for the recipient), then the
// saved cookie, then the visitor's local time as the default. The cookie is
// written only on an explicit toggle, so visiting someone's ?zone= link never
// silently overwrites your own saved default.
//
// Read/written client-side via document.cookie: the tournament routes use
// universal loads only (no +*.server.ts), so there's no server load to read the
// cookie during SSR — and "local" times re-render on hydration anyway (the
// worker runs UTC). The cookie substrate still leaves the door open to a
// server-side read later without migrating storage.
import type { ScheduleZone } from "./schedule";
import { readPrefCookie, writePrefCookie } from "$lib/utils/pref-cookie";

const COOKIE = "pa_zone";

function isZone(v: string | null | undefined): v is ScheduleZone {
	return v === "utc" || v === "local";
}

// The saved clock preference, or null when unset / on the server (no document).
// An unrecognised value is treated as unset rather than trusted.
export function readZoneCookie(): ScheduleZone | null {
	const saved = readPrefCookie(COOKIE);
	return isZone(saved) ? saved : null;
}

// Persist the clock preference app-globally; the cookie policy itself (path,
// lifetime, SameSite) lives in pref-cookie, shared with the clock face.
export function writeZoneCookie(zone: ScheduleZone): void {
	writePrefCookie(COOKIE, zone);
}

// The clock a surface should open on: explicit ?zone= param first (deep-link
// override), then the saved cookie, then local. `param` is the raw query value
// (pass null on surfaces without a query param, like the overview panel).
export function resolveInitialZone(param: string | null): ScheduleZone {
	if (isZone(param)) return param;
	return readZoneCookie() ?? "local";
}
