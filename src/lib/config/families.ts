/**
 * Family Colors
 *
 * The game's own colour for each family, baked from the family palette chain
 * (family.xml `TeamColor` + `iColorIndex` → teamColor.xml → playerColor.xml →
 * color.xml) by `npm run bake:family-colors`. Families belong to exactly one
 * nation, so the family zType alone keys the family × nation colour.
 */

import { FAMILY_COLORS } from "$lib/generated/family-colors";

import { getChartColor } from "./charts";

/**
 * Color for a family in a chart series: the game's own color for it, or a
 * palette color by index for a family the bake doesn't know (mods). The same
 * shape as `getNationChartColor`, and the single source of truth for family
 * color so a family's line and its name render identically.
 *
 * @param family - The `FAMILY_*` zType
 * @param fallbackIndex - Series index used for the palette fallback
 */
export function getFamilyChartColor(
	family: string | null | undefined,
	fallbackIndex: number,
): string {
	if (family) {
		const color = FAMILY_COLORS[family];
		if (color) return color;
	}
	return getChartColor(fallbackIndex);
}
