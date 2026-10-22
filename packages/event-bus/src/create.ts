import type { EventBus } from "./bus";
import { eventBusConfig } from "./config";
import { InProcessEventBus } from "./inproc";
import { KafkaEventBus, type KafkaDeps } from "./kafka";

/**
 * The channel the environment asked for, connected and ready.
 *
 * Saying nothing gives the in-process channel and touches nothing else: `kafkajs` is not loaded,
 * not resolved and not installed. Asking for kafka either gives a connected kafka channel or
 * throws — there is no third answer, on purpose.
 */
export async function createEventBus<R>(env: NodeJS.ProcessEnv, deps: KafkaDeps = {}): Promise<EventBus<R>> {
  const config = eventBusConfig(env);
  if (config.kind === "inproc") return new InProcessEventBus<R>();
  const bus = new KafkaEventBus<R>(config, deps);
  await bus.start();
  return bus;
}
