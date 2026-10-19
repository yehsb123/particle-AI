/**
 * The page layer: the only code in this extension that holds an element of somebody's page.
 *
 * It lives apart from `content.ts` because that file talks to `chrome` and starts timers the
 * moment it loads, and what this layer reads off a page is the whole of the promise the layer
 * makes — so it has to be readable by a test with a real page in front of it. Everything here is
 * a function of the document it is handed: no state, no messages, no storage.
 *
 * What it reads is what the page itself wrote: its title, a few headings, the names beside its
 * boxes, the captions on its buttons. It never reads a value anybody typed, and it never
 * describes a box that could hold a password or a card number — see `isSecretField` in shape.ts
 * and `docs/CONSENT_V2.md`.
 */
import { isSecretField, type PageField } from "./shape";

/**
 * How many elements of one kind are described. A page with more than this is a page, not a form.
 *
 * It counts what is described, not what was looked at. Counting what was looked at meant a page
 * that carries its machinery first — a few hundred hidden inputs, as a server-rendered form
 * does — used the whole allowance on boxes nobody can see, and the page a person was actually
 * looking at arrived empty with `omitted` reading zero.
 */
export const SCAN_LIMIT = 400;

const textOf = (el: Element | null): string => (el ? (el.textContent ?? "").replace(/\s+/g, " ").trim() : "");

/** Only what somebody can actually see is described — a hidden input is machinery, not a question. */
const onScreen = (el: Element): boolean => el.getClientRects().length > 0;

/**
 * The name a person reads beside a box.
 *
 * The element's own `name` attribute is deliberately NOT a fallback: the probe found it carries
 * machinery rather than language (`authenticity_token`, `webauthn-iuvpaa-support`), and a box
 * nobody labelled says nothing worth sending.
 */
export function labelOf(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  const id = el.getAttribute("id");
  const tied = id ? el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
  return textOf(tied) || wrappingLabel(el) || el.getAttribute("placeholder") || "";
}

/**
 * The words of a label that wraps the box, without the boxes.
 *
 * `textContent` on a `<label>` takes every text node beneath it, and beneath it is the box
 * itself: what sits inside a `<textarea>` is what the person saved the last time they filled the
 * form in, and what sits inside a `<select>` is the list of choices. A server-rendered edit form
 * is exactly that shape, so a label of "소개" arrived carrying the whole self-introduction
 * underneath it, and a language picker arrived labelled with its own options.
 *
 * So the label is read from a copy with the controls taken out, which leaves the words the page
 * wrote for somebody to read and nothing that was ever a value. This is where the layer's
 * promise that it reads no value is actually kept for a wrapping label.
 */
function wrappingLabel(el: Element): string {
  const label = el.closest("label");
  if (!label) return "";
  const copy = label.cloneNode(true) as Element;
  for (const control of Array.from(copy.querySelectorAll("input, textarea, select, button, datalist, output"))) control.remove();
  return textOf(copy);
}

/**
 * The caption of a button: its own words, or the `value` attribute an `<input>` button carries
 * instead of text.
 *
 * This is the one place in this layer that reads anything spelled `value`, and it is its own
 * function so that a test can say so: on a button that attribute is the caption the page wrote
 * ("Search", "Pay"), never something a person typed. `page.test.ts` holds every other read of a
 * value out of this whole layer.
 */
export function actionName(el: Element): string {
  return el.getAttribute("aria-label") || textOf(el) || el.getAttribute("value") || "";
}

/** The first `SCAN_LIMIT` of these a person can see, described. Sight first, then the bound. */
function take<T>(doc: Document, selector: string, map: (el: HTMLElement) => T): T[] {
  const out: T[] = [];
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>(selector))) {
    if (!onScreen(el)) continue;
    out.push(map(el));
    if (out.length >= SCAN_LIMIT) break;
  }
  return out;
}

/** What this page is, in names: read here, bounded and shaped in shape.ts. */
export function readPage(doc: Document): { title: string; headings: string[]; fields: PageField[]; actions: string[] } {
  return {
    title: doc.title,
    headings: take(doc, "h1, h2, h3, [role=heading]", textOf),
    fields: take(doc, "input, textarea, select", (el) => {
      const box: PageField = {
        type: el.getAttribute("type") ?? el.tagName,
        autocomplete: el.getAttribute("autocomplete"),
        name: el.getAttribute("name"),
        id: el.getAttribute("id"),
      };
      // a box that can hold a secret is not labelled at all: its name is never read, only counted
      return isSecretField(box) ? box : { ...box, label: labelOf(el) };
    }),
    actions: take(doc, "button, [role=button], input[type=submit], input[type=button]", actionName),
  };
}
