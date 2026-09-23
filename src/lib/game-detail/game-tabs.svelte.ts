// The tabs of a game's analysis, shared by the two views that show them: the
// analyst view's tab strip (/games/[id]) and the map view's menu icons and
// lightboxes (/games/[id]/map). GameTab renders one tab by its id; this module
// holds which tabs a game has, and the state they keep across tabs.
import { getContext, setContext } from "svelte";
import type { FullGameData } from "$lib/parser/types";
import {
	PLAYER_CHART_KEYS,
	createDefaultChartFilters,
	createDefaultTableStates,
	createDefaultCityVisibleColumns,
	createDefaultSelection,
} from "./helpers";
import type { TimelineCategory } from "./helpers";

// The URL hash names (#military). A shared link carries them, so they don't
// follow the label: the Yields tab's id is `economics`.
export type GameTabId =
	| "overview"
	| "events"
	| "leaders"
	| "laws"
	| "techs"
	| "orders"
	| "economics"
	| "military"
	| "cities"
	| "economy"
	| "wonders"
	| "families"
	| "specialists"
	| "settings";

type GameTabEntry = {
	id: GameTabId;
	label: string;
	// For a tab some games have nothing for: it shows only when this passes.
	gate?: (game: FullGameData) => boolean;
};

// The Leaders tab only appears when the blob has rulers — pre-2.8.0 games
// have none. `characters` is absent from blobs parsed before it existed.
function hasLeaders(game: FullGameData): boolean {
	return (game.characters ?? []).some((c) => c.became_leader_turn != null);
}

// In display order.
const GAME_TABS: GameTabEntry[] = [
	{ id: "overview", label: "Overview" },
	// Timeline tab hidden pending redesign
	// { id: "timeline", label: "Timeline" },
	{ id: "events", label: "Events" },
	{ id: "leaders", label: "Leaders", gate: hasLeaders },
	{ id: "laws", label: "Laws" },
	{ id: "techs", label: "Techs" },
	{ id: "orders", label: "Orders" },
	{ id: "economics", label: "Yields" },
	{ id: "military", label: "Military" },
	{ id: "cities", label: "Cities" },
	{ id: "economy", label: "Economy" },
	{ id: "wonders", label: "Wonders" },
	{ id: "families", label: "Families" },
	{ id: "specialists", label: "Specialists" },
	{ id: "settings", label: "Settings" },
];

// The tabs this game has, in display order.
export function gameTabs(game: FullGameData): GameTabEntry[] {
	return GAME_TABS.filter((tab) => tab.gate?.(game) ?? true);
}

// Tabs that have been renamed, so links shared before the rename still land
// somewhere. A hash with no matching tab renders an empty tab pane, and
// #improvements has been a shareable link for as long as the tab existed.
const RENAMED_TABS: Record<string, GameTabId> = { improvements: "economy" };

// The tab a hash names, following renames.
export function resolveTabId(id: string): string {
	return RENAMED_TABS[id] ?? id;
}

// The filter and table state the tabs bind: chart selections, table search and
// sort, the Cities tab's visible columns. It has to outlive any one tab, so the
// view hosting the tabs owns it — switching tabs, or reopening a lightbox,
// keeps it. The host constructs one while it initialises (the effects that
// seed the default chart selections belong to the host component) and provides
// it via context, which is how each GameTab below it binds to it.
export class GameTabState {
	chartFilters = $state(createDefaultChartFilters());
	tables = $state(createDefaultTableStates());
	cityVisibleColumns = $state(createDefaultCityVisibleColumns());
	// TimelineTab's, kept for when that tab returns (hidden pending redesign;
	// see GameTab).
	timelineFilters = $state<Record<TimelineCategory, boolean>>({
		tech: true,
		law: true,
		city: true,
		religion: false,
		wonder: false,
		battle: false,
	});

	constructor(game: () => FullGameData) {
		$effect(() => {
			const playerHistory = game().player_history;
			if (playerHistory) {
				const defaultSelection = createDefaultSelection(playerHistory);
				for (const key of PLAYER_CHART_KEYS) {
					this.chartFilters[key] = { ...defaultSelection };
				}
			}
		});

		$effect(() => {
			const lawAdoptionHistory = game().law_adoption_history;
			if (lawAdoptionHistory) {
				this.chartFilters.laws = createDefaultSelection(lawAdoptionHistory);
			}
		});

		$effect(() => {
			const techDiscoveryHistory = game().tech_discovery_history;
			if (techDiscoveryHistory) {
				this.chartFilters.techs = createDefaultSelection(techDiscoveryHistory);
			}
		});
	}
}

const KEY = Symbol("game-tab-state");

export function setGameTabState(state: GameTabState): GameTabState {
	return setContext(KEY, state);
}

export function getGameTabState(): GameTabState {
	return getContext(KEY);
}
