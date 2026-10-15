import { z } from "zod";
import { Identifier } from "./common";

/**
 * How a person's own AI account reaches this runtime.
 *
 * Two ways, and the difference between them is not a detail: a key is a secret the person pasted
 * into an environment file and handed over, while a signed-in browser session is a door that is
 * already open on their machine and that this runtime would have to walk through on their behalf.
 * The second one is not built. The vocabulary is closed so that a third way cannot arrive as a
 * free-text label nobody translated, routed on, or thought about.
 */
export const ACCOUNT_LINK_KINDS = ["api_key", "browser_session"] as const;
export const AccountLinkKind = z.enum(ACCOUNT_LINK_KINDS);
export type AccountLinkKind = z.infer<typeof AccountLinkKind>;

/**
 * What the runtime can say about a link without guessing.
 *
 * `not_operable` is the honest third answer and the reason this is not a boolean. A session the
 * person declared is not "not linked" — they told the runtime about it — and it is not "linked"
 * either, because nothing here can drive a browser yet. Collapsing it either way would be a
 * claim: that the person never set it up, or that it is working.
 */
export const ACCOUNT_LINK_STATES = ["linked", "not_linked", "not_operable"] as const;
export const AccountLinkState = z.enum(ACCOUNT_LINK_STATES);
export type AccountLinkState = z.infer<typeof AccountLinkState>;

/** Why the link is in that state, in words the body can translate rather than a sentence it cannot. */
export const ACCOUNT_LINK_REASONS = [
  "api_key_present",
  "credential_absent",
  "session_control_not_built",
] as const;
export const AccountLinkReason = z.enum(ACCOUNT_LINK_REASONS);
export type AccountLinkReason = z.infer<typeof AccountLinkReason>;

/**
 * One account, as the person is shown it.
 *
 * `.strict()` is the point of this schema. Everything here is built from environment values, and
 * the describing travels: to `/api/brain`'s neighbour, into a React screen, into whatever a
 * person pastes into a bug report. A field nobody declared is refused outright rather than
 * stripped in silence, so a future edit that reaches for the key it already has in hand fails
 * loudly at the schema instead of shipping it to the screen.
 *
 * `account` names the service the link reaches — `api.anthropic.com`, `claude.ai` — not who the
 * person is on it. The runtime does not ask who the account belongs to, and a label it did not
 * verify is not one it should print.
 */
export const AccountLink = z
  .object({
    /** the provider id this link feeds, matching `IntelligenceProvider.id` */
    providerId: Identifier,
    /** the service the link reaches; never a credential, never an identity */
    account: Identifier,
    kind: AccountLinkKind,
    state: AccountLinkState,
    /** what the provider answered just now — whether the link is alive, not whether it exists */
    healthy: z.boolean(),
    reasonCode: AccountLinkReason,
  })
  .strict();
export type AccountLink = z.infer<typeof AccountLink>;
