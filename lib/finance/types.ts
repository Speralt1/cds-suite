import type { Timestamp } from "firebase/firestore";
export type Role = "admin" | "pastor" | "finance" | "leader";
export interface AccessUser {
  displayName: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: Timestamp;
}
export type TransactionType = "income" | "expense";
export type PaymentMethod = "cash" | "transfer" | "card" | "other";
export interface TransactionInput {
  type: TransactionType;
  amount: number;
  date: string;
  category: string;
  paymentMethod: PaymentMethod;
  description: string;
  note?: string;
}
export interface FinanceTransaction extends Omit<TransactionInput, "date"> {
  id: string;
  date: Timestamp;
  period: string;
  day: string;
  source: "general" | "tithe";
  status: "active" | "voided";
  revision: number;
  createdBy: string;
  createdAt: Timestamp;
  updatedBy: string;
  updatedAt: Timestamp;
  voidedBy?: string;
  voidedAt?: Timestamp;
  voidReason?: string;
}
export interface MonthlySummary {
  id: string;
  incomeTotal: number;
  expenseTotal: number;
  result: number;
  titheTotal: number;
  transactionCount: number;
  incomeByCategory: Record<string, number>;
  expenseByCategory: Record<string, number>;
  dailyIncome: Record<string, number>;
  dailyExpense: Record<string, number>;
  updatedAt?: Timestamp;
  lastTransactionId?: string;
}
export interface TitheProfile {
  id: string;
  searchName: string;
  type: "person" | "family";
  displayName: string;
  phone: string;
  email: string;
  members: string;
  active: boolean;
  pastoralContactAuthorized: boolean;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  updatedBy: string;
}
export type ProfileInput = Pick<
  TitheProfile,
  | "type"
  | "displayName"
  | "phone"
  | "email"
  | "members"
  | "active"
  | "pastoralContactAuthorized"
>;
export interface TitheAttribution {
  id: string;
  transactionId: string;
  profileId: string;
  amount: number;
  date: Timestamp;
  period: string;
  status: "active" | "voided";
  note: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedBy: string;
  updatedAt: Timestamp;
}
export interface PastoralFollowup {
  id: string;
  profileId: string;
  date: Timestamp;
  note: string;
  status: "pending" | "completed";
  nextFollowUpDate: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedBy: string;
  updatedAt: Timestamp;
}
export interface PeriodSelection {
  year: number;
  month: number;
  view: "month" | "year";
}
