import { NS } from "@ns";

export async function solveBaseConversion(ns: NS, host: string, details: any): Promise<string | null> {
  const parts = (details.data || "").split(",");
  if (parts.length !== 2) return null;

  const base = parseInt(parts[0], 10);
  const valueStr = parts[1].trim();
  const decimalValue = parseInt(valueStr, base);

  if (isNaN(decimalValue)) return null;

  const guess = decimalValue.toString();
  const result = await ns.dnet.authenticate(host, guess);
  return (result && result.success) ? guess : null;
}