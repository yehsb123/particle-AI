import { describe, it, expect } from "vitest";
import { KNOWN_EVENT_TYPES } from "@particle/contracts";
import { parseWindowLine, windowShape, sameWindow, WindowTracker, windowSensor, windowScript, envFlag, MAX_NAME } from "./shape";

/**
 * The fourth sense: which application window is in front. It is a shape like the others — the
 * name of the program and the title of the window, never anything that is inside either.
 *
 * Two things measured on a real desktop decide most of what is here. A window title animates: a
 * terminal running this repository alternated between two spinner characters twice a second, so
 * a sensor comparing titles letter for letter would have reported a window switch every half
 * second, forever. And the window in front is often a browser, whose tabs the extension already
 * reports by host — the same fact told twice, less precisely the second time.
 */
const ESC = "\u001b";
const TAB = "\t";
const SPIN_A = "\u25d1";
const SPIN_B = "\u25d0";
const line = (app: string, title: string) => app + TAB + title;

describe("a line read off the window in front", () => {
  it("is the program and the title it was printed with", () => {
    expect(parseWindowLine(line("Code", "shape.ts - digital-matter - Visual Studio Code"))).toEqual({
      app: "Code",
      title: "shape.ts - digital-matter - Visual Studio Code",
    });
  });

  it("keeps a title that has a tab of its own in one piece", () => {
    expect(parseWindowLine(line("Excel", "a" + TAB + "b"))?.title).toBe("a" + TAB + "b");
  });

  it("is a window with no title when the program has none", () => {
    expect(parseWindowLine(line("explorer", ""))).toEqual({ app: "explorer", title: "" });
  });

  it("is nothing when the line is not one this sensor printed", () => {
    for (const bad of ["", "   ", "no tab at all"]) {
      expect(parseWindowLine(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("what this sensor will say about a window", () => {
  it("is the program name and the window title, and nothing else", () => {
    const shape = windowShape("Code", "shape.ts - Visual Studio Code");
    expect(shape).toEqual({ app: "Code", window: "shape.ts - Visual Studio Code" });
    expect(Object.keys(shape ?? {})).toEqual(["app", "window"]);
  });

  it("is nothing about a browser window, because the extension already says it better", () => {
    // the extension reports the TAB as site:<host>; this would be the same fact, coarser
    for (const app of ["chrome", "Chrome", "msedge", "msedge.exe", "brave", "chromium", "vivaldi", "opera", "whale"]) {
      expect(windowShape(app, "Instagram"), app).toBeNull();
    }
  });

  it("is still said for a program whose name merely contains a browser name", () => {
    expect(windowShape("chromedriver", "x")).not.toBeNull();
    expect(windowShape("operator-console", "x")).not.toBeNull();
  });

  it("is nothing when there is no program to name", () => {
    for (const app of [undefined, null, "", "   ", 7, {}]) {
      expect(windowShape(app, "a title"), JSON.stringify(app) ?? "undefined").toBeNull();
    }
  });

  it("carries no escape sequence and no unbounded name out of the window manager", () => {
    // a window title is whatever the program was told to call itself, and this one is written
    // into an event, into a card somebody reads, and into this process's own stderr
    expect(windowShape("Code", ESC + "[31mred" + ESC + "[0m")?.window).toBe("[31mred[0m");
    expect(windowShape("Code", "t".repeat(10_000))?.window.length).toBeLessThanOrEqual(MAX_NAME + 1);
    expect(windowShape("a".repeat(10_000), "t")?.app.length).toBeLessThanOrEqual(MAX_NAME + 1);
  });
});

describe("whether two readings are the same window", () => {
  const shape = (app: string, title: string) => windowShape(app, title)!;

  it("is yes while only the moving part of the title moves", () => {
    // measured: a terminal running this repository alternated twice a second
    expect(sameWindow(shape("WindowsTerminal", SPIN_A + " particle"), shape("WindowsTerminal", SPIN_B + " particle"))).toBe(true);
    expect(sameWindow(shape("Code", "* shape.ts"), shape("Code", "shape.ts"))).toBe(true);
  });

  it("is no when a number in the title changed, because that is not decoration", () => {
    expect(sameWindow(shape("Slack", "(3) general"), shape("Slack", "(11) general"))).toBe(false);
  });

  it("is no when the person moved to another window of the same program", () => {
    expect(sameWindow(shape("Code", "shape.ts"), shape("Code", "index.ts"))).toBe(false);
  });

  it("is no when the program changed, whatever the title says", () => {
    expect(sameWindow(shape("Code", "notes"), shape("notepad", "notes"))).toBe(false);
  });

  it("is yes for a title that is nothing but moving parts, which is one window spinning", () => {
    expect(sameWindow(shape("WindowsTerminal", SPIN_A), shape("WindowsTerminal", SPIN_B))).toBe(true);
  });
});

describe("the active window sensor, reading its own output", () => {
  it("reports the window in front once, and says nothing while its title animates", () => {
    const t = new WindowTracker();
    expect(t.feed(line("WindowsTerminal", SPIN_A + " particle"))).toMatchObject({
      type: "user.focused_window",
      source: "user",
      severity: "debug",
      payload: { app: "WindowsTerminal", window: SPIN_A + " particle" },
    });
    for (let i = 0; i < 20; i++) {
      expect(t.feed(line("WindowsTerminal", (i % 2 ? SPIN_B : SPIN_A) + " particle")), String(i)).toBeNull();
    }
  });

  it("reports the next window when the person actually moves to one", () => {
    const t = new WindowTracker();
    t.feed(line("Code", "shape.ts - digital-matter"));
    expect(t.feed(line("Code", "shape.ts - digital-matter"))).toBeNull();
    expect(t.feed(line("Slack", "particle - general"))).toMatchObject({ payload: { app: "Slack", window: "particle - general" } });
    expect(t.feed(line("Code", "shape.ts - digital-matter"))).toMatchObject({ payload: { app: "Code" } });
  });

  it("says nothing at all about a browser, and does not forget where the person was", () => {
    const t = new WindowTracker();
    t.feed(line("Code", "shape.ts"));
    expect(t.feed(line("chrome", "Instagram"))).toBeNull();
    expect(t.feed(line("msedge", "mail - Outlook"))).toBeNull();
    // back in the editor: the window it was already reporting, so there is nothing new to say
    expect(t.feed(line("Code", "shape.ts"))).toBeNull();
  });

  it("says nothing about a line it cannot read", () => {
    const t = new WindowTracker();
    for (const bad of ["", "   ", "no tab at all", TAB + "a title with no program"]) {
      expect(t.feed(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("sends a type the runtime has a word for", () => {
    const signal = new WindowTracker().feed(line("Code", "shape.ts"))!;
    expect(KNOWN_EVENT_TYPES as readonly string[]).toContain(signal.type);
  });
});

describe("whether this sensor runs at all", () => {
  it("runs on Windows when somebody asked for it, quietly", () => {
    expect(windowSensor("win32", true)).toEqual({ run: true, note: null });
  });

  it("does not run, and says nothing, when nobody asked", () => {
    for (const platform of ["win32", "darwin", "linux"]) {
      expect(windowSensor(platform, false), platform).toEqual({ run: false, note: null });
    }
  });

  it("does not run anywhere else, and tells the person who asked why", () => {
    // the reading is the Windows UI Automation API; every other sense is unaffected by this
    for (const platform of ["darwin", "linux", "freebsd"]) {
      const decision = windowSensor(platform, true);
      expect(decision.run, platform).toBe(false);
      expect(decision.note ?? "", platform).toContain(platform);
    }
  });
});

describe("the reading script this sensor runs", () => {
  it("waits the interval it was given between readings", () => {
    expect(windowScript(1_500, 4242)).toContain("1500");
    expect(windowScript(250, 4242)).toContain("250");
  });

  it("refuses an interval that is not a whole number of milliseconds", () => {
    // the interval is written into a script another program runs, so anything but a number is a
    // way into this machine
    for (const bad of ["500; Remove-Item -Recurse C:/", 1.5, NaN, Infinity, -1, undefined, null]) {
      expect(() => windowScript(bad as number, 4242), JSON.stringify(bad) ?? "undefined").toThrow();
      expect(() => windowScript(1_000, bad as number), JSON.stringify(bad) ?? "undefined").toThrow();
    }
  });

  it("stops itself when the agent that started it is gone", () => {
    // it reads the whole desktop and nobody can see it: a reader that outlives the agent is a
    // sensor somebody stopped and did not stop
    expect(windowScript(1_000, 4242)).toContain("4242");
  });

  it("asks for a program name and a window title, and never for what is in the window", () => {
    const script = windowScript(1_000, 4242);
    expect(script).toContain("GetForegroundWindow");
    expect(script).toContain("ProcessId");
    for (const reach of ["Get-Clipboard", "GetWindowText", "SendKeys", "Get-Content", "Invoke-WebRequest", "TextPattern", "ValuePattern"]) {
      expect(script, reach).not.toContain(reach);
    }
  });
});

describe("the switch that turns this sensor on", () => {
  it("is off until somebody turns it on, which is what an env file usually says", () => {
    for (const nothing of [undefined, null, "", "   "]) {
      expect(envFlag(nothing, "DM_WATCH_WINDOWS"), JSON.stringify(nothing) ?? "undefined").toBe(false);
    }
  });

  it("is on for the words a person writes for yes", () => {
    for (const yes of ["1", "true", "TRUE", " yes ", "on"]) {
      expect(envFlag(yes, "DM_WATCH_WINDOWS"), yes).toBe(true);
    }
  });

  it("is off for the words a person writes for no, rather than on for having been written", () => {
    // a value that is present but says no used to be the trap: anything non-empty read as yes,
    // so DM_WATCH_WINDOWS=0 would have started watching the desktop
    for (const no of ["0", "false", "FALSE", "no", "off"]) {
      expect(envFlag(no, "DM_WATCH_WINDOWS"), no).toBe(false);
    }
  });

  it("refuses a value that says neither, naming the variable and what it got", () => {
    for (const unclear of ["maybe", "2", "sure"]) {
      expect(() => envFlag(unclear, "DM_WATCH_WINDOWS"), unclear).toThrow(/DM_WATCH_WINDOWS/);
    }
  });
});
