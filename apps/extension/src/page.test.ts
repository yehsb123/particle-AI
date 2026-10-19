import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGE_LIMITS, isSecretField, maskLongDigits, nameList, pageShape, relayPayload, RELAY_KINDS, MAX_NAME } from "./shape";

/**
 * The page layer reads what is ON a page rather than the shape of the browsing around it, so
 * what it may send is the whole of the promise this layer makes. Every name it sends is built
 * here, and these tests are that promise written down: a bounded handful of short names, no box
 * that could hold a password or a card, and never a value anybody typed.
 */
describe("a box this sensor refuses to describe", () => {
  it("leaves out a password box however the page spelled it", () => {
    for (const field of [
      { type: "password" },
      { type: "PASSWORD" },
      { type: "text", autocomplete: "current-password" },
      { type: "text", autocomplete: "new-password" },
      { type: "text", name: "user_password" },
      { type: "text", id: "login-password" },
      { type: "text", label: "비밀번호" },
      { type: "text", label: "Password" },
    ]) {
      expect(isSecretField(field), JSON.stringify(field)).toBe(true);
    }
  });

  it("leaves out a box a card number could go in", () => {
    for (const field of [
      { type: "text", autocomplete: "cc-number" },
      { type: "text", autocomplete: "cc-exp" },
      { type: "text", autocomplete: "cc-csc" },
      { type: "text", name: "cardnumber" },
      { type: "text", label: "Card number" },
      { type: "text", label: "Credit card" },
      { type: "text", name: "cvc" },
      { type: "text", id: "cvv" },
      { type: "text", label: "Security code" },
      { type: "text", label: "카드번호" },
      { type: "text", label: "유효기간" },
    ]) {
      expect(isSecretField(field), JSON.stringify(field)).toBe(true);
    }
  });

  it("still describes the ordinary boxes a page is made of", () => {
    for (const field of [
      { type: "text", label: "Search" },
      { type: "email", label: "Email" },
      { type: "search", autocomplete: "off", name: "q", label: "Search Wikipedia" },
      { type: "text", label: "직무" },
      { type: "text", label: "경력" }, // a job site says "경력"; "exp" must not make that a card box
      { type: "select", label: "Language" },
    ]) {
      expect(isSecretField(field), JSON.stringify(field)).toBe(false);
    }
  });

  it("answers for a box that is barely a box at all, rather than throwing", () => {
    for (const field of [{}, { type: null }, { label: 42 }, { autocomplete: ["cc-number"] }]) {
      expect(typeof isSecretField(field as Record<string, unknown>), JSON.stringify(field)).toBe("boolean");
    }
  });
});

/**
 * Last resort at the edge: a run of digits that long is not a heading or a button somebody reads,
 * it is a number out of a box. Shorter runs stay — a year, a price, a count of articles.
 */
describe("a long run of digits never leaves", () => {
  it("masks what is long enough to be an account, a card or a phone number", () => {
    expect(maskLongDigits("4242424242424242")).toBe("…");
    expect(maskLongDigits("order 1234567890 shipped")).toBe("order … shipped");
    expect(maskLongDigits("01012345678")).toBe("…");
  });

  it("keeps the numbers a page really shows people", () => {
    for (const kept of ["1,000,000+ articles", "2026", "Pay 42,000 KRW", "12/29", "top 100", "12345678"]) {
      expect(maskLongDigits(kept), kept).toBe(kept);
    }
  });
});

describe("the list of names one field of the payload carries", () => {
  it("joins what it takes and stops at the count it was given", () => {
    expect(nameList(["one", "two", "three"], 2)).toBe("one · two");
  });

  it("stops at the length the runtime would trim it to anyway", () => {
    const out = nameList(Array.from({ length: 20 }, (_, i) => `heading number ${i}`), 20);
    expect(out.length).toBeLessThanOrEqual(MAX_NAME);
    expect(out).not.toContain("…"); // it stops before a name rather than cutting one in half
  });

  it("shortens one very long name instead of letting it take the whole list", () => {
    const out = nameList(["x".repeat(400), "second"], 5);
    expect(out.split(" · ")[0]!.length).toBeLessThanOrEqual(PAGE_LIMITS.item + 1);
    expect(out).toContain("second");
  });

  it("drops what is not a name, empties and repeats", () => {
    expect(nameList(["a", "", "   ", null, 42, "a", "b"], 10)).toBe("a · b");
    expect(nameList("not a list" as unknown as string[], 5)).toBe("");
  });

  it("carries no control characters, whatever the page put in its headings", () => {
    const esc = String.fromCharCode(27);
    expect(nameList([`${esc}[31mred`, "fine"], 5)).toBe("[31mred · fine");
  });
});

describe("the shape of a page", () => {
  const real = {
    title: "Checkout - Store",
    headings: ["Payment", "Card details"],
    fields: [
      { type: "text", autocomplete: "cc-number", name: "cardnumber", label: "Card number" },
      { type: "password", autocomplete: "current-password", label: "Password" },
      { type: "email", label: "Email" },
    ],
    actions: ["Pay 42,000 KRW"],
  };

  it("sends the names a person would read off the page", () => {
    expect(pageShape(real)).toEqual({
      title: "Checkout - Store",
      headings: "Payment · Card details",
      fields: "Email",
      actions: "Pay 42,000 KRW",
      omitted: 2,
    });
  });

  it("says how many boxes it refused to describe, so the page is not silently half-reported", () => {
    expect(pageShape({ ...real, fields: [{ type: "password" }, { type: "text", label: "Email" }] }).omitted).toBe(1);
  });

  it("stays small enough for a person to read the whole of it", () => {
    const huge = {
      title: "t".repeat(500),
      headings: Array.from({ length: 200 }, (_, i) => `heading ${i} ${"h".repeat(80)}`),
      fields: Array.from({ length: 200 }, (_, i) => ({ type: "text", label: `label ${i} ${"l".repeat(80)}` })),
      actions: Array.from({ length: 200 }, (_, i) => `action ${i} ${"a".repeat(80)}`),
    };
    const shape = pageShape(huge);
    for (const [key, value] of Object.entries(shape)) {
      if (typeof value === "string") expect(value.length, key).toBeLessThanOrEqual(MAX_NAME);
    }
    expect(JSON.stringify(shape).length).toBeLessThan(700);
  });

  it("answers for a page that gave it nothing", () => {
    expect(pageShape({})).toEqual({ title: "", headings: "", fields: "", actions: "", omitted: 0 });
    expect(pageShape({ headings: "not a list", fields: 42, actions: null, title: {} })).toEqual({
      title: "",
      headings: "",
      fields: "",
      actions: "",
      omitted: 0,
    });
  });
});

/**
 * The background trusts no content script, including this one: a page can run its own code in the
 * same world, so the message arriving at the service worker is rebuilt rather than forwarded.
 */
describe("what the background will relay of a page", () => {
  it("declares the layer's event type and takes the host like every other kind", () => {
    expect(RELAY_KINDS.page?.type).toBe("sensor.read_page");
    expect(relayPayload("page", { host: "Example.COM", title: "x", omitted: 0 })).toMatchObject({ host: "example.com", title: "x" });
  });

  it("keeps only the fields this layer has, whatever else was in the message", () => {
    const out = relayPayload("page", {
      host: "a.com",
      title: "Inbox",
      headings: "Today",
      fields: "Search",
      actions: "Send",
      omitted: 1,
      text: "the whole page",
      html: "<body>…</body>",
      value: "hunter2",
      password: "hunter2",
    })!;
    expect(Object.keys(out).sort()).toEqual(["actions", "fields", "headings", "host", "omitted", "title"]);
  });

  it("will not pass a long run of digits on even if the page put one in a heading", () => {
    expect(relayPayload("page", { title: "card 4242424242424242" })).toEqual({ title: "card …", omitted: 0 });
  });

  it("holds every name to the same length the rest of this sensor uses", () => {
    const out = relayPayload("page", { title: "t".repeat(400), headings: "h".repeat(400), omitted: 9e9 })!;
    expect((out.title as string).length).toBeLessThanOrEqual(MAX_NAME + 1);
    expect((out.headings as string).length).toBeLessThanOrEqual(MAX_NAME + 1);
    expect(out.omitted).toBe(1_000_000);
  });

  it("leaves out what the page did not have rather than sending empty names", () => {
    expect(relayPayload("page", { title: "", headings: "", fields: "", actions: "" })).toEqual({ omitted: 0 });
  });
});

/**
 * A value is the one thing this layer must never read.
 *
 * The rule is cheap to keep and expensive to notice the loss of, so it is pinned at the source.
 * The first version of this pinned only `.value` in `content.ts`, which was two gaps at once: a
 * value read as `getAttribute("value")` walked straight past it, and the reading itself has
 * since moved into `page.ts`. What is held here now is every spelling of reading a value, over
 * every file of the content script that holds an element, with the one exception written out:
 * the caption of a button, which the page wrote and nobody typed.
 *
 * The behaviour this stands for is tested against a real page in `dom.test.ts`; this is the part
 * that catches a value read somewhere no test happened to look.
 */
describe("the source that touches the page", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const read = (name: string) => readFileSync(resolve(dir, name), "utf8");

  /** The files of the content script that hold an element of somebody's page. */
  const HOLD_AN_ELEMENT = ["content.ts", "page.ts"];
  /** Reading what is in a box, however it is spelled. The attribute counts: a value is a value. */
  const VALUE_READS = /\.value\b|\.defaultValue\b|getAttribute\(\s*(["'`])value\1\s*\)/g;
  /** What only code holding an element can do. `shape.ts` is handed plain objects and does none of it. */
  const ELEMENT_READS = /querySelector|getAttribute|getClientRects|\.closest\(|textContent|innerText|innerHTML/;

  /** One named function, from its signature to the brace that closes it in the first column. */
  function bodyOf(source: string, name: string): string {
    const start = source.indexOf(`function ${name}(`);
    expect(start, name).toBeGreaterThan(-1);
    const end = source.indexOf("\n}\n", start);
    expect(end, name).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  it("reads no value anywhere outside the caption of a button", () => {
    for (const file of HOLD_AN_ELEMENT) {
      const source = read(file);
      const rest = source.includes("function actionName(") ? source.replace(bodyOf(source, "actionName"), "") : source;
      expect([...rest.matchAll(VALUE_READS)].map((m) => m[0]), file).toEqual([]);
    }
  });

  it("reads one value, in the one place a value is a caption the page wrote", () => {
    const body = bodyOf(read("page.ts"), "actionName");
    expect([...body.matchAll(VALUE_READS)].map((m) => m[0])).toEqual(['getAttribute("value")']);
  });

  /**
   * The scan above names its files, so a new file holding an element would not be scanned at
   * all. What stops that is this: the content script reaches exactly these, and `shape.ts` is in
   * the reach without holding an element, which is why its own `.value` (a map iterator) is not
   * one of these reads.
   */
  it("reaches no file that holds an element without being on the list", () => {
    const reached = new Set<string>();
    const follow = (name: string): void => {
      if (reached.has(name)) return;
      reached.add(name);
      for (const [, imported] of read(name).matchAll(/from "\.\/([\w.-]+)"/g)) follow(`${imported}.ts`);
    };
    follow("content.ts");
    expect([...reached].sort()).toEqual(["content.ts", "page.ts", "shape.ts"]);
    for (const name of [...reached].filter((n) => !HOLD_AN_ELEMENT.includes(n))) {
      expect(read(name), name).not.toMatch(ELEMENT_READS);
    }
  });
});
