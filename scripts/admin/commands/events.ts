// `./per-ankh admin events [--type T] [--user U] [--limit N]`
// Recent audit-log entries from the `events` table.
//
// The table retains `share_id`/`app_key` columns and rows from the retired
// desktop-era share surface; they are historical only and not surfaced here.

import { d1Query, sqlStr } from "../wrangler";
import {
	type Column,
	emdash,
	formatDate,
	info,
	printCount,
	printTable,
} from "../../lib/format";
import {
	type CommandOpts,
	flagInt,
	flagString,
	parseFlags,
	printJson,
} from "../../lib/cli";

interface EventRow {
	id: number;
	event_type: string;
	game_id: string | null;
	user_id: string | null;
	ip_address: string | null;
	created_at: string;
}

export async function run(argv: string[], opts: CommandOpts): Promise<void> {
	const { flags } = parseFlags(argv);
	const limit = flagInt(flags, "limit", 50);
	const typeFilter = flagString(flags, "type");
	const userFilter = flagString(flags, "user");

	const where: string[] = [];
	if (typeFilter) where.push(`event_type = ${sqlStr(typeFilter)}`);
	if (userFilter) where.push(`user_id = ${sqlStr(userFilter)}`);
	const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

	info(`Listing events (limit ${limit})...`);
	const sql = `
		SELECT id, event_type, game_id, user_id, ip_address, created_at
		FROM events
		${whereSql}
		ORDER BY created_at DESC
		LIMIT ${limit}
	`;
	const rows = await d1Query<EventRow>(sql);

	if (opts.json) {
		printJson(rows);
		return;
	}
	if (rows.length === 0) {
		process.stderr.write("No events found.\n");
		return;
	}

	const cols: Column[] = [
		{ header: "TYPE", width: 18 },
		{ header: "GAME", width: 22 },
		{ header: "USER", width: 22 },
		{ header: "IP", width: 16 },
		{ header: "TIME", width: 16 },
	];
	printTable(
		cols,
		rows.map((r) => [
			r.event_type,
			emdash(r.game_id),
			emdash(r.user_id),
			emdash(r.ip_address),
			formatDate(r.created_at),
		]),
	);
	printCount(rows.length, "events shown");
}
