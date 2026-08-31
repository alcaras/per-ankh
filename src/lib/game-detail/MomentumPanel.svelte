<script lang="ts">
	// Momentum chart + detail panel, the owglick momentum viewer's interaction
	// rebuilt per-ankh: one line for P(first player), the area between the line
	// and the 50% midline filled in whoever-leads' colour, and the numbers for
	// the hovered turn in a stable panel below the chart — hover explores,
	// click pins. No tooltip, no commentary: the panel is the data.
	import { fade } from "svelte/transition";
	import type { ChartOption, ECharts } from "$lib/echarts";
	import type { EventLog } from "$lib/types/EventLog";
	import {
		CHART_THEME,
		CHART_REFERENCE_LINE_COLOR,
		CHART_ACCENT_COLOR,
	} from "$lib/config";
	import Chart from "$lib/Chart.svelte";
	import { formatEnum, stripMarkup } from "$lib/utils/formatting";
	import type { MomentumCurve } from "./momentum";
	import type { DetailPlayer } from "./helpers";

	let {
		curve,
		a,
		b,
		eventLogs = [],
	}: {
		curve: MomentumCurve;
		/** The two duellists, curve orientation: p = P(`a` wins). */
		a: DetailPlayer;
		b: DetailPlayer;
		eventLogs?: EventLog[];
	} = $props();

	// The card has two sides — the chart and the notes on how it's computed —
	// switched by the corner icon and crossfaded in place, the same way the
	// tournament page switches bracket and standings.
	let side = $state<"chart" | "about">("chart");

	// Hover explores, click pins; the panel always shows *some* turn, so it
	// starts pinned on the last point (the finished position).
	let pinned = $state<number | null>(null);
	let hovered = $state<number | null>(null);
	const shown = $derived(
		hovered ?? pinned ?? Math.max(0, curve.points.length - 1),
	);

	const DIM_LABELS: Record<string, string> = {
		growth: "growth",
		orders: "orders",
		science: "science",
		eco: "eco",
		mil: "military",
	};

	// ─── Chart ────────────────────────────────────────────────────────
	// The owglick look: one line, and the area between it and the 50% midline
	// filled in whoever-leads' colour — above the midline `a`'s fill, below it
	// `b`'s. Two silent clamped series carry the fills (max(p,50) / min(p,50)
	// with the area anchored at 50), so no visualMap is needed.
	const chartOption = $derived<ChartOption>({
		...CHART_THEME,
		title: { ...CHART_THEME.title, text: "Momentum" },
		tooltip: { show: false },
		grid: { left: 44, right: 16, top: 44, bottom: 32 },
		xAxis: {
			type: "category",
			data: curve.points.map((pt) => pt.turn),
			// `type: "none"` draws no pointer line — the highlighted point on the
			// curve and the turn label under the axis already say where the
			// reader is. The component stays live either way: it still snaps to
			// the nearest turn and still emits updateAxisPointer, which is what
			// drives the panel below (ECharts builds the label outside the
			// pointer-graphic branch).
			axisPointer: {
				show: true,
				snap: true,
				type: "none",
				label: { backgroundColor: CHART_ACCENT_COLOR, color: "#FFFFFF" },
			},
		},
		yAxis: {
			type: "value",
			min: 0,
			max: 100,
			axisLabel: { formatter: "{value}%" },
		},
		series: [
			{
				type: "line",
				silent: true,
				showSymbol: false,
				data: curve.points.map((pt) =>
					Math.max(50, Math.round(pt.p * 1000) / 10),
				),
				// The axis pointer highlights every series it crosses, and these
				// two clamp to 50, so the midline would grow a dot of its own.
				// `symbol: "none"` is what suppresses it: LineView.highlight
				// builds its temporary symbol without consulting
				// `emphasis.disabled`, but a "none" symbol draws no path.
				symbol: "none",
				lineStyle: { opacity: 0 },
				areaStyle: { origin: 50, color: a.color, opacity: 0.22 },
			},
			{
				type: "line",
				silent: true,
				showSymbol: false,
				data: curve.points.map((pt) =>
					Math.min(50, Math.round(pt.p * 1000) / 10),
				),
				// The axis pointer highlights every series it crosses, and these
				// two clamp to 50, so the midline would grow a dot of its own.
				// `symbol: "none"` is what suppresses it: LineView.highlight
				// builds its temporary symbol without consulting
				// `emphasis.disabled`, but a "none" symbol draws no path.
				symbol: "none",
				lineStyle: { opacity: 0 },
				areaStyle: { origin: 50, color: b.color, opacity: 0.22 },
			},
			{
				type: "line",
				showSymbol: false,
				data: curve.points.map((pt) => Math.round(pt.p * 1000) / 10),
				lineStyle: { width: 2, color: a.color },
				itemStyle: { color: a.color },
				markLine: {
					silent: true,
					symbol: "none",
					label: { show: false },
					lineStyle: {
						color: CHART_REFERENCE_LINE_COLOR,
						type: "solid",
						width: 1,
					},
					data: [{ yAxis: 50 }],
				},
			},
		],
	});

	function wireChart(chart: ECharts): void {
		chart.on("updateAxisPointer", (e) => {
			const info = (e as { axesInfo?: { value: number }[] }).axesInfo?.[0];
			if (info != null) hovered = info.value;
		});
		chart.getZr().on("click", () => {
			if (hovered != null) pinned = hovered;
		});
		chart.getZr().on("globalout", () => {
			hovered = null;
		});
	}

	// ─── Panel data for the shown turn ────────────────────────────────
	const pt = $derived(curve.points[shown]);
	const prev = $derived(shown > 0 ? curve.points[shown - 1] : null);
	const aLeads = $derived(pt.p >= 0.5);
	const leader = $derived(aLeads ? a : b);
	const leadPct = $derived(Math.round((aLeads ? pt.p : 1 - pt.p) * 100));

	type BarRow = { dim: string; v: number };

	/** Display floor for a bar — below this a row is noise, not a story. */
	const BAR_MIN = 0.03;
	/** Everything that moved at all; lv/ch are rounded to 2dp, so ties drop. */
	const BAR_MIN_ANY = 0.01;

	// Contributions flipped toward the named player, so positive always means
	// "helped them"; split into helping and working-against.
	function bars(
		vals: number[],
		towardA: boolean,
		min: number,
	): {
		pos: BarRow[];
		neg: BarRow[];
		max: number;
	} {
		const sgn = towardA ? 1 : -1;
		const rows = curve.dims
			.map((dim, j) => ({ dim, v: Math.round(vals[j] * sgn * 100) / 100 }))
			.filter((r) => Math.abs(r.v) >= min);
		return {
			pos: rows.filter((r) => r.v > 0).sort((x, y) => y.v - x.v),
			neg: rows.filter((r) => r.v < 0).sort((x, y) => x.v - y.v),
			max: Math.max(...rows.map((r) => Math.abs(r.v)), 0.2),
		};
	}

	const levelBars = $derived(bars(pt.lv, aLeads, BAR_MIN));
	const delta = $derived(prev ? pt.p - prev.p : 0);
	const deltaPts = $derived(Math.round(Math.abs(delta) * 100));
	const gainerIsA = $derived(delta >= 0);
	const gainer = $derived(gainerIsA ? a : b);
	// BAR_MIN is per-dimension while the header quotes their sum, so five
	// dimensions each moving just under the floor still add to a move the
	// header prints. When that happens, drop the floor rather than caption a
	// non-zero header with "no dimension moved much" — the bars and the
	// header describe the same number and must never disagree.
	const changeBars = $derived.by(() => {
		if (!prev) return null;
		const shownBars = bars(pt.ch, gainerIsA, BAR_MIN);
		if (shownBars.pos.length > 0 || shownBars.neg.length > 0) return shownBars;
		return deltaPts > 0 ? bars(pt.ch, gainerIsA, BAR_MIN_ANY) : shownBars;
	});

	// Key stats: each side's own numbers, leader-per-row coloured.
	const STAT_ROWS: { label: string; index: number; dp: number }[] = [
		{ label: "growth", index: 0, dp: 1 },
		{ label: "orders", index: 1, dp: 1 },
		{ label: "science", index: 2, dp: 1 },
		{ label: "power", index: 3, dp: 0 },
	];
	const fmtStat = (v: number, dp: number): string =>
		dp ? v.toFixed(1) : Math.round(v).toLocaleString("en-US");

	// Battles aren't in the event log — derive them the owglick way, from
	// military-power drops across the window. Both sides bleeding hard is a
	// trade (named for who lost less); one side collapsing alone is an army
	// destroyed.
	const battleEvents = $derived.by(() => {
		if (!prev) return [];
		const da = pt.sa[3] - prev.sa[3];
		const db = pt.sb[3] - prev.sb[3];
		const out: { kind: string; who: string | null; text: string }[] = [];
		const f = (v: number): string => `${v > 0 ? "+" : ""}${Math.round(v)}`;
		if (da < -25 && db < -25) {
			if (Math.abs(da - db) < 15) {
				out.push({
					kind: "battle",
					who: null,
					text: `battle, even trade (${a.label} ${f(da)} · ${b.label} ${f(db)} power)`,
				});
			} else {
				const [winner, wl, ll] =
					da > db ? [a.label, da, db] : [b.label, db, da];
				out.push({
					kind: "battle",
					who: winner,
					text: `won the trade (${f(wl)} vs ${f(ll)} power)`,
				});
			}
		} else if (da < -60 || db < -60) {
			out.push({
				kind: "battle",
				who: da < db ? a.label : b.label,
				text: `army destroyed (${f(Math.min(da, db))} power)`,
			});
		}
		return out;
	});

	// Events logged in the window since the previous scored turn — data, not
	// attribution.
	const KIND: Record<string, string> = {
		CITY_FOUNDED: "city",
		WONDER_ACTIVITY: "wonder",
		LAW_ADOPTED: "law",
		TECH_DISCOVERED: "tech",
		RELIGION_FOUNDED: "religion",
		THEOLOGY_ESTABLISHED: "theology",
		CHARACTER_SUCCESSION: "succession",
		TEAM_DIPLOMACY: "war",
		OCCURRENCE: "event",
	};
	// The turns these rows cover: everything after the previous scored point, up
	// to this one. Adjacent points make that a single turn; a gap in the scored
	// series (featsAt skips a turn when either side is missing power, orders or
	// science) stretches it. The heading and the filter read the same bound, so
	// they can never disagree about which turns are on screen.
	const eventsFrom = $derived(prev ? prev.turn : pt.turn - 1);
	const eventSpan = $derived(
		eventsFrom < pt.turn - 1 ? `T${eventsFrom + 1}–T${pt.turn}` : `T${pt.turn}`,
	);
	const windowEvents = $derived.by(() =>
		eventLogs
			.filter(
				(e) =>
					e.turn > eventsFrom && e.turn <= pt.turn && KIND[e.log_type] != null,
			)
			.slice(0, 4)
			.map((e) => ({
				kind: KIND[e.log_type],
				who: e.player_name as string | null,
				text: stripMarkup(e.description) || formatEnum(e.log_type, ""),
			})),
	);
	const shownEvents = $derived([...battleEvents, ...windowEvents]);

	const playerFor = (name: string | null): DetailPlayer | null =>
		name === a.player_name || name === a.label
			? a
			: name === b.player_name || name === b.label
				? b
				: null;
</script>

{#snippet barRows(rows: BarRow[], max: number, own: string, other: string)}
	{#each rows as r (r.dim)}
		<div class="flex items-center gap-2 py-0.5 text-xs">
			<span class="w-14 text-tan">{DIM_LABELS[r.dim]}</span>
			<span
				class="h-2 flex-1 overflow-hidden rounded-sm"
				style="background-color: rgb(var(--color-surface));"
			>
				<span
					class="block h-full rounded-sm"
					style="width: {Math.round(
						(Math.abs(r.v) / max) * 100,
					)}%; background-color: {r.v > 0 ? own : other};"
				></span>
			</span>
			<span
				class="w-12 text-right font-mono tabular-nums"
				style="color: {r.v > 0 ? own : other};"
				>{r.v > 0 ? "+" : "−"}{Math.abs(r.v).toFixed(2)}</span
			>
		</div>
	{/each}
{/snippet}

<div
	class="relative rounded-lg p-4"
	style="background-color: rgb(var(--color-surface));"
>
	<button
		type="button"
		onclick={() => (side = side === "about" ? "chart" : "about")}
		class="absolute right-3 top-3 z-10 cursor-pointer p-1.5 text-tan transition-colors hover:text-white"
		aria-label={side === "about"
			? "Back to the chart"
			: "How momentum is calculated"}
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			class="block h-4 w-4"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			stroke-width="2"
			aria-hidden="true"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d={side === "about"
					? "M6 18L18 6M6 6l12 12"
					: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"}
			/>
		</svg>
	</button>

	<div class="view-stack">
		{#key side}
			<div
				class="view-pane"
				in:fade={{ duration: 200 }}
				out:fade={{ duration: 200 }}
			>
				{#if side === "about"}
					<h3 class="mb-3 text-center text-xl font-bold text-white">
						Momentum
					</h3>
					<div class="grid gap-x-6 gap-y-3 md:grid-cols-2">
						<section>
							<div
								class="mb-1 text-[11px] font-bold uppercase tracking-wide text-tan"
							>
								The curve
							</div>
							<p class="text-xs leading-relaxed text-bright">
								One point per turn: the model's probability that <b
									style="color: {a.color};">{a.label}</b
								>
								was ahead, with the gap to the 50% midline filled in whoever leads
								—
								<b style="color: {a.color};">{a.label}</b>
								above it, <b style="color: {b.color};">{b.label}</b> below. Hover
								a turn to read it out below the chart, click to pin it. It is a retrospective
								reading of a finished game, not a forecast: a turn is weighted by
								how far through the match it falls, which needs the final turn to
								be known.
							</p>
						</section>

						<section>
							<div
								class="mb-1 text-[11px] font-bold uppercase tracking-wide text-tan"
							>
								What is scored
							</div>
							<p class="text-xs leading-relaxed text-bright">
								Five differences between the two players at each turn: growth,
								orders and science (yield rates); eco — which side has the
								higher rate for money, food, iron, stone and wood, ±1 apiece;
								and military, the power gap relative to the two sides' average
								power, since absolute power grows many times over across a
								match. Each difference is divided by how far apart duellists
								typically are at that turn, multiplied by a fitted weight and
								summed into log-odds, which the logistic curve turns into the
								percentage. The weights are fitted separately for successive
								stages of a game and interpolated between them, so the same lead
								is worth different amounts at T20 and at T80.
							</p>
						</section>

						<section>
							<div
								class="mb-1 text-[11px] font-bold uppercase tracking-wide text-tan"
							>
								At T… — the numbers
							</div>
							<p class="text-xs leading-relaxed text-bright">
								Each side's own figures at the shown turn — growth, orders and
								science yield rates, and military power — with the higher of the
								pair in that player's colour. The model reads only the
								difference between the two; these are here raw so the arithmetic
								can be checked against the game.
							</p>
						</section>

						<section>
							<div
								class="mb-1 text-[11px] font-bold uppercase tracking-wide text-tan"
							>
								Behind the lead
							</div>
							<p class="text-xs leading-relaxed text-bright">
								The current log-odds split by dimension — weight × standardised
								lead, one bar each — signed so that a positive bar helps the
								leader and the bars add up to the whole lead. Dimensions pulling
								the other way are listed separately, under a heading naming the
								leader they work against. A dimension worth less than 0.03 is
								dropped as noise.
							</p>
						</section>

						<section>
							<div
								class="mb-1 text-[11px] font-bold uppercase tracking-wide text-tan"
							>
								The swing
							</div>
							<p class="text-xs leading-relaxed text-bright">
								The same split applied to the move since the previous scored
								turn: the exact difference between the two turns' contributions,
								so the bars always add up to the heading's swing, and positive
								is toward whoever gained. A tied dimension contributes nothing;
								a steady lead still drifts a little as the weights shift with
								game progress.
							</p>
						</section>

						<section>
							<div
								class="mb-1 text-[11px] font-bold uppercase tracking-wide text-tan"
							>
								Events
							</div>
							<p class="text-xs leading-relaxed text-bright">
								Battles are not in the save's event log, so they are read from
								military power across the window: both sides losing more than 25
								power is a trade, named for whoever lost less; one side alone
								losing more than 60 is an army destroyed. The rest are logged
								events — cities, wonders, laws, techs, religions, successions,
								wars — for the turns since the previous scored point. A turn
								missing either side's power, orders or science is not scored, so
								that window can span several turns. They are context, not
								causes: nothing here is attributed to the swing above.
							</p>
						</section>
					</div>
				{:else}
					<Chart option={chartOption} height="280px" onReady={wireChart} />

					<!-- Detail for the hovered / pinned turn -->
					<div
						class="mt-2 rounded-md border border-border-subtle p-3"
						style="background-color: rgb(var(--color-surface-sunken));"
					>
						<div class="mb-2 flex items-baseline gap-3 text-sm">
							<b class="text-white">T{pt.turn}</b>
							<span class="font-bold" style="color: {leader.color};"
								>{leader.label} {leadPct}%</span
							>
						</div>

						<div class="grid gap-4 md:grid-cols-3">
							<!-- Key stats -->
							<div>
								<div
									class="mb-1 text-[11px] font-bold uppercase tracking-wide text-tan"
								>
									At T{pt.turn}
								</div>
								<table class="w-full text-xs">
									<thead>
										<tr class="text-left">
											<th></th>
											<th class="pb-1 font-semibold" style="color: {a.color};"
												>{a.label}</th
											>
											<th class="pb-1 font-semibold" style="color: {b.color};"
												>{b.label}</th
											>
										</tr>
									</thead>
									<tbody>
										{#each STAT_ROWS as row (row.label)}
											{@const va = pt.sa[row.index]}
											{@const vb = pt.sb[row.index]}
											<tr>
												<td class="py-0.5 pr-2 text-tan">{row.label}</td>
												<td
													class="py-0.5 pr-2 tabular-nums"
													style={va > vb
														? `color: ${a.color}; font-weight: 700;`
														: ""}>{fmtStat(va, row.dp)}</td
												>
												<td
													class="py-0.5 tabular-nums"
													style={vb > va
														? `color: ${b.color}; font-weight: 700;`
														: ""}>{fmtStat(vb, row.dp)}</td
												>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>

							<!-- Level: what's behind the lead -->
							<div>
								<div
									class="mb-1 text-[11px] font-bold uppercase tracking-wide text-tan"
								>
									Behind <span style="color: {leader.color};"
										>{leader.label}</span
									>'s
									{leadPct}%
								</div>
								{@render barRows(
									levelBars.pos,
									levelBars.max,
									leader.color,
									aLeads ? b.color : a.color,
								)}
								{#if levelBars.neg.length > 0}
									<div class="mt-1 text-[10px] italic text-tan">
										against {leader.label}
									</div>
									{@render barRows(
										levelBars.neg,
										levelBars.max,
										leader.color,
										aLeads ? b.color : a.color,
									)}
								{/if}
							</div>

							<!-- Change + events -->
							<div>
								{#if changeBars && prev}
									<div
										class="mb-1 text-[11px] font-bold uppercase tracking-wide text-tan"
									>
										T{prev.turn} → T{pt.turn}:
										<span style="color: {gainer.color};">{gainer.label}</span>
										+{deltaPts} pts
									</div>
									{#if changeBars.pos.length === 0 && changeBars.neg.length === 0}
										<div class="text-xs italic text-tan">
											no dimension moved much
										</div>
									{:else}
										{@render barRows(
											changeBars.pos,
											changeBars.max,
											gainer.color,
											gainerIsA ? b.color : a.color,
										)}
										{@render barRows(
											changeBars.neg,
											changeBars.max,
											gainer.color,
											gainerIsA ? b.color : a.color,
										)}
									{/if}
								{/if}
								{#if shownEvents.length > 0}
									<div
										class="mb-1 mt-2 text-[11px] font-bold uppercase tracking-wide text-tan"
									>
										At {eventSpan}
									</div>
									{#each shownEvents as ev, i (i)}
										<div class="py-0.5 text-xs text-bright">
											<span
												class="mr-1 rounded-sm px-1 text-[9px] uppercase text-tan"
												style="background-color: rgb(var(--color-surface));"
												>{ev.kind}</span
											>{#if ev.who}<b
													style="color: {playerFor(ev.who)?.color ??
														'inherit'};">{ev.who}</b
												>{/if}
											{ev.text.slice(0, 90)}
										</div>
									{/each}
								{/if}
							</div>
						</div>
					</div>
				{/if}
			</div>
		{/key}
	</div>
</div>

<style>
	/* Crossfade the two sides: both panes share one grid cell so the outgoing
	   and incoming overlap in place — no transform, nothing shifts. Mirrors the
	   tournament page's bracket/standings switch. */
	.view-stack {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
	}

	.view-stack > :global(.view-pane) {
		grid-area: 1 / 1;
		min-width: 0;
	}
</style>
