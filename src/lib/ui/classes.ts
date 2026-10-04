// The button and input class strings the app's surfaces share — the dark
// scheme the game-detail tabs use: tan text on dark surfaces, no bright
// accents. One place so the create page, the challenge page, the upload
// modal and the tournament settings popover can't drift.

export const PRIMARY_BTN =
	"rounded bg-surface-raised px-4 py-2 text-sm font-bold text-tan transition-colors hover:bg-surface-raised-hover disabled:cursor-not-allowed disabled:opacity-50";

export const SECONDARY_BTN =
	"whitespace-nowrap rounded border border-tan px-3 py-1.5 text-xs text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50";

// The outlined red button an irreversible action gets — deleting a challenge
// or a tournament. A brighter red than `--color-danger`, which app.css
// defines as the eliminate/loss status colour.
export const DESTRUCTIVE_BTN =
	"whitespace-nowrap rounded border border-red-400 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-400 hover:text-black disabled:opacity-50";

export const INPUT_CLASS =
	"rounded border border-input bg-surface-raised p-1.5 focus:border-input-focus focus:outline-none";
