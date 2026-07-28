import { NS } from "@ns";
import { LoggerClient } from "lib/logger-client.js";
import { withDnetLock } from "lib/dnet-lock.js";

export async function solveCloudBlare(
  ns: NS,
  host: string,
  details: any,
  logger?: LoggerClient
): Promise<string | null> {
  const log = logger || new LoggerClient(ns, "SOLVER", host);
  const rawData = String(details?.data || "").trim();
  const numericOnly = rawData.replace(/\D/g, "");

  if (numericOnly) {
    // Exklusiver Zugriff für Fast-Path
    const res = await withDnetLock(ns, async () => {
      await ensureConnected(ns, host);
      return (await ns.dnet.authenticate(host, numericOnly)) as any;
    });

    if (res?.success) {
      log.success(`☁️ [CloudBlare] Erfolgreich via Data-Ziffern geknackt: ${numericOnly}`);
      return numericOnly;
    }
  }

  // Heartbleed Fallback ebenfalls geschützt
  for (let i = 0; i < 3; i++) {
    const bleedRes = await withDnetLock(ns, async () => {
      await ensureConnected(ns, host);
      const bleed = (await ns.dnet.heartbleed(host)) as any;
      if (!bleed || (typeof bleed === "object" && bleed.success === false)) return null;

      const bleedStr = typeof bleed === "string" ? bleed : JSON.stringify(bleed);
      const bleedDigits = bleedStr.replace(/\D/g, "");
      if (!bleedDigits) return null;

      const auth = (await ns.dnet.authenticate(host, bleedDigits)) as any;
      return auth?.success ? bleedDigits : null;
    });

    if (bleedRes) {
      log.success(`🎉 [CloudBlare] Erfolgreich via Heartbleed geknackt: ${bleedRes}`);
      return bleedRes;
    }

    await ns.asleep(50);
  }

  return null;
}

async function ensureConnected(ns: NS, host: string): Promise<void> {
  try {
    const d = (ns.dnet as any)?.getServerDetails?.(host);
    if (d && !d.isConnectedToCurrentServer) {
      if (typeof (ns.dnet as any).connect === "function") {
        await (ns.dnet as any).connect(host);
      }
    }
  } catch {}
}