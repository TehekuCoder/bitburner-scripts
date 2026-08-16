import { NS } from "@ns";

export type PurchaseCategory =
  | "HOME_SERVER"
  | "PURCHASED_SERVER"
  | "DARKNET_PROGRAM"
  | "PLAYER_AUG"
  | "SLEEVE_AUG"
  | "GANG_EQUIPMENT"
  | "HACKNET"
  | "COMPANY"
  | "STOCK_LICENSE"
  | "STOCK_TRADE";

export enum PurchasePriority {
  CRITICAL = 1,
  HIGH = 2,
  MEDIUM = 3,
  LOW = 4,
  IDLE = 5,
}

export interface PurchaseRequest {
  id: string;
  category: PurchaseCategory;
  priority: PurchasePriority;
  cost: number;
  description: string;
  score?: number;
  action: {
    script: string;
    args: (string | number)[];
  };
}

export interface PurchaseEvaluator {
  category: PurchaseCategory;
  getRequests(ns: NS): PurchaseRequest[];
}