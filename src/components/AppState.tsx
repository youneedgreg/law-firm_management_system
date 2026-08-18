"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ROLES, type Invoice, type InvoiceStatus, type Role } from "@/lib/types";

const STORAGE_KEY = "oklaw.appstate.v1";

interface PersistedState {
  role: Role;
  /** Invoice id → status, layered over the seed data when a payment lands. */
  invoiceOverrides: Record<number, InvoiceStatus>;
}

const INITIAL: PersistedState = {
  role: "Managing Partner",
  invoiceOverrides: {},
};

interface AppState extends PersistedState {
  setRole: (role: Role) => void;
  /** Effective status of an invoice, override applied. */
  statusOf: (invoice: Invoice) => InvoiceStatus;
  markPaid: (invoiceId: number) => void;
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

function readStored(): PersistedState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { role, invoiceOverrides } = parsed as Partial<PersistedState>;
    return {
      role: isRole(role) ? role : INITIAL.role,
      invoiceOverrides:
        typeof invoiceOverrides === "object" && invoiceOverrides !== null
          ? invoiceOverrides
          : {},
    };
  } catch {
    // A malformed or unavailable store is not worth failing the app over.
    return null;
  }
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PersistedState>(INITIAL);
  const [hydrated, setHydrated] = useState(false);

  // Read after mount rather than during render: the server has no localStorage,
  // and seeding state from it inline would desync the hydration pass.
  useEffect(() => {
    const stored = readStored();
    if (stored) setState(stored);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Private-mode quota errors are non-fatal; the session just won't persist.
    }
  }, [state, hydrated]);

  const setRole = useCallback((role: Role) => {
    setState((previous) => ({ ...previous, role }));
  }, []);

  const markPaid = useCallback((invoiceId: number) => {
    setState((previous) => ({
      ...previous,
      invoiceOverrides: { ...previous.invoiceOverrides, [invoiceId]: "Paid" },
    }));
  }, []);

  const value = useMemo<AppState>(() => {
    const { invoiceOverrides } = state;
    return {
      ...state,
      setRole,
      markPaid,
      statusOf: (invoice) => invoiceOverrides[invoice.id] ?? invoice.status,
      hydrated,
    };
  }, [state, setRole, markPaid, hydrated]);

  return (
    <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
  );
}

export function useAppState(): AppState {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error("useAppState must be used inside <AppStateProvider>");
  }
  return context;
}
