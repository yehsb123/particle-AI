import type {
  IntelligenceRequest,
  IntelligenceResult,
  ModelCapability,
  ProviderHealth,
} from "@particle/contracts";
import { Identifier } from "@particle/contracts";
import type { IntelligenceProvider } from "./provider";

/** Prefix that keeps a session provider's id apart from the brain ids the tier table knows. */
export const SESSION_PROVIDER_PREFIX = "session:";

/** The one reason a session provider ever gives, matching the contracts reason vocabulary. */
export const SESSION_CONTROL_NOT_BUILT = "session_control_not_built";

export type BrowserSessionOptions = {
  /** the host the person is signed into, e.g. "claude.ai" */
  host: string;
};

/**
 * The place a signed-in browser session will occupy, and nothing more.
 *
 * A person who already pays for claude.ai or chatgpt.com has a brain available that this runtime
 * cannot reach, because reaching it means driving their browser — their cookies, their session,
 * an action taken as them. That is a different thing from posting a key to an API, and it is not
 * built. What is built is the place: the environment can declare one, the router can see it, and
 * the body can show the person it is there.
 *
 * So the whole of this class is a refusal, said three ways, because one way is missable:
 *   - `capabilities` is empty, so the router filters it out before it ever asks about health;
 *   - `health()` answers no, with the reason;
 *   - `evaluate()` throws rather than returning something that reads like an answer.
 * `operable` is the fourth, in the type: a reader who writes `if (provider.operable)` gets a
 * compile error on the branch that assumes this works, and the day it does work this literal is
 * what has to change first.
 */
export class BrowserSessionProvider implements IntelligenceProvider {
  readonly id: string;
  readonly host: string;
  /** Not a flag that flips at runtime — a literal that says this provider cannot act. */
  readonly operable = false as const;
  /** Empty on purpose: there is no kind of thinking this can be asked to do yet. */
  readonly capabilities: ModelCapability[] = [];

  constructor(opts: BrowserSessionOptions) {
    // the host comes from the environment and is shown to the person, so it is held to the same
    // rule as any other name the runtime acts on rather than trusted the length of the file
    this.host = Identifier.parse(opts.host);
    this.id = `${SESSION_PROVIDER_PREFIX}${this.host}`;
  }

  async evaluate(_request: IntelligenceRequest): Promise<IntelligenceResult> {
    throw new Error(`${this.id}: ${SESSION_CONTROL_NOT_BUILT} — a signed-in browser session cannot be driven yet`);
  }

  async health(): Promise<ProviderHealth> {
    return { id: this.id, healthy: false, detail: `${SESSION_CONTROL_NOT_BUILT}` };
  }
}

/**
 * The sessions the person declared, one provider each.
 *
 * `DM_BROWSER_SESSIONS` is a comma-separated host list, read the way the other list variables in
 * this repo are read. A host named twice is one account, not two rows in the person's view, and a
 * value that is not a name is refused out loud at startup rather than carried into the body —
 * the same answer `envNumber` gives a number it cannot use.
 */
export function browserSessionsFromEnv(env: NodeJS.ProcessEnv = process.env): BrowserSessionProvider[] {
  const hosts = (env.DM_BROWSER_SESSIONS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(hosts)].map((host) => {
    const checked = Identifier.safeParse(host);
    if (!checked.success) {
      throw new Error(`DM_BROWSER_SESSIONS must be a comma-separated list of hosts; got ${JSON.stringify(host.slice(0, 40))}`);
    }
    return new BrowserSessionProvider({ host: checked.data });
  });
}
