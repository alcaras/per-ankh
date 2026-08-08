// Shared types for the ui/ design-system components.

// A floating-ui "virtual" anchor — anything exposing getBoundingClientRect.
// Lets callers anchor a popover to a point (e.g. the mouse position) rather
// than a DOM element. Mirrors bits-ui's customAnchor, which accepts this same
// shape; Popover's `customAnchor` prop and every pointer-anchored caller
// (MatchDetailPopover) speak in this one type rather than re-declaring it.
export type Measurable = { getBoundingClientRect: () => DOMRect };

export type SelectOption = {
	// "" is a legal value (used for placeholder / "all" entries).
	value: string;
	label: string;
	disabled?: boolean;
};

export type SelectGroup = {
	heading: string;
	options: SelectOption[];
};

export type SelectOptions = readonly SelectOption[] | readonly SelectGroup[];

export function isSelectGroup(
	entry: SelectOption | SelectGroup,
): entry is SelectGroup {
	return "options" in entry;
}
