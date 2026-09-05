import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server";
import type { SessionRuntime } from "./runtime";
import { AuditRecord } from "@particle/contracts";

/**
 * The trail is what someone reads to find out why the body looks the way it does, and each record
 * identifies itself — the inspector draws one row per record, keyed by its id.
 *
 * Two things were wrong with it. A reversal took its id from the clock, so two in the same
 * millisecond were the same record as far as anything reading could tell, and a multi-step "go
 * back" makes exactly that. And a resume, which replaces both what the runtime believes and what
 * the body shows with something an earlier process wrote, left no mark at all — while undo and
 * redo, its siblings three lines away, had written to the trail all along.
 */
let app: FastifyInstance;
let runtime: SessionRuntime;

beforeEach(async () => {
  ({ app, runtime } = await buildServer());
  await app.ready();
});
afterEach(async () => {
  await app.close();
});

/** Enough morphs that several reversals are possible. */
const busy = async (session: string) => {
  for (const key of ["http-500", "recovered", "build-failed", "build-ok", "high-cpu"]) {
    await app.inject({ method: "POST", url: `/api/sim/${session}/${key}` });
  }
};
const ids = (session: string) => runtime.audit.list(session).map((r) => r.id);

describe("every record on the trail", () => {
  it("says who it is, and no two say the same thing", async () => {
    await busy("trail");
    // as fast as the process can make them: this is what a go-back gesture does
    expect(runtime.undo("trail")).not.toBeNull();
    expect(runtime.undo("trail")).not.toBeNull();
    expect(runtime.redo("trail")).not.toBeNull();
    expect(runtime.redo("trail")).not.toBeNull();

    const recorded = ids("trail");
    expect(recorded.length).toBeGreaterThan(4);
    expect(new Set(recorded).size).toBe(recorded.length);
  });

  it("keeps its id to itself across sessions too", async () => {
    await busy("a");
    await busy("b");
    runtime.undo("a");
    runtime.undo("b");
    const all = runtime.audit.list().map((r) => r.id);
    expect(new Set(all).size).toBe(all.length);
  });

  it("is a record the contract accepts", async () => {
    await busy("shape");
    runtime.undo("shape");
    await app.inject({ method: "POST", url: "/api/sessions/shape/resume" });
    for (const record of runtime.audit.list("shape")) {
      expect(AuditRecord.safeParse(record).success, record.kind).toBe(true);
    }
  });

  it("belongs to the session it names, and is listed only there", async () => {
    await busy("mine");
    await busy("theirs");
    runtime.undo("mine");
    for (const record of runtime.audit.list("mine")) expect(record.sessionId).toBe("mine");
    expect(runtime.audit.list("theirs").some((r) => r.kind === "morph_undone")).toBe(false);
  });
});

describe("a session brought back from a snapshot", () => {
  it("says so on the trail, where undo and redo have always said so", async () => {
    await busy("res");
    const before = runtime.audit.list("res").length;
    const r = await app.inject({ method: "POST", url: "/api/sessions/res/resume" });
    expect(r.statusCode).toBe(200);
    expect(r.json().resumed).toBe(true);

    const added = runtime.audit.list("res").slice(before);
    expect(added.map((x) => x.kind)).toContain("session_resumed");
  });

  it("says what came back", async () => {
    await busy("what");
    await app.inject({ method: "POST", url: "/api/sessions/what/resume" });
    const record = runtime.audit.list("what").find((x) => x.kind === "session_resumed")!;
    expect(record).toBeDefined();
    expect(typeof record.detail.world).toBe("boolean");
    expect(typeof record.detail.blueprint).toBe("boolean");
    expect(typeof record.detail.memory).toBe("boolean");
    expect(record.detail.world || record.detail.blueprint).toBe(true);
  });

  it("says nothing when there was nothing to bring back", async () => {
    const r = await app.inject({ method: "POST", url: "/api/sessions/never-saved/resume" });
    expect(r.json().resumed).toBe(false);
    expect(runtime.audit.list("never-saved").some((x) => x.kind === "session_resumed")).toBe(false);
  });

  it("writes one record per resume, each with its own id", async () => {
    await busy("twice");
    for (let i = 0; i < 3; i++) await app.inject({ method: "POST", url: "/api/sessions/twice/resume" });
    const resumes = runtime.audit.list("twice").filter((x) => x.kind === "session_resumed");
    expect(resumes).toHaveLength(3);
    expect(new Set(resumes.map((x) => x.id)).size).toBe(3);
  });
});
