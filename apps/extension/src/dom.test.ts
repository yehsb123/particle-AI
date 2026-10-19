// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import { labelOf, readPage, SCAN_LIMIT } from "./page";
import { pageShape } from "./shape";

/**
 * The page layer, read off a real page.
 *
 * `page.test.ts` holds the pure half — what `shape.ts` does to names it is handed. Nothing held
 * the half that picks those names up off a page, which is how a label came to carry what
 * somebody had typed into the box below it and how a page of hidden machinery came to report
 * that it had hidden nothing. Both of those are here, against the HTML that produces them.
 */

/**
 * jsdom lays nothing out, so `getClientRects` answers the same empty list for every element and
 * no box would be on screen at all. This supplies the one answer layout would have given: a box
 * is on screen unless it, or something it sits inside, is hidden the way a browser hides one.
 */
beforeAll(() => {
  const rect = [{ x: 0, y: 0, width: 10, height: 10 }] as unknown as DOMRectList;
  const none = [] as unknown as DOMRectList;
  Element.prototype.getClientRects = function (this: Element): DOMRectList {
    for (let node: Element | null = this; node; node = node.parentElement) {
      if (node.hasAttribute("hidden")) return none;
      if (node.tagName === "INPUT" && node.getAttribute("type") === "hidden") return none;
      if (/display:\s*none/.test(node.getAttribute("style") ?? "")) return none;
    }
    return rect;
  };

  /**
   * jsdom implements no `CSS` namespace, and declares the name without a value rather than
   * leaving it out. Chrome, where this script runs, has had `CSS.escape` since 2016, so the
   * stand-in only has to agree with it on the ids a page actually uses.
   */
  const host = globalThis as { CSS?: { escape(value: string): string } };
  if (!host.CSS) host.CSS = { escape: (value: string) => value.replace(/[^\w-]/g, (c) => `\\${c}`) };
});

/** One page, built from its HTML, handed back the way the content script hands it over. */
function page(html: string, title = "a page"): Document {
  document.title = title;
  document.body.innerHTML = html;
  return document;
}

/** Everything the layer would send about this page, as one string to search. */
function sent(doc: Document): string {
  return JSON.stringify(pageShape(readPage(doc)));
}

describe("the name beside a box", () => {
  /**
   * A server-rendered edit form puts the box inside the label, and what is inside a `<textarea>`
   * is what the person saved the last time they filled it in. Reading the label's text whole
   * takes that with it.
   */
  it("is the label's own words, not what the person wrote in the box it wraps", () => {
    const doc = page(`<label>소개 <textarea name="bio">작년에 써 둔 자기소개 전문</textarea></label>`);
    expect(labelOf(doc.querySelector("textarea")!)).toBe("소개");
    expect(sent(doc)).not.toContain("작년에");
  });

  /** The same path, with the words coming from the choices rather than from a saved value. */
  it("is the label's own words, not the choices in the select it wraps", () => {
    const doc = page(`<label>표시 언어 <select name="lang"><option>한국어</option><option>English</option></select></label>`);
    expect(labelOf(doc.querySelector("select")!)).toBe("표시 언어");
    expect(sent(doc)).not.toContain("한국어");
  });

  it("leaves out every box in a label that wraps more than one", () => {
    const doc = page(`<label>기간 <input name="from" value="2020"> ~ <input name="to" value="2026"></label>`);
    expect(labelOf(doc.querySelector("input")!)).toBe("기간 ~");
  });

  it("leaves out the caption of a button sitting inside the label", () => {
    const doc = page(`<label>검색어 <input name="q"><button>지우기</button></label>`);
    expect(labelOf(doc.querySelector("input")!)).toBe("검색어");
  });

  it("still reads a label tied to the box by id, and one written as aria-label", () => {
    const doc = page(`<label for="q">검색</label><input id="q"><input aria-label="Where to?" name="dest">`);
    expect(labelOf(doc.querySelector("#q")!)).toBe("검색");
    expect(labelOf(doc.querySelector('[name="dest"]')!)).toBe("Where to?");
  });

  it("falls back to the placeholder, and to nothing at all, when the page named no box", () => {
    const doc = page(`<input name="q" placeholder="무엇을 찾으세요?"><input name="r">`);
    expect(labelOf(doc.querySelector('[name="q"]')!)).toBe("무엇을 찾으세요?");
    expect(labelOf(doc.querySelector('[name="r"]')!)).toBe("");
  });
});

describe("a page with hidden machinery in front of it", () => {
  const machinery = Array.from({ length: SCAN_LIMIT + 20 }, (_, i) => `<input type="hidden" name="t${i}" value="x">`).join("");

  it("still describes the boxes somebody can actually see", () => {
    const doc = page(`${machinery}<label>이메일 <input type="email" name="email"></label>`);
    expect(pageShape(readPage(doc)).fields).toBe("이메일");
  });

  /**
   * `omitted` is how a person reading the event can tell something was held back. Counting the
   * hidden boxes first and cutting at the limit threw the password box away before it could be
   * counted, so a login page behind machinery reported that it had hidden nothing.
   */
  it("still counts the password box it refused to describe", () => {
    const doc = page(`${machinery}<label>비밀번호 <input type="password" name="pw"></label>`);
    expect(pageShape(readPage(doc)).omitted).toBe(1);
  });

  it("still finds the buttons under the machinery", () => {
    const doc = page(`${machinery}<button>로그인</button>`);
    expect(pageShape(readPage(doc)).actions).toBe("로그인");
  });

  it("describes no more than its limit of boxes, however many the page has", () => {
    const many = Array.from({ length: SCAN_LIMIT + 50 }, (_, i) => `<input aria-label="box ${i}">`).join("");
    expect(readPage(page(many)).fields.length).toBe(SCAN_LIMIT);
  });
});

describe("what a page the person has filled in gives up", () => {
  it("sends no value, whether the page wrote it or the person typed it", () => {
    const doc = page(
      `<h1>프로필 수정</h1>
       <label>이름 <input name="name" value="예성빈"></label>
       <label>메모 <textarea name="memo">출장 일정 정리</textarea></label>`,
    );
    const typed = doc.querySelector<HTMLInputElement>('[name="name"]')!;
    typed.value = "직접 입력한 이름";
    const payload = sent(doc);
    expect(payload).toContain("프로필 수정");
    expect(payload).toContain("이름");
    expect(payload).not.toContain("예성빈");
    expect(payload).not.toContain("직접 입력한 이름");
    expect(payload).not.toContain("출장 일정 정리");
  });

  /** A button's `value` is the caption the page wrote, which is why that one read is allowed. */
  it("still takes the caption off a button that has no text of its own", () => {
    const doc = page(`<input type="submit" value="결제하기"><button>취소</button>`);
    expect(pageShape(readPage(doc)).actions).toBe("결제하기 · 취소");
  });

  it("names the page and its headings the way a person reads them", () => {
    const doc = page(`<h1>받은 편지함</h1><h2>오늘</h2>`, "받은 편지함 · 메일");
    const shape = pageShape(readPage(doc));
    expect(shape.title).toBe("받은 편지함 · 메일");
    expect(shape.headings).toBe("받은 편지함 · 오늘");
  });
});
