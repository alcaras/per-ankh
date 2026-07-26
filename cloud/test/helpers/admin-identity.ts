// The Discord id the integration Worker treats as the site admin.
//
// isSiteAdmin (cloud/src/admin.ts) matches users.discord_id against the
// ADMIN_DISCORD_ID secret, so admin-only endpoints are untestable unless the
// isolate has one bound. vitest.config.mts binds this value and makeSiteAdmin()
// creates the matching user — both import it from here so they can't drift.
//
// Deliberately outside makeUser's counter range (which starts at 1e18) so no
// incidentally-created test user is ever a site admin.
export const SITE_ADMIN_DISCORD_ID = "999999999999999999";
