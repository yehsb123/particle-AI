import { describe, it, expect, vi, afterEach } from "vitest";
import { createLogger, type LogLevel } from "./index";

/**
 * A logger is called from inside catch blocks. One that throws turns a failure somebody was
 * handling into one nobody is: the runtime reports a snapshot that could not be saved, the
 * logger cannot serialise one of the fields, and the ingest that was carrying on regardless dies
 * instead. A circular object or a bigint was enough.
 *
 * Nothing here throws. The line still goes out saying its fields could not be written, because a
 * logger that quietly drops the whole line is the other way to lose the report.
 */
const circular = (): Record<string, unknown> => {
  const o: Record<string, unknown> = { name: "world" };
  o.self = o;
  return o;
};

const captured = () => {
  const lines: { level: LogLevel; msg: string; fields?: Record<string, unknown> }[] = [];
  return { lines, sink: (line: { level: LogLevel; msg: string; fields?: Record<string, unknown> }) => lines.push(line) };
};

afterEach(() => vi.restoreAllMocks());

describe("a field the logger cannot write", () => {
  const unwritable: [string, Record<string, unknown>][] = [
    ["a circular object", { state: circular() }],
    ["a bigint", { size: 10n as unknown as number }],
    ["both at once", { state: circular(), size: 9n as unknown as number }],
    ["one nested deep", { a: { b: { c: circular() } } }],
  ];

  it("does not throw at the caller", () => {
    const log = createLogger("info");
    vi.spyOn(console, "info").mockImplementation(() => {});
    for (const [what, fields] of unwritable) {
      expect(() => log.info("probe", fields), what).not.toThrow();
    }
  });

  it("still writes a line, and says the fields were lost", () => {
    const log = createLogger("info");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    log.info("snapshot_save_failed", { state: circular() });

    expect(info).toHaveBeenCalledTimes(1);
    const line = JSON.parse(info.mock.calls[0]![0] as string);
    expect(line.msg).toBe("snapshot_save_failed");
    expect(line.level).toBe("info");
    expect(line.fieldsUnserializable).toBe(true);
  });

  it("writes the ordinary lines exactly as before", () => {
    const log = createLogger("info");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    log.info("ingest", { sessionId: "s1", significance: 0.8, morph: true });

    const line = JSON.parse(info.mock.calls[0]![0] as string);
    expect(line).toEqual({ level: "info", msg: "ingest", sessionId: "s1", significance: 0.8, morph: true });
  });

  it("is still filtered by level, so a quiet run stays quiet", () => {
    const log = createLogger("warn");
    const debug = vi.spyOn(console, "log").mockImplementation(() => {});
    log.debug("probe", { state: circular() });
    expect(debug).not.toHaveBeenCalled();
  });
});

describe("a sink the host supplied", () => {
  it("gets the fields as they are, untouched", () => {
    const { lines, sink } = captured();
    const log = createLogger("info", sink);
    const fields = { sessionId: "s1", count: 2 };
    log.warn("probe", fields);
    expect(lines).toEqual([{ level: "warn", msg: "probe", fields }]);
  });

  it("cannot fail the caller by throwing", () => {
    const log = createLogger("info", () => {
      throw new Error("the host's own bug");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => log.error("ingest_failed", { sessionId: "s1" })).not.toThrow();
  });

  it("has its failure reported rather than swallowed", () => {
    const log = createLogger("info", () => {
      throw new Error("the host's own bug");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    log.error("ingest_failed", { sessionId: "s1" });

    expect(error).toHaveBeenCalledTimes(1);
    const line = JSON.parse(error.mock.calls[0]![0] as string);
    expect(line).toEqual({ level: "error", msg: "ingest_failed", sinkFailed: true });
  });

  it("is given a field it cannot write without the logger stopping it", () => {
    // the host decides what to do with what it is handed; the logger's job is to hand it over
    const { lines, sink } = captured();
    const log = createLogger("info", sink);
    expect(() => log.info("probe", { state: circular() })).not.toThrow();
    expect(lines).toHaveLength(1);
  });
});
