import { describe, it, expect } from "vitest";
import { t } from "../../lib/i18n";
import { restoredLang } from "./useSessionRestore";

/**
 * After a refresh the activity log said "session restored from the event log" in English, to a
 * person whose workspace had just come back in Korean.
 *
 * The restore is one mount effect, so the `lang` it can see is the first render's, and the first
 * render has not read storage yet. The effect sets the saved language a few lines above the
 * notice and the notice still gets "en": a value captured when the effect was created does not
 * change because a setter ran. The saved language has to be read and carried by hand.
 */
describe("the language a restored session is spoken to in", () => {
  it("takes the saved language, not the one on screen before storage was read", () => {
    expect(restoredLang("ko", "en")).toBe("ko");
    expect(restoredLang("en", "ko")).toBe("en");
  });

  it("keeps what is on screen when nothing readable was saved", () => {
    for (const stored of [null, "", "kr", "ko-KR", "EN", "__proto__"]) {
      expect(restoredLang(stored, "ko"), String(stored)).toBe("ko");
    }
  });

  it("says both notices in that language", () => {
    const lang = restoredLang("ko", "en");
    for (const key of ["restoredNote", "restoreFailedNote"]) {
      expect(t(key, lang), key).not.toBe(key); // a missing key draws itself on screen
      expect(t(key, lang), key).not.toBe(t(key, "en"));
    }
  });
});
