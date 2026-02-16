export async function examples() {
	const glob = new Bun.Glob("examples/*.ts");
	for (const file of glob.scanSync()) {
		await Bun.$`bun ${file}`;
	}
}

if (import.meta.main) {
	await examples();
}
