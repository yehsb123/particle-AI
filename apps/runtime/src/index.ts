import { buildServer } from "./server";

const PORT = Number(process.env.DM_PORT ?? 8787);

async function main() {
  const { app } = await buildServer();
  await app.listen({ port: PORT, host: "0.0.0.0" });
  // eslint-disable-next-line no-console
  console.log(`[digital-matter] runtime listening on http://localhost:${PORT}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
