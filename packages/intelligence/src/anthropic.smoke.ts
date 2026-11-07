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
import {
  ANTHROPIC_DEFAULT_MAX_TOKENS,
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_MESSAGES_URL,
  anthropicRequest,
  stopFailure,
  type AnthropicResponse,
} from "./anthropic";
import { postJson } from "./http";

const key = process.env.ANTHROPIC_API_KEY?.trim();
if (!key) {
  console.error(
    "ANTHROPIC_API_KEY is not set, so nothing was sent and nothing was proved.\n" +
      "Put a key in the repo-root .env (copy .env.example) or export it in this shell, then run this again.",
  );
  process.exit(1);
}

const model = process.argv[2] ?? ANTHROPIC_DEFAULT_MODEL;
const { headers, body } = anthropicRequest({
  apiKey: key,
  model,
  maxTokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
  system: "Answer in one short sentence.",
  content: "Say hello.",
});

console.log(`asking ${model} for one sentence, with room for ${ANTHROPIC_DEFAULT_MAX_TOKENS} tokens…`);

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
console.log("the key works and the turn ended with a body.");
