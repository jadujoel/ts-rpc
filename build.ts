export async function build() {
  const tsc = Bun.$`bunx tsc`;
  await Bun.build({
    entrypoints: ["src/index.html"],
    outdir: "dist",
    sourcemap: "linked"
  })
  await tsc
}

if (import.meta.main) {
  await build()
}
