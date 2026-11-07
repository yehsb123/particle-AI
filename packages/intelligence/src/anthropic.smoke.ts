/**
 * One small real request to the Messages API — the thing you run the first time a key exists.
 *
 * It sends exactly what `AnthropicProvider` sends (same builder, same model and ceiling) and
 * prints the three numbers that tell you whether the account, the model number and the token
 * budget are all right: how the turn ended, how much body came back, what it cost. It is a
 * probe and not a test: it is not collected by vitest, it never runs in CI, and with no key it
 * says so and fails rather than passing quietly.
 *
 * Run it with `pnpm --filter @particle/intelligence smoke`, optionally naming a model.
 */
import { execFileSync } from "node:child_process";
import {
  ANTHROPIC_DEFAULT_MAX_TOKENS,
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_MESSAGES_URL,
  anthropicRequest,
  credentialFromEnv,
  stopFailure,
  type AnthropicResponse,
} from "./anthropic";
import { postJson } from "./http";

/**
 * The token the `ant` CLI is holding for whoever logged in, or null.
 *
 * Asked for fresh every run because it is short-lived: a token copied into a file is a token
 * that stops working, usually on the day somebody is trying to find out whether something else
 * is broken. If the CLI is not installed or nobody has logged in, this is simply null, and the
 * message below names both ways in. The token is never printed.
 */
function tokenFromLogin(): string | null {
  try {
    const out = execFileSync("ant", ["auth", "print-credentials", "--access-token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 20_000,
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

const loginToken = tokenFromLogin();
const credential =
  credentialFromEnv() ?? (loginToken ? ({ kind: "oauth", value: loginToken } as const) : null);
if (!credential) {
  console.error(
    "No credential, so nothing was sent and nothing was proved.\n" +
      "Either log in with `ant auth login` (nothing to paste anywhere), or put a key in the\n" +
      "repo-root .env as ANTHROPIC_API_KEY (copy .env.example). Then run this again.",
  );
  process.exit(1);
}

const model = process.argv[2] ?? ANTHROPIC_DEFAULT_MODEL;
const { headers, body } = anthropicRequest({
  credential,
  model,
  maxTokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
  system: "Answer in one short sentence.",
  content: "Say hello.",
});

console.log(
  `asking ${model} for one sentence, with room for ${ANTHROPIC_DEFAULT_MAX_TOKENS} tokens, ` +
    `using ${credential.kind === "api_key" ? "the key in the environment" : "the account that logged in"}…`,
);

const started = Date.now();
let res: AnthropicResponse;
try {
  res = (await postJson(ANTHROPIC_MESSAGES_URL, headers, body, 60_000)) as AnthropicResponse;
} catch (error) {
  console.error(`the request failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const text = (res.content ?? []).map((block) => block.text ?? "").join("");
console.log(`  stop_reason   ${res.stop_reason ?? "(none reported)"}`);
console.log(`  body          ${text.length} characters`);
console.log(`  tokens        ${res.usage?.input_tokens ?? "?"} in, ${res.usage?.output_tokens ?? "?"} out`);
console.log(`  took          ${Date.now() - started} ms`);

const failure = stopFailure(res, text.length);
if (failure) {
  console.error(`this is not an answer: ${model} ${failure}`);
  process.exit(1);
}
console.log("the credential works and the turn ended with a body.");
