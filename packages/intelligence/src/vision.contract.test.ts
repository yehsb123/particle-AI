import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type IncomingMessage } from "node:http";
import { AnthropicProvider } from "./anthropic";
import { readScreen } from "./screen";

/**
 * What a picture looks like on the wire — proven without a key and without the network.
 *
 * The live test below runs only when somebody has a key, so this is what holds the Messages API
 * image block to its shape on every push: an image block carries base64 under `source`, the text
 * comes after it in the same user turn, and the pixels appear nowhere else in the request.
 */
type Seen = { url: string; body: unknown };
let server: Server;
let base = "";
const seen: Seen[] = [];

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_BYTES = Buffer.from(PNG_BASE64, "base64");

const reading = {
  activity: "messaging",
  summary: "A chat window with one unread message.",
  topics: ["unread"],
  needsAttention: true,
  confidence: 0.6,
};

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
  });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    seen.push({ url: req.url ?? "", body: await readBody(req) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        content: [{ type: "text", text: JSON.stringify(reading) }],
        usage: { input_tokens: 900, output_tokens: 40 },
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

type Block = { type: string; text?: string; source?: { type: string; media_type: string; data: string } };

describe("a picture on the way to the Messages API", () => {
  it("travels as a base64 image block in front of the words, and as nothing else", async () => {
    seen.length = 0;
    const provider = new AnthropicProvider({ apiKey: "test-key", baseUrl: `${base}/v1/messages`, model: "claude-sonnet-5" });
    const result = await readScreen(provider, {
      bytes: PNG_BYTES,
      mediaType: "image/png",
      app: "KakaoTalk",
      window: "team chat",
      width: 784,
      height: 527,
    });

    expect(result.ok, result.ok ? "" : result.reason).toBe(true);
    if (!result.ok) return;
    expect(result.reading.activity).toBe("messaging");
    expect(result.providerId).toBe("anthropic");

    const body = seen[0]!.body as { messages: { role: string; content: Block[] }[]; system: string };
    expect(seen[0]!.url).toBe("/v1/messages");
    expect(body.messages[0]?.role).toBe("user");
    const content = body.messages[0]?.content ?? [];
    expect(content.map((block) => block.type)).toEqual(["image", "text"]);
    expect(content[0]?.source).toEqual({ type: "base64", media_type: "image/png", data: PNG_BASE64 });
    expect(content[1]?.text).toContain("KakaoTalk");
    expect(body.system).toContain("messaging");

    // the pixels are in the image block and in no other part of the request
    const elsewhere = JSON.stringify({ ...body, messages: [{ ...body.messages[0], content: content.slice(1) }] });
    expect(elsewhere).not.toContain(PNG_BASE64);
  });

  it("asks nothing of the network when there is no key", async () => {
    seen.length = 0;
    const provider = new AnthropicProvider({ apiKey: undefined, baseUrl: `${base}/v1/messages` });
    if ((await provider.health()).healthy) return; // a key in the environment: nothing to prove here
    const result = await readScreen(provider, {
      bytes: PNG_BYTES,
      mediaType: "image/png",
      app: "KakaoTalk",
      window: "team chat",
      width: 784,
      height: 527,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/no API key/);
    expect(seen).toHaveLength(0);
  });
});
