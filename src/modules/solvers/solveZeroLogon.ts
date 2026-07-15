import { NS } from "@ns";

export async function solveZeroLogon(ns: NS, host: string, details: any): Promise<string | null> {
  const result = await ns.dnet.authenticate(host, "");
  if (result && result.success) {
    return "";
  }
  return null;
}