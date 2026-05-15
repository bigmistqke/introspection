import type {
  EventsFilter,
  TraceReader,
  TraceEvent,
} from "@introspection/types";
import { createDebug } from "@introspection/utils";
import { createEffect, onCleanup, type Accessor } from "solid-js";
import { createStore, reconcile } from "solid-js/store";

let watchId = 0;

/**
 * Bridges a TraceReader's query.watch() AsyncIterable into a Solid signal.
 * Re-subscribes when the trace accessor changes.
 */
export function useWatchedQuery(
  getTrace: Accessor<TraceReader | undefined>,
  filter?: EventsFilter,
  options?: { filter?: EventsFilter; verbose?: boolean },
) {
  const id = ++watchId;
  const label = filter ? JSON.stringify(filter) : "*";
  const debug = createDebug(
    `useWatchedQuery#${id}[${label}]`,

    options?.verbose ?? false,
  );

  const [events, setEvents] = createStore<TraceEvent[]>([]);

  debug("created");

  createEffect(() => {
    const trace = getTrace();

    debug("effect fired, trace:", trace ? trace.id : "undefined");

    if (!trace) {
      console.log("this happens????");
      setEvents([]);
      return;
    }

    const iterable = filter
      ? trace.events.query.watch(filter)
      : trace.events.ls.watch();

    debug("iterable created, using", filter ? "query.watch" : "ls.watch");

    const iterator = iterable[Symbol.asyncIterator]();
    let stopped = false;

    async function consume() {
      debug("consume started");
      while (!stopped) {
        debug("calling next()");
        const result = await iterator.next();
        debug(
          "next() resolved, done:",
          result.done,
          "count:",
          result.done ? 0 : result.value.length,
        );
        if (result.done) break;
        setEvents(reconcile(result.value));

        debug(
          "setEvents called with",
          result.value.length,
          "events, signal reads:",
          events.length,
        );
      }
      debug("consume ended, stopped:", stopped);
    }
    consume();

    onCleanup(() => {
      debug("cleanup, stopping iterator");
      stopped = true;
      iterator.return?.();
    });
  });

  return events;
}
