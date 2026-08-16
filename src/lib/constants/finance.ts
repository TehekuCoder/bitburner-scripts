import { PurchaseCategory } from "../types/finance";

export const CATEGORY_WEIGHTS: Record<PurchaseCategory, number> = {
  HOME_SERVER: 100,
  PURCHASED_SERVER: 90,
  DARKNET_PROGRAM: 80,
  GANG_EQUIPMENT: 70,
  SLEEVE_AUG: 60,
  PLAYER_AUG: 50,
  HACKNET: 40,
  STOCK_LICENSE: 30,
  COMPANY: 20,
  STOCK_TRADE: 10,
};

export const TRANSACTION_FEE = 100_000;
export const MIN_INVESTMENT = 5_000_000;
export const CASH_BUFFER = 2_000_000;

export const BASE_CATEGORY_MARGINS: Partial<Record<PurchaseCategory, number>> = {
  STOCK_LICENSE: 1.0,
  STOCK_TRADE: 1.5,
};

export const CATEGORY_TO_EVALUATOR: Partial<Record<PurchaseCategory, string>> = {
  HOME_SERVER: "home",
  PURCHASED_SERVER: "cloud",
  DARKNET_PROGRAM: "programs",
  GANG_EQUIPMENT: "gang",
  SLEEVE_AUG: "sleeve",
  PLAYER_AUG: "player",
  HACKNET: "hacknet",
  STOCK_LICENSE: "stock",
  STOCK_TRADE: "stock",
};