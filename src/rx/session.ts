import { Result, Rx } from "@effect-rx/rx-react";
import { KeyValueStore } from "@effect/platform";
import { Effect, Option, type Schema } from "effect";
import type { FirmSettings, Invoice, InvoiceStatus, Role } from "../lib/types";
import { browserRuntime } from "./browser";
import {
  CreatedRecords,
  DEFAULT_SETTINGS,
  InvoiceOverrides,
  NO_RECORDS,
  RoleSchema,
  Settings,
} from "./records";

/**
 * The session: what this browser is doing, and what it has created.
 *
 * This replaces `components/AppState.tsx` — a context provider around a
 * `useSyncExternalStore` around a module-level object, with the persistence
 * hand-rolled inside it. Nothing about that was wrong; it was simply four
 * concerns in one file, and every screen took all four through one hook whether
 * it read one of them or all of them.
 *
 * As atoms they are four independent values. A component that reads the role
 * re-renders when the role changes and not when an invoice is marked paid,
 * which the single context object could not offer. Persistence is a
 * `KeyValueStore` call rather than a `try`/`catch` around `localStorage`, and
 * what comes back out is decoded through a schema instead of trusted.
 */

/**
 * A value that outlives the tab.
 *
 * Three atoms, because the three states are genuinely different and screens
 * need to tell them apart:
 *
 * - `loaded` is the read, as a `Result`. `Initial` means the store has not
 *   answered yet, which is not the same as "nothing is stored" — a screen that
 *   confuses those renders "no such client" for a client that is about to
 *   appear.
 * - the returned atom is the value, defaulted while the read is in flight and
 *   written through to storage on every set.
 * - `ready` is `loaded` collapsed to a boolean, which is all a screen that just
 *   needs to wait actually wants.
 *
 * `Rx.kvs` from the library does the middle one and hides the other two behind
 * `Result.getOrElse`. That is the right shape for a preference nobody waits on
 * and the wrong one here, so this is the same idea with the `Result` left where
 * it can be read.
 *
 * The server value is the default. `useSyncExternalStore` reads it during the
 * server render *and* during hydration, so the first client render matches the
 * HTML exactly and the stored value arrives on the commit after — no mismatch
 * to reconcile, and no `useEffect` seeding state on mount.
 */
const stored = <A, I>(
  key: string,
  schema: Schema.Schema<A, I>,
  fallback: A,
): {
  readonly atom: Rx.Writable<A>;
  readonly ready: Rx.Rx<boolean>;
} => {
  const loaded = browserRuntime.rx(
    Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      const value = yield* store.forSchema(schema).get(key);
      return Option.getOrElse(value, () => fallback);
    }),
  );

  const save = browserRuntime.fn((value: A) =>
    Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      yield* store.forSchema(schema).set(key, value);
    }),
  );

  const atom = Rx.writable<A, A>(
    (get) => {
      // Mounted so the write atom's fiber lives as long as this one does; the
      // set is a fire-and-forget from the caller's point of view.
      get.mount(save);
      return Result.getOrElse(get(loaded), () => fallback);
    },
    (context, value) => {
      context.set(save, value);
      context.setSelf(value);
    },
  ).pipe(Rx.withServerValue(() => fallback));

  return {
    atom,
    ready: Rx.map(loaded, Result.isNotInitial).pipe(
      Rx.withServerValue(() => false),
    ),
  };
};

/**
 * Keys are per value rather than one blob.
 *
 * The module this replaced wrote all four under `oklaw.appstate.v1`, which
 * meant every set rewrote everything and a single unreadable field discarded
 * the lot. Nothing migrates the old key: it holds a prototype's session state,
 * and a migration would be code that exists to preserve four values nobody
 * would miss.
 */
const role = stored("oklaw.role.v1", RoleSchema, "Managing Partner" as Role);
const settings = stored("oklaw.settings.v1", Settings, DEFAULT_SETTINGS);
const records = stored("oklaw.records.v1", CreatedRecords, NO_RECORDS);
const overrides = stored("oklaw.invoice-status.v1", InvoiceOverrides, {});

/** Which of the seven roles the browser is currently playing (D-5). */
export const roleRx: Rx.Writable<Role> = role.atom;

/** The firm-wide preferences an administrator sets. */
export const settingsRx: Rx.Writable<FirmSettings> = settings.atom;

/** What the prototype's forms have created, for the modules with no backend. */
export const recordsRx: Rx.Writable<CreatedRecords> = records.atom;

/** Invoice id → status, layered over the seed data when a payment lands. */
export const invoiceOverridesRx: Rx.Writable<InvoiceOverrides> = overrides.atom;

/**
 * False until every stored value has been read.
 *
 * Screens that would otherwise flash a wrong answer — the default role in the
 * masthead, "no such client" for one the intake form created — wait on this.
 * It is the conjunction rather than any one read, because a screen that waits
 * wants to be sure about all of it.
 */
export const hydratedRx: Rx.Rx<boolean> = Rx.readable(
  (get) =>
    get(role.ready) &&
    get(settings.ready) &&
    get(records.ready) &&
    get(overrides.ready),
).pipe(Rx.withServerValue(() => false));

/** The effective status of an invoice, override applied. */
export const statusOf = (
  applied: InvoiceOverrides,
  invoice: Invoice,
): InvoiceStatus => applied[invoice.id] ?? invoice.status;
