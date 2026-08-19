import { KeyValueStore } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { Effect, Layer, Option } from "effect";

/**
 * `localStorage`, as a `KeyValueStore`.
 *
 * The session state Phase 5 moved into atoms — the role, the firm settings, the
 * records the prototype forms create — has to survive a reload, and the browser
 * offers exactly one place to put it. What this module adds is the interface
 * around it: `Rx.kvs` reads and writes through `KeyValueStore`, so the atom
 * depends on a service rather than on a global, and the same atom runs against
 * `KeyValueStore.layerMemory` in a test with nothing stubbed.
 *
 * ## Why not `@effect/platform-browser`
 *
 * It ships this layer, and its `localStorage` is reached at layer construction.
 * That is right for an application that only ever runs in a browser, and wrong
 * here: every screen in this app is server-rendered first, and Next builds a
 * client component's tree on the server before it ever reaches a browser. A
 * layer that touched `localStorage` there would fail on every render — quietly,
 * because the failure lands in a `Result` nobody reads, and visibly in the
 * server log, once per page.
 *
 * So the store is chosen when the layer is built rather than when the module is
 * loaded, and on the server it is the in-memory one. Nothing reads it there: the
 * atoms declare a server value, so the server renders the defaults and the
 * browser fills them in after hydration — the same two-step the
 * `useSyncExternalStore` version did, with the same absence of a hydration
 * mismatch.
 */

/**
 * Whether this process has a usable `localStorage`.
 *
 * Three separate things can be false. There may be no `window` at all, which is
 * every server render. `localStorage` may be absent. And *reading the property*
 * throws in Safari's private mode and under a blocked-cookies policy — which is
 * why this is a `try` around an access that looks like it cannot fail.
 */
const available = (): boolean => {
  try {
    return typeof window !== "undefined" && window.localStorage !== undefined;
  } catch {
    return false;
  }
};

/**
 * A write the browser refused.
 *
 * Both causes are worth telling apart in the log: a full quota is a real
 * problem with what is being stored, and a private window is a browser setting
 * nobody can do anything about. Neither is worth failing a render over — the
 * atom keeps the value in memory and the session simply does not persist — but
 * a silent `catch` would also hide the first one forever.
 */
const refused = (method: string, cause: unknown): SystemError =>
  new SystemError({
    reason:
      cause instanceof DOMException && cause.name === "QuotaExceededError"
        ? "WriteZero"
        : "PermissionDenied",
    module: "KeyValueStore",
    method,
    description:
      cause instanceof DOMException && cause.name === "QuotaExceededError"
        ? "Local storage is full."
        : "The browser refused access to local storage. Private browsing and a blocked-cookies policy both do this.",
    cause,
  });

const localStore = KeyValueStore.makeStringOnly({
  get: (key) =>
    Effect.try({
      try: () => Option.fromNullable(window.localStorage.getItem(key)),
      catch: (cause) => refused("get", cause),
    }),
  set: (key, value) =>
    Effect.try({
      try: () => window.localStorage.setItem(key, value),
      catch: (cause) => refused("set", cause),
    }),
  remove: (key) =>
    Effect.try({
      try: () => window.localStorage.removeItem(key),
      catch: (cause) => refused("remove", cause),
    }),
  clear: Effect.try({
    try: () => window.localStorage.clear(),
    catch: (cause) => refused("clear", cause),
  }),
  size: Effect.try({
    try: () => window.localStorage.length,
    catch: (cause) => refused("size", cause),
  }),
});

/**
 * The store, chosen where the answer is knowable.
 *
 * `Layer.suspend` defers the choice to the moment the layer is built, which is
 * the moment there either is a `window` or there is not. A module-level
 * conditional would be evaluated when the bundle is parsed, which on the server
 * is once per process and on the client is before hydration — both too early to
 * be asking.
 */
export const BrowserKeyValueStore: Layer.Layer<KeyValueStore.KeyValueStore> =
  Layer.suspend(() =>
    available()
      ? Layer.succeed(KeyValueStore.KeyValueStore, localStore)
      : KeyValueStore.layerMemory,
  );
