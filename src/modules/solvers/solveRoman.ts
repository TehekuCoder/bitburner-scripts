import { NS } from "@ns";

export async function solveRoman(ns: NS, host: string, details: any): Promise<string | null> {
  const vals: Record<string, number> = {
    I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000,
  };
  let total = 0;
  const roman = (details.data || "").toUpperCase();

  for (let i = 0; i < roman.length; i++) {
    const cur = vals[roman[i]] || 0;
    const next = vals[roman[i + 1]] || 0;
    if (next > cur) {
      total += next - cur;
      i++;
    } else total += cur;
  }

  const guess = total.toString();
  const result = await ns.dnet.authenticate(host, guess);
  
  if (result && result.success) {
    return guess;
  }
  return null;
}