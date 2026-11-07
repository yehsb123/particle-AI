/**
 * Why a provider call failed, carried as a value rather than inferred from a sentence.
 *
 * The decision engine picks the reason code it writes into the audit trail from these. It used to
 * pick that code by running a regular expression over the error's message, which quietly made the
 * wording of a message in this package part of another package's behaviour: adding detail to
 * `jsonFromText`'s error reclassified every unparseable answer as a plain provider error, and
 * nothing anywhere failed until one test that happened to assert the code caught it.
 *
 * A reader of the trail has to be able to tell these apart. A model that answered in prose when
 * it was asked for JSON, a turn the model never finished, and a provider that could not be
 * reached are three different problems with three different things to do about them.
 */
export const PROVIDER_FAILURES = ["no_api_key", "unparseable_output", "incomplete_turn"] as const;
export type ProviderFailure = (typeof PROVIDER_FAILURES)[number];

export class ProviderError extends Error {
  readonly failure: ProviderFailure;
  constructor(failure: ProviderFailure, message: string) {
    super(message);
    this.name = "ProviderError";
    this.failure = failure;
  }
}

/**
 * The failure an error carries, or null.
 *
 * Anything at all can be thrown, including an object from outside this process that happens to
 * have a `failure` field, so the value is checked against the list rather than trusted and cast.
 */
export function failureOf(err: unknown): ProviderFailure | null {
  const carried = (err as { failure?: unknown } | null | undefined)?.failure;
  if (typeof carried !== "string") return null;
  return (PROVIDER_FAILURES as readonly string[]).includes(carried) ? (carried as ProviderFailure) : null;
}
