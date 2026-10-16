#!/usr/bin/env tsx
/**
 * One picture, by hand.
 *
 *   DM_CAPTURE=1 pnpm --filter @particle/screen-capture exec tsx src/bin.ts --app KakaoTalk
 *
 * This file is an entry point and is imported by nothing. Running it is the opt-in, and it still
 * refuses unless DM_CAPTURE says yes, so there is no way to take a picture here by accident.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureWith } from "./capture";
import { readCaptureConfig } from "./config";
import { CAPTURE_USAGE, captureFileName, parseCaptureArgs } from "./cli";
import { defaultCaptureRegistry } from "./index";

async function main(): Promise<void> {
  const args = parseCaptureArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${CAPTURE_USAGE}\n`);
    return;
  }
  const env = args.backend ? { ...process.env, DM_CAPTURE_BACKEND: args.backend } : process.env;
  const config = readCaptureConfig(env);
  const out = args.out || join(config.dir || tmpdir(), captureFileName(args.target, new Date()));
  const result = await captureWith(config, defaultCaptureRegistry(), { target: args.target, path: out });
  if (!result.ok) {
    process.stderr.write(`[particle-capture] no picture: ${result.reason}\n`);
    process.exitCode = 1;
    return;
  }
  const { frame } = result;
  process.stdout.write(
    `[particle-capture] ${frame.app} · ${frame.window || "(no title)"} · ${frame.width}x${frame.height} · ${frame.bytes} bytes\n${frame.path}\n`,
  );
}

void main().catch((err: unknown) => {
  process.stderr.write(`[particle-capture] ${(err as Error).message}\n`);
  process.exitCode = 1;
});
