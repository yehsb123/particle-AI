import { describe, it, expect } from "vitest";
import type { MatterEvent } from "@particle/contracts";
import { KafkaEventBus } from "./kafka";

/**
 * The kafka channel against a real broker, for anyone who has one.
 *
 * Skipped unless `DM_KAFKA_LIVE=1`, so an offline run stays green and nothing here is needed to
 * install the repository. Bring one up with `docker compose --profile kafka up -d kafka`.
 *
 * What a stand-in cannot prove is in here: that a real broker takes the partition key, that it
 * hands a session's events back in the order they were sent, and that a consumer group reads
 * them. Each run uses a topic and a group of its own, so it never reads somebody else's events
 * and leaves nothing behind that the next run has to step over.
 */
const live = process.env.DM_KAFKA_LIVE === "1";
const brokers = (process.env.DM_KAFKA_BROKERS ?? "127.0.0.1:9092").split(",").map((s) => s.trim()).filter(Boolean);
const run = Math.random().toString(36).slice(2, 10);

const event = (id: string, sessionId: string): MatterEvent => ({
  id,
  sessionId,
  timestamp: "2026-10-22T00:00:00.000Z",
  source: "sensor",
  type: "network.request",
  severity: "info",
  payload: { host: "api.example.com", status: 200 },
});

describe.skipIf(!live)("a real broker in the middle", () => {
  it("carries a session's events through the topic, in order", async () => {
    const config = { kind: "kafka" as const, brokers, topic: `dm-live-${run}`, groupId: `dm-live-${run}`, ssl: false };
    const bus = new KafkaEventBus<void>(config);
    await bus.start();
    const arrived: string[] = [];
    try {
      await bus.subscribe(async (e) => {
        arrived.push(e.id);
      });

      // A consumer that has just joined the group has not necessarily worked out where "latest"
      // is yet, and this one is told not to read from the beginning — so events published in the
      // same breath as the subscribe can land before it starts reading. That is a timing
      // assumption in this test, not in the runtime, where the subscribe happens at startup and
      // the events come later. Probe until one comes back, then measure the ordering.
      let probe = 0;
      await expect
        .poll(
          async () => {
            await bus.publish(event(`probe-${probe++}`, "probe-session"));
            return arrived.length > 0;
          },
          { timeout: 30_000, interval: 500 },
        )
        .toBe(true);

      const ids = Array.from({ length: 10 }, (_, i) => `live-${i}`);
      for (const id of ids) {
        const delivery = await bus.publish(event(id, "live-session"));
        expect(delivery).toMatchObject({ handled: false, via: "kafka", key: "live-session" });
      }

      const ours = () => arrived.filter((id) => id.startsWith("live-"));
      await expect.poll(() => ours().length, { timeout: 30_000, interval: 250 }).toBe(ids.length);
      expect(ours()).toEqual(ids);
    } finally {
      await bus.close();
    }
  }, 60_000);

  it("refuses something on the topic that is not an event, without stopping the partition", async () => {
    const config = { kind: "kafka" as const, brokers, topic: `dm-live-bad-${run}`, groupId: `dm-live-bad-${run}`, ssl: false };
    const refused: string[] = [];
    const bus = new KafkaEventBus<void>(config, { onRefused: (r) => refused.push(r.reason) });
    await bus.start();
    const arrived: string[] = [];
    try {
      await bus.subscribe(async (e) => {
        arrived.push(e.id);
      });
      // Written straight onto the topic, the way anything with the broker's address could.
      const raw = bus as unknown as { producer: { send(p: { topic: string; messages: { key: string; value: string }[] }): Promise<unknown> } };
      let probe = 0;
      await expect
        .poll(
          async () => {
            await bus.publish(event(`probe-${probe++}`, "probe-session"));
            return arrived.length > 0;
          },
          { timeout: 30_000, interval: 500 },
        )
        .toBe(true);

      await raw.producer.send({ topic: config.topic, messages: [{ key: "live-session", value: '{"id":"x"}' }] });
      await bus.publish(event("after-the-bad-one", "live-session"));

      await expect.poll(() => arrived.includes("after-the-bad-one"), { timeout: 30_000, interval: 250 }).toBe(true);
      expect(refused).toEqual(["not an event"]);
    } finally {
      await bus.close();
    }
  }, 60_000);
});
