"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import {
  ROLES,
  type Appointment,
  type Case,
  type Client,
  type Communication,
  type FirmDocument,
  type FirmSettings,
  type FirmTask,
  type Hearing,
  type Invoice,
  type InvoiceStatus,
  type PortalMessage,
  type Role,
  type TimeEntry,
  type UserAccount,
} from "@/lib/types";

const STORAGE_KEY = "oklaw.appstate.v1";

/**
 * Records the forms create, kept alongside the seed data rather than merged
 * into it: a screen reads `[...SEED, ...records.x]` and the seeded fixtures
 * stay untouched. Newest first, so a just-created record lands at the top of
 * the list that made it.
 */
export interface CreatedRecords {
  clients: Client[];
  cases: Case[];
  hearings: Hearing[];
  tasks: FirmTask[];
  timeEntries: TimeEntry[];
  appointments: Appointment[];
  documents: FirmDocument[];
  invoices: Invoice[];
  communications: Communication[];
  users: UserAccount[];
  messages: PortalMessage[];
}

const EMPTY_RECORDS: CreatedRecords = {
  clients: [],
  cases: [],
  hearings: [],
  tasks: [],
  timeEntries: [],
  appointments: [],
  documents: [],
  invoices: [],
  communications: [],
  users: [],
  messages: [],
};

const DEFAULT_SETTINGS: FirmSettings = {
  firmName: "OKLaw Advocates",
  currency: "KES",
  timezone: "Africa/Nairobi",
  dateFormat: "DD MMM YYYY",
  channels: ["In-app", "Email", "SMS"],
};

interface PersistedState {
  role: Role;
  /** Invoice id → status, layered over the seed data when a payment lands. */
  invoiceOverrides: Record<number, InvoiceStatus>;
  records: CreatedRecords;
  settings: FirmSettings;
}

const INITIAL: PersistedState = {
  role: "Managing Partner",
  invoiceOverrides: {},
  records: EMPTY_RECORDS,
  settings: DEFAULT_SETTINGS,
};

interface AppState extends PersistedState {
  setRole: (role: Role) => void;
  /** Effective status of an invoice, override applied. */
  statusOf: (invoice: Invoice) => InvoiceStatus;
  markPaid: (invoiceId: number) => void;
  /** Files a record created by one of the forms. */
  add: <K extends keyof CreatedRecords>(
    kind: K,
    record: CreatedRecords[K][number],
  ) => void;
  saveSettings: (settings: FirmSettings) => void;
  /**
   * False during the first client render, while the persisted state is still
   * being read. Screens that would otherwise flash the default role can wait.
   */
  hydrated: boolean;
}

const AppStateContext = createContext<AppState | null>(null);

function isRole(value: unknown): value is Role {
  return ROLES.includes(value as Role);
}

/** Keeps only the lists that survived a round trip through storage. */
function readRecords(value: unknown): CreatedRecords {
  const stored = (
    typeof value === "object" && value !== null ? value : {}
  ) as Record<string, unknown>;
  const records = { ...EMPTY_RECORDS };
  // Written through an index signature: a per-key assignment would have to
  // satisfy every list type at once.
  const writable = records as Record<string, unknown[]>;
  for (const kind of Object.keys(EMPTY_RECORDS)) {
    const list = stored[kind];
    if (Array.isArray(list)) writable[kind] = list;
  }
  return records;
}

function readStored(): PersistedState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { role, invoiceOverrides, records, settings } =
      parsed as Partial<PersistedState>;
    return {
      role: isRole(role) ? role : INITIAL.role,
      invoiceOverrides:
        typeof invoiceOverrides === "object" && invoiceOverrides !== null
          ? invoiceOverrides
          : {},
      records: readRecords(records),
      // Settings gained fields across versions; fill any the store predates.
      settings: { ...DEFAULT_SETTINGS, ...(settings ?? {}) },
    };
  } catch {
    // A malformed or unavailable store is not worth failing the app over.
    return null;
  }
}

/**
 * localStorage is an external system, not React state, so the provider
 * subscribes to it rather than seeding state inside an effect. That keeps the
 * server render and the first client render identical — `getServerSnapshot`
 * returns the same defaults the server used — while avoiding the cascading
 * re-render that a synchronous `setState` in an effect body causes.
 *
 * Phase 5 of the roadmap replaces this module with effect-rx atoms.
 */
let snapshot: PersistedState = INITIAL;
let hydratedSnapshot = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  for (const listener of listeners) listener();
}

const getSnapshot = (): PersistedState => snapshot;
const getServerSnapshot = (): PersistedState => INITIAL;
const getHydrated = (): boolean => hydratedSnapshot;
const getServerHydrated = (): boolean => false;

/** Applies a change and persists it. The only way state ever moves. */
function update(change: (previous: PersistedState) => PersistedState): void {
  snapshot = change(snapshot);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Private-mode quota errors are non-fatal; the session just won't persist.
  }
  emit();
}

/** Seeds from the store once, after mount. Does not write back. */
function hydrate(): void {
  if (hydratedSnapshot) return;
  hydratedSnapshot = true;
  snapshot = readStored() ?? snapshot;
  emit();
}

function setRole(role: Role): void {
  update((previous) => ({ ...previous, role }));
}

function markPaid(invoiceId: number): void {
  update((previous) => ({
    ...previous,
    invoiceOverrides: { ...previous.invoiceOverrides, [invoiceId]: "Paid" },
  }));
}

function add<K extends keyof CreatedRecords>(
  kind: K,
  record: CreatedRecords[K][number],
): void {
  update((previous) => ({
    ...previous,
    records: {
      ...previous.records,
      [kind]: [record, ...previous.records[kind]] as CreatedRecords[K],
    },
  }));
}

function saveSettings(settings: FirmSettings): void {
  update((previous) => ({ ...previous, settings }));
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const hydrated = useSyncExternalStore(
    subscribe,
    getHydrated,
    getServerHydrated,
  );

  useEffect(hydrate, []);

  const value = useMemo<AppState>(() => {
    const { invoiceOverrides } = state;
    return {
      ...state,
      setRole,
      markPaid,
      add,
      saveSettings,
      statusOf: (invoice) => invoiceOverrides[invoice.id] ?? invoice.status,
      hydrated,
    };
    // The mutators are module-level and stable, so they are not dependencies.
  }, [state, hydrated]);

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState(): AppState {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error("useAppState must be used inside <AppStateProvider>");
  }
  return context;
}
