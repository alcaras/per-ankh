<script lang="ts">
	// The profile at its pretty URL. Identical to /users/[user_id] —
	// one page component, two URLs (see $lib/users/ProfilePage.svelte).
	import ProfilePage from "$lib/users/ProfilePage.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();
</script>

<ProfilePage {data} />
