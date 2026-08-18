import type { Invoice, TrustAccount } from "../types";

type InvoiceSeed = Omit<Invoice, "lineItems">;

const SEED: InvoiceSeed[] = [
  {
    id: 1,
    number: "INV-3001",
    client: "Wanjiku Mwangi",
    case: "OKL-2026-014",
    amount: 120000,
    method: "M-Pesa",
    status: "Paid",
  },
  {
    id: 2,
    number: "INV-3002",
    client: "General Innovations Ltd",
    case: "OKL-2026-005",
    amount: 480000,
    method: "Bank Transfer",
    status: "Partially Paid",
  },
  {
    id: 3,
    number: "INV-3003",
    client: "David Odhiambo",
    case: "OKL-2026-021",
    amount: 95000,
    method: "Cash",
    status: "Overdue",
  },
  {
    id: 4,
    number: "INV-3004",
    client: "Rift Valley Logistics Ltd",
    case: "OKL-2026-011",
    amount: 265000,
    method: "Bank Transfer",
    status: "Paid",
  },
  {
    id: 5,
    number: "INV-3005",
    client: "Coastal Agro Exports Ltd",
    case: "OKL-2026-040",
    amount: 340000,
    method: "Cheque",
    status: "Partially Paid",
  },
  {
    id: 6,
    number: "INV-3006",
    client: "General Innovations Ltd",
    case: "OKL-2026-032",
    amount: 150000,
    method: "Card",
    status: "Overdue",
  },
];

/** Every invoice splits 80% professional fees / 20% filing & disbursements. */
export const INVOICES: Invoice[] = SEED.map((seed) => ({
  ...seed,
  lineItems: [
    {
      desc: "Professional fees",
      qty: 1,
      rate: seed.amount * 0.8,
      amount: seed.amount * 0.8,
    },
    {
      desc: "Filing & disbursements",
      qty: 1,
      rate: seed.amount * 0.2,
      amount: seed.amount * 0.2,
    },
  ],
}));

export function getInvoice(id: number): Invoice | undefined {
  return INVOICES.find((invoice) => invoice.id === id);
}

export function invoicesForClient(clientName: string): Invoice[] {
  return INVOICES.filter((invoice) => invoice.client === clientName);
}

type TrustSeed = Omit<TrustAccount, "balance">;

const TRUST_SEED: TrustSeed[] = [
  { client: "Wanjiku Mwangi", deposits: 50000, withdrawals: 20000 },
  { client: "General Innovations Ltd", deposits: 300000, withdrawals: 180000 },
  { client: "Coastal Agro Exports Ltd", deposits: 150000, withdrawals: 60000 },
];

export const TRUST_ACCOUNTS: TrustAccount[] = TRUST_SEED.map((seed) => ({
  ...seed,
  balance: seed.deposits - seed.withdrawals,
}));

export const TRUST_ON_HAND = TRUST_ACCOUNTS.reduce(
  (total, account) => total + account.balance,
  0,
);

export const FEE_STRUCTURES = [
  "Hourly billing",
  "Fixed fee",
  "Retainer",
  "Contingency fee",
] as const;

/** Monthly revenue for the dashboard chart, in KES. */
export const MONTHLY_REVENUE = [
  { label: "Mar", value: 780000 },
  { label: "Apr", value: 920000 },
  { label: "May", value: 860000 },
  { label: "Jun", value: 1010000 },
  { label: "Jul", value: 1240000 },
  { label: "Aug", value: 1150000 },
];

export const REVENUE_THIS_MONTH = 1150000;
export const COLLECTIONS_THIS_MONTH = 940000;
