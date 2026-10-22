# ADR 0005 — The channel between a sensor and the loop, with Kafka as one of its shapes

- Status: Accepted
- Date: 2026-10-22

## Context

A sensor observed something and the runtime loop folded it into a belief, and between those two
there was nothing: the HTTP route called the loop. That worked, and it also meant the runtime
could only ever be one process. Running the sensors and the loop apart, or more than one runtime
behind one stream of events, had no seam to be built on.

The seam has to be free. The repository installs with no key, no broker and no service, and that
is the property most worth keeping: a part added here must not cost anybody an install, a
container or a line of configuration before the thing runs.

## Decision

A part, `@particle/event-bus`, with two ends: put one event in, take events out, close. The
default implementation is the in-process one, where publishing IS calling the loop — no
serialisation, no copy, no retry, no dependency. The runtime subscribes the session lanes to it
and publishes what arrives over HTTP into it.

`DM_EVENT_BUS=kafka` swaps the implementation for a producer and a consumer. `kafkajs` is loaded
by dynamic import through a variable specifier, so it is neither resolved by the type checker nor
walked by a bundler, and it is not in `package.json` — pnpm installs optional peer dependencies
by default, which would have put it in every install and in the lockfile. The session name is the
partition key, which is the only place a broker promises an order, and a session's order is what
the loop depends on.

Three rules hold the shape:

1. **No fallback.** Asking for Kafka and not getting it stops the runtime with what is missing
   and what to do about it. A quiet fall back to the in-process channel leaves somebody watching
   an empty topic, certain their events are on it.
2. **The topic is not a wider door than HTTP.** Everything consumed is parsed with the same
   `MatterEvent` contract and held to the same size limit. Changing the channel must not change
   what a sensor is able to say.
3. **The broker is the boundary, and it is not pretended to be there.** `DM_INGEST_TOKEN` holds
   every HTTP caller to a token; nothing holds a topic to it, so whoever can write to the topic
   can hand the loop an event. The answer is Kafka's own boundary — TLS, SASL and a topic-write
   ACL — rather than a signature invented here. A runtime holding callers to a token and pointed
   at a broker that is neither on this machine nor authenticated to does not start, and the
   compose broker is published on loopback only.
4. **A synchronous request is answered honestly.** With a broker in the middle the loop's result
   belongs to whichever runtime consumed the message, so the publisher answers `202` with where
   the event went instead of `200` with a world state it does not have.

## Consequences

- The default path is unchanged, byte for byte, and the default install has nothing new in it.
- A caller that waits gets a different answer in kafka mode. The simulation lab still draws, but
  from the WebSocket: the two things it reads only from the response (why a morph was held, and
  pattern suggestions merged from a click) are not shown there. If that trade is wrong, the fix
  is a reply topic with correlation ids and a timeout — a request-reply protocol over a stream,
  which is a great deal of machinery for a lab that already has a socket.
- The consumer swallows a loop failure into a report rather than letting it out of `eachMessage`,
  because an escaping failure makes the broker hand the same message back for ever and stops
  every session on that partition.
- The runtime makes sure its topic exists at startup. Measured on a fresh broker: subscribing to
  a topic that is not there yet is answered "this server does not host this topic-partition", and
  automatic creation races the first fetch.
