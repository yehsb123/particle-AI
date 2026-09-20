import { envNumber } from "@particle/contracts";
import { buildServer } from "./server";

const PORT = envNumber(process.env.DM_PORT, 8787, "DM_PORT", 1, 65_535);
// Loopback by default: the runtime holds a shape-level record of what you did. Opt in to LAN exposure.
const HOST = process.env.DM_HOST ?? "127.0.0.1";

async function main() {
  const { app } = await buildServer();
  await app.listen({ port: PORT, host: HOST });
  // eslint-disable-next-line no-console
  console.log(`[digital-matter] runtime listening on http://localhost:${PORT}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
