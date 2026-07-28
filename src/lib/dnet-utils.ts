import { NS } from "@ns";

/**
 * Verbindet sich falls nötig mit dem Zielserver und versucht die Authentifizierung.
 */
export async function tryAuth(ns: NS, host: string, pw: string): Promise<boolean> {
  try {
    const details = ns.dnet.getServerDetails(host) as any;

    // Falls nicht verbunden: Zuerst Verbindung aufbauen
    if (details && !details.isConnectedToCurrentServer) {
      if (typeof (ns.dnet as any).connect === "function") {
        await (ns.dnet as any).connect(host);
      } else if (ns.singularity && typeof ns.singularity.connect === "function") {
        ns.singularity.connect(host);
      }
    }

    // Authentifizierung durchführen
    const res = (await ns.dnet.authenticate(host, pw)) as any;
    return Boolean(res?.success);
  } catch {
    return false;
  }
}