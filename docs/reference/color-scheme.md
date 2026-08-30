# Color Scheme Reference

This document defines the color palettes used throughout the Per-Ankh application.

## UI Color Palette

The UI color scheme is defined in `src/app.css` (`:root`) as the single source of truth; `tailwind.config.js` references these variables. Colors are stored as **space-separated RGB channels** (e.g. `--color-tan: 210 180 140`) and wired into Tailwind as `rgb(var(--color-x) / <alpha-value>)`, so every token takes opacity modifiers (`bg-tan/15`).

> Because the variables hold channels, not hex, a **direct** CSS use must wrap them in `rgb()`: `color: rgb(var(--color-tan));` or `rgb(var(--color-tan) / 0.4)`. Plain `var(--color-tan)` will not resolve to a color.

### Base palette

| Color           | RGB           | CSS Variable          | Tailwind Class                              | Usage                    |
| --------------- | ------------- | --------------------- | ------------------------------------------- | ------------------------ |
| **Black**       | `0 0 0`       | `--color-black`       | `bg-black`, `text-black`, `border-black`    | Borders, outlines, text  |
| **Brown**       | `165 42 42`   | `--color-brown`       | `bg-brown`, `text-brown`, `border-brown`    | Labels, accents          |
| **Dark Brown**  | `121 38 29`   | `--color-dark-brown`  | `bg-dark-brown`                             | Accents                  |
| **Orange**      | `255 165 0`   | `--color-orange`      | `bg-orange`, `text-orange`, `border-orange` | Highlights, borders      |
| **Tan**         | `210 180 140` | `--color-tan`         | `bg-tan`, `text-tan`, `border-tan`          | Tabs, primary text       |
| **Tan Hover**   | `210 180 140` | `--color-tan-hover`   | `bg-tan-hover`, `hover:bg-tan-hover`        | Hover states             |
| **White**       | `255 255 255` | `--color-white`       | `bg-white`, `text-white`, `border-white`    | Text on dark backgrounds |
| **Yellow**      | `255 255 0`   | `--color-yellow`      | `bg-yellow`, `text-yellow`, `border-yellow` | Reserved for future use  |
| **Blue-Gray**   | `33 26 18`    | `--color-blue-gray`   | `bg-blue-gray`                              | Main background          |
| **Border Gray** | `28 22 15`    | `--color-border-gray` | `bg-border-gray`, `border-border-gray`      | Alternative borders      |
| **Gray 200**    | `238 238 238` | `--color-gray-200`    | `bg-gray-200`, `text-gray-200`              | Skeletons, light text    |

### Surface ramp & semantic tokens

Dark-brown chrome consolidated from drift during fast iteration. The `surface-*`
ramp goes darkest → lightest, each base with its hover step.

| Token                  | RGB           | (was)     | Tailwind                       | Usage                                    |
| ---------------------- | ------------- | --------- | ------------------------------ | ---------------------------------------- |
| `surface-deep`         | `26 21 16`    | `#1a1510` | `bg-surface-deep`              | Deepest inset (sprite-map backdrop)      |
| `surface-sunken`       | `36 31 27`    | `#241f1b` | `bg-surface-sunken`            | Recessed: dropdowns, calendars, fields   |
| `surface-sunken-hover` | `50 44 38`    | `#322c26` | `bg-surface-sunken-hover`      | Hover on sunken                          |
| `surface`              | `42 38 34`    | `#2a2622` | `bg-surface`                   | Cards, sections, stat tiles              |
| `surface-hover`        | `62 56 51`    | `#3e3833` | `bg-surface-hover`             | Row/cell/card hover                      |
| `surface-raised`       | `53 48 43`    | `#35302b` | `bg-surface-raised`            | Inputs, raised cards, menus, popovers    |
| `surface-raised-hover` | `64 58 51`    | `#403a33` | `bg-surface-raised-hover`      | Hover on raised                          |
| `bright`               | `219 222 227` | `#DBDEE3` | `text-bright`                  | Bright value / title text                |
| `muted`                | `122 106 85`  | `#7a6a55` | `text-muted`                   | Muted labels                             |
| `placeholder`          | `197 195 194` | `#c5c3c2` | `placeholder:text-placeholder` | Input placeholders                       |
| `input`                | `74 67 59`    | `#4a433b` | `border-input`                 | Input borders                            |
| `input-focus`          | `90 82 74`    | `#5a524a` | `focus:border-input-focus`     | Input focus / selected                   |
| `border-subtle`        | `58 53 47`    | `#3a352f` | `border-border-subtle`         | Subtle dividers                          |
| `border-tooltip`       | `58 47 36`    | `#3a2f24` | `border-border-tooltip`        | Tooltip header border                    |
| `track`                | `74 69 64`    | `#4a4540` | `bg-track`                     | Slider track                             |
| `tan-light`            | `232 216 184` | `#e8d8b8` | `text-tan-light`, `bg-tan-light` | Bracket strokes/borders (low opacity)  |
| `success`              | `140 200 120` | —         | `text-success`, `bg-success`   | Advance / win                            |
| `success-surface`      | `42 58 36`    | `#2a3a24` | `bg-success-surface`           | Success badge background                 |
| `danger`               | `200 110 90`  | —         | `text-danger`, `bg-danger`     | Eliminate / loss                         |
| `danger-surface`       | `58 38 34`    | `#3a2622` | `bg-danger-surface`            | Danger badge background                  |

### Default Theme

- **Background**: Blue-Gray (`var(--color-blue-gray)`)
- **Text**: White (`var(--color-white)`)

### Using UI Colors

**Best Practice**: Use Tailwind classes in your Svelte components for consistency:

```svelte
<!-- Example: Using Tailwind classes -->
<div class="border-2 border-black bg-surface text-tan">Content here</div>
```

For custom CSS where Tailwind isn't available, wrap the channel variable in `rgb()`:

```css
.custom-scrollbar::-webkit-scrollbar-thumb {
	background-color: rgb(var(--color-tan) / 0.55);
}
```

> **Chart/canvas colors are not these tokens.** ECharts renders to `<canvas>`,
> which cannot resolve CSS variables, so the chart palette (below) and the
> terrain / nation color maps in `src/lib/config/` stay literal hex.

---

## Chart Color Palette

The application uses a separate color palette for data visualization in charts. This palette is defined in `src/lib/config/charts.ts` and optimized for multi-series data visualization using Apache ECharts.

| Color Name         | Hex Code  | Export            |
| ------------------ | --------- | ----------------- |
| **Copper**         | `#C87941` | `CHART_COLORS[0]` |
| **Saddle Brown**   | `#8B4513` | `CHART_COLORS[1]` |
| **Peru**           | `#CD853F` | `CHART_COLORS[2]` |
| **Sienna**         | `#A0522D` | `CHART_COLORS[3]` |
| **Chocolate**      | `#D2691E` | `CHART_COLORS[4]` |
| **Dark Goldenrod** | `#B8860B` | `CHART_COLORS[5]` |

### Using Chart Colors

Import chart colors and theme from the config module:

```typescript
import { CHART_COLORS, CHART_THEME, getChartColor } from "$lib/config";

// Use individual colors directly
const color = CHART_COLORS[0]; // "#C87941"

// Use the helper function for automatic wrapping (RECOMMENDED)
const color = getChartColor(7); // Wraps to CHART_COLORS[1]

// Apply the theme to chart options (RECOMMENDED)
const chartOption: EChartsOption = {
	...CHART_THEME, // Includes colors, title styling, tooltip defaults
	title: {
		...CHART_THEME.title,
		text: "My Chart Title", // Override specific properties
	},
	// ... rest of chart config
};
```

### Design Rationale: Why Separate Palettes?

The application maintains two distinct color palettes for different purposes:

1. **UI Palette** (CSS Variables + Tailwind)
   - For interface elements (backgrounds, borders, text)
   - Fixed set of colors with semantic meaning
   - Defined in CSS for maximum flexibility
   - Optimized for UI consistency and branding
   - Runtime themeable if needed

2. **Chart Palette** (TypeScript Constants)
   - For data visualization in ECharts
   - Optimized for visual distinction between data series
   - Higher contrast requirements for readability
   - Needs more variation for multi-player scenarios (6+ colors)
   - Color selection based on perceptual difference rather than branding
   - Type-safe with helper functions

---

## Nation and Tribe Colors

The application uses specific colors for each Old World nation and tribe. These colors are defined in `src/lib/config/nations.ts` and are used in charts and visualizations to represent different civilizations.

### Nations

| Nation        | Hex Code  | Color Description | Export                    |
| ------------- | --------- | ----------------- | ------------------------- |
| **Aksum**     | `#F8A3B4` | Pink/Rose         | `NATION_COLORS.AKSUM`     |
| **Assyria**   | `#FADC3B` | Yellow            | `NATION_COLORS.ASSYRIA`   |
| **Babylonia** | `#82C83E` | Green             | `NATION_COLORS.BABYLONIA` |
| **Carthage**  | `#F6EFE1` | Beige/Off-white   | `NATION_COLORS.CARTHAGE`  |
| **Egypt**     | `#BC6304` | Dark Orange/Brown | `NATION_COLORS.EGYPT`     |
| **Greece**    | `#2360BC` | Dark Blue         | `NATION_COLORS.GREECE`    |
| **Hittite**   | `#80E3E8` | Cyan              | `NATION_COLORS.HITTITE`   |
| **Kush**      | `#FFFFB6` | Light Yellow      | `NATION_COLORS.KUSH`      |
| **Maurya**    | `#A749FF` | Purple            | `NATION_COLORS.MAURYA`    |
| **Persia**    | `#C04E4A` | Red               | `NATION_COLORS.PERSIA`    |
| **Rome**      | `#880D56` | Purple/Burgundy   | `NATION_COLORS.ROME`      |
| **Tamil**     | `#00B281` | Teal/Green        | `NATION_COLORS.TAMIL`     |
| **Yuezhi**    | `#AD7E00` | Mustard/Gold      | `NATION_COLORS.YUEZHI`    |

### Tribes

| Tribe         | Hex Code  | Color Description | Export                   |
| ------------- | --------- | ----------------- | ------------------------ |
| **Gauls**     | `#87DB40` | Lime Green        | `TRIBE_COLORS.GAULS`     |
| **Vandals**   | `#9C5DFF` | Purple            | `TRIBE_COLORS.VANDALS`   |
| **Danes**     | `#3CCDC2` | Teal              | `TRIBE_COLORS.DANES`     |
| **Thracians** | `#D89A18` | Orange/Gold       | `TRIBE_COLORS.THRACIANS` |
| **Scythians** | `#E6E1CA` | Beige/Light Tan   | `TRIBE_COLORS.SCYTHIANS` |
| **Numidians** | `#FFDD67` | Light Yellow      | `TRIBE_COLORS.NUMIDIANS` |
| **Huns**      | `#AB3157` | Dark Pink/Magenta | `TRIBE_COLORS.HUNS`      |

### Using Nation and Tribe Colors

Import from the central config module:

```typescript
import {
	NATION_COLORS,
	TRIBE_COLORS,
	getNationColor,
	getCivilizationColor,
	getNationChartColor,
} from "$lib/config";

// Use directly with type safety
const egyptColor = NATION_COLORS.EGYPT; // "#BC6304"
const gaulsColor = TRIBE_COLORS.GAULS; // "#87DB40"

// Use helper functions (handles string conversion and lookup)
const color = getNationColor("EGYPT"); // "#BC6304"
const color2 = getCivilizationColor("GAULS"); // "#87DB40" (checks both nations and tribes)

// Chart series: getNationChartColor is the canonical helper — the nation's
// color, or a palette color by index when the nation is unknown/missing.
// Single source of truth shared by game-detail and aggregate-stats charts.
series: playerHistory.map((player, i) => ({
	name: player.player_name,
	type: "line",
	data: player.history.map((h) => h.points),
	itemStyle: { color: getNationChartColor(player.nation, i) },
}));
```

---

## Yield Colors

The sixteen series on the aggregate yields panel are colored from **Old World's own yield palette** rather than the chart palette above. They live in `src/lib/generated/yield-colors.ts`, baked from the reference XML — do not edit that file by hand; run `npm run bake:yield-colors` to refresh it.

Before this, every yield chart drew in `getChartColor(0)`, so color carried no information down a stack of sixteen charts. Coloring each series the way the game colors it makes the hue identify the yield.

| Series | Color | Source | On `#211A12` |
| --- | --- | --- | --- |
| Science | `#a16ad1` | `color.xml` `#733b9f`, lifted | 4.50:1 |
| Money | `#b4935e` | sprite (xml `#ffffff`) | 5.96:1 |
| Training | `#d15f5c` | `color.xml` `#a93b3b`, lifted | 4.51:1 |
| Civics | `#d78d46` | `color.xml` | 6.38:1 |
| Culture | `#639aad` | `color.xml` | 5.53:1 |
| Orders | `#bd976c` | sprite (xml `#ffffff`) | 6.39:1 |
| Food | `#739600` | `color.xml` | 4.99:1 |
| Growth | `#3d9f70` | `color.xml` | 5.23:1 |
| Happiness | `#f2c95e` | `color.xml` | 10.88:1 |
| Discontent | `#8f8fb3` | `color.xml` `#555475`, lifted | 5.53:1 |
| Iron | `#DBDCDB` | `color.xml` | 12.51:1 |
| Stone | `#78839a` | `color.xml` `#6B758C`, lifted | 4.51:1 |
| Wood | `#9b7d63` | `color.xml` `#80634A`, lifted | 4.51:1 |
| Maintenance | `#ee433e` | sprite (xml `#ffffff`), lifted | 4.51:1 |
| Military Power | `#dc5a43` | `COLOR_RATING_COURAGE` | 4.57:1 |
| Legitimacy | `#a7a164` | sprite (no `yield.xml` entry) | 6.49:1 |

Three rules decide that table, and each covers a case the XML alone cannot:

**The lift.** The game paints yields on its own UI, not on the chart ground. Six of its colors could not carry a 2px line there — Science at 2.34:1 and Discontent at 2.38:1 were close to invisible — so each is raised in OKLCh **lightness only**, holding hue exactly and clamping chroma only where the sRGB gamut demands it (it never has: every lift retained 100% chroma). Ten of the sixteen clear the floor untouched and are the game's colors verbatim. The floor is 4.5:1, except Discontent at 5.5:1 — at 4.5 it lands 0.022 from Stone in OKLab, effectively one color on two charts that sit two apart in the stack.

**`#ffffff` means "no color of its own."** `color.xml` gives Money, Orders and Maintenance all white, which would ship as three identical white charts. Those fall through to their icon art, which does distinguish them and carries the meaning the table drops — Maintenance is a cost, and the game draws it red. The test is exactly `#ffffff`, **not** near-white: Iron is `#DBDCDB`, a deliberate light-metal grey whose sprite is achromatic enough that sampling would replace it with a muddy dark grey.

**Military Power is not a yield.** It has no `yield.xml` entry, no sprite, and no `COLORCLASS_YIELDS` color; the token appears nowhere in the game XML. It is a per-ankh series over a derived stat, so it borrows `COLOR_RATING_COURAGE` and is exported separately as `MILITARY_POWER_COLOR` — keeping `YIELD_COLORS` keyed only by tokens the game actually has.

### Where yield colors apply

They color the **pooled median line and its P25–P75 band** on `YieldsStatsPanel`, which is the yields panel on all three stats surfaces (profile stats tab, `/stats`, tournament stats). Two places deliberately do not use them:

- **Winners-vs-losers split mode** keeps `WIN_COLOR` / `LOSS_COLOR`. There color means cohort, and it means the same thing on every chart that splits by outcome; color only names the yield when there is no cohort to name.
- **The game-detail Yields tab** draws one line per player and colors by nation (`getPlayerColor`). Color already means player there.

```typescript
import { MILITARY_POWER_COLOR, YIELD_COLORS } from "$lib/generated/yield-colors";

const science = YIELD_COLORS.YIELD_SCIENCE; // "#a16ad1"
```

`YIELD_COLORS` is emitted `as const satisfies Readonly<Record<string, string>>`, so a mistyped `YIELD_*` key is a compile error rather than an `undefined` that silently falls back to the theme palette. (`FAMILY_COLORS` keeps a plain `Record` shape — it is indexed by a runtime zType, where an index signature is what you want.)

## Design Notes

The overall color scheme combines warm, earthy tones (browns, oranges, tans) with a cool blue-gray background. This palette is fitting for an application themed around Old World game analytics, evoking ancient Egyptian aesthetics where "Per-Ankh" means "House of Life" in ancient Egyptian.

Nation and tribe colors are chosen to:

- Provide clear visual distinction between civilizations in multi-player charts
- Balance aesthetic appeal with functional readability
- Avoid colors that are too similar when displayed together
