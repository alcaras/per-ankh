// The viewer's sticky 12/24-hour clock FACE — whether a local time reads
// "7:30 PM" or "19:30". Companion to the UTC/local zone preference (pa_zone,
// $lib/tournament/zone-preference): that one picks which clock a time is read
// on, this one picks how that clock is written.
//
// Unset means "follow the browser", which is what every viewer got before this
// control existed. An explicit choice exists because the browser cannot answer
// the question: every OS has a 24-hour setting and none of them expose it to
// JS, so Intl answers from the LANGUAGE instead. CLDR ships no en-XX tailoring
// for Belarus, Russia, Brazil, Türkiye, China or most of the Balkans, so an
// English-language browser in any of them falls back to bare "en" and reports
// an American face to a reader whose own OS writes 19:00. Western Europe is
// unaffected — en-DE, en-FR, en-PL and friends all have tailorings and already
// read 24-hour.
//
// A module singleton rather than per-tournament context (ZoneClock): the face
// is a property of the viewer, not of a tournament, and governs any local time
// the app renders. Calling clockFaceIs12Hour() inside a template or $derived
// subscribes to it, so a flip re-renders every time on the page — the same
// mechanism nowMs() uses in now.svelte.ts.
import { viewerUses12Hour } from "$lib/utils/formatting";

export type ClockFace = "12" | "24";

const COOKIE = "pa_clock";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function isFace(v: string | null | undefined): v is ClockFace {
	return v === "12" || v === "24";
}

// The saved face, or null when unset / on the server (no document).
function readClockCookie(): ClockFace | null {
	if (typeof document === "undefined") return null;
	const match = document.cookie.match(/(?:^|;\s*)pa_clock=(12|24)(?:;|$)/);
	return isFace(match?.[1]) ? match[1] : null;
}

// Persist app-globally (path=/) for a year, mirroring writeZoneCookie:
// SameSite=Lax is plenty for a non-sensitive UI pref, and JS owns it so there's
// no HttpOnly.
function writeClockCookie(face: ClockFace): void {
	if (typeof document === "undefined") return;
	document.cookie = `${COOKIE}=${face}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}

// Seeded at module load — on the client that's app bootstrap, before the first
// component renders, so a saved face is already in place for the first paint
// after hydration. On the server there's no document and this stays null, so
// the singleton never carries a choice between requests.
let face = $state<ClockFace | null>(readClockCookie());

/**
 * Whether local times should render on a 12-hour face ("7:30 PM") rather than a
 * 24-hour one ("19:30") — the viewer's explicit choice when they've made one,
 * otherwise whatever their browser reports. Pass the result to the schedule
 * formatters in $lib/utils/formatting; read it in a template or $derived and a
 * flip re-renders the surface.
 */
export function clockFaceIs12Hour(): boolean {
	return face === null ? viewerUses12Hour() : face === "12";
}

/**
 * Record an explicit face and remember it app-wide for a year. Called only from
 * the header toggle, so the cookie is written on a real choice and never on a
 * passive render (mirroring ZoneClock.set).
 */
export function setClockFace(next: ClockFace): void {
	face = next;
	writeClockCookie(next);
}
