<script lang="ts">
	// The tournament's top-right action cluster, shared by the overview header and
	// the matches page so Links / Settings / the clock toggles read identically on
	// both. It owns its own flex row (gap-2) and is dropped into a wider header
	// row. SignedUp deliberately stays out of here — it's a membership action, not
	// page chrome — so the overview header renders it alongside this cluster.
	import type { TournamentDetail } from "$lib/api-cloud";
	import type { ScheduleZone } from "./schedule";
	import {
		clockFaceIs12Hour,
		setClockFace,
	} from "$lib/stores/clock-face.svelte";
	import { shortTimeZoneName } from "$lib/utils/formatting";
	import SettingsPopover from "./SettingsPopover.svelte";
	import TournamentLinksMenu from "./TournamentLinksMenu.svelte";

	interface Props {
		tournament: TournamentDetail;
		// Opens the tournament guide (threaded to the links menu).
		onGuide: () => void;
		// The active clock. Omitted on surfaces with no time-bearing content (e.g. a
		// setup-phase overview page), where the toggle is hidden entirely.
		zone?: ScheduleZone;
		// Flip handler; the caller persists the choice app-wide (writeZoneCookie).
		// eslint-disable-next-line no-unused-vars -- callback signature
		onZoneChange?: (zone: ScheduleZone) => void;
	}

	let { tournament, onGuide, zone, onZoneChange }: Props = $props();

	// Settings shows for admins always, and for everyone once the tournament is
	// past setup (mirrors the gate this cluster replaced in TournamentHeader).
	const showSettings = $derived(
		tournament.is_viewer_admin === true || tournament.status !== "setup",
	);

	// Shared pill styling for this cluster's own triggers (the two clock toggles)
	// — matching the Links/Settings triggers beside it, which style themselves.
	// inline-flex leaves room for a button's leading icon.
	const triggerClass =
		"inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-tan px-2.5 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange";

	// The local button shows the viewer's actual zone (e.g. "PDT") rather than a
	// bare "Local", matching the abbreviation on the match times themselves. Falls
	// back to "Local" if the environment can't resolve one (also the SSR case,
	// where it would otherwise read "UTC" — corrected on hydration).
	const localZoneLabel = $derived(shortTimeZoneName() || "Local");

	// The viewer's clock face, for the toggle beside the zone one. Read from the
	// module singleton rather than threaded as a prop like `zone`: the face is
	// viewer-global — it governs every local time the app renders — where the
	// active zone is per-tournament state the layout owns and provides.
	const use12Hour = $derived(clockFaceIs12Hour());
</script>

<div class="flex flex-shrink-0 items-center gap-2">
	<TournamentLinksMenu {tournament} {onGuide} />
	{#if showSettings}
		<SettingsPopover {tournament} />
	{/if}
	{#if zone && onZoneChange}
		<!-- Single toggle button: shows the active clock and flips UTC↔local in
		     place on click (one click to switch, unlike a two-segment slider). The
		     choice is sticky app-wide via the caller's cookie write. -->
		<button
			type="button"
			class={triggerClass}
			onclick={() => onZoneChange?.(zone === "utc" ? "local" : "utc")}
			title="Toggle between UTC and your local time"
			aria-label={`Showing ${zone === "utc" ? "UTC" : "local"} time; switch to ${
				zone === "utc" ? "local" : "UTC"
			}`}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-3.5 w-3.5 opacity-80"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
				/>
			</svg>
			{zone === "utc" ? "UTC" : localZoneLabel}
		</button>
		<!-- Clock-face toggle. The pair answers "when is this for me": the button
		     before it picks which clock a time is read on, this one picks how that
		     clock is written. Flips 12↔24 in place and sticks app-wide (pa_clock).
		     No icon — a second clock glyph beside the zone button's would read as
		     the same control twice. It rides the zone toggle's gate rather than
		     appearing only on the local clock, because the match card renders a
		     local half beside the canonical UTC one whichever way the zone is set. -->
		<button
			type="button"
			class={triggerClass}
			onclick={() => setClockFace(use12Hour ? "24" : "12")}
			title="Toggle between a 12-hour (7:30 PM) and 24-hour (19:30) clock"
			aria-label={`Showing a ${use12Hour ? "12" : "24"}-hour clock; switch to ${
				use12Hour ? "24" : "12"
			}-hour`}
		>
			{use12Hour ? "12h" : "24h"}
		</button>
	{/if}
</div>
