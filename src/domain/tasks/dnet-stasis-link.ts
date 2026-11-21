import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const action = String(ns.args[0] ?? "");
  if (action !== "link" && action !== "unlink") {
    throw new Error(`Ungültige Stasis-Aktion: ${action}`);
  }

  const linkedHosts = ns.dnet.getStasisLinkedServers();
  const currentHost = ns.getHostname();
  if (action === "link" && linkedHosts.includes(currentHost)) return;
  if (action === "unlink" && !linkedHosts.includes(currentHost)) return;

  const result = await ns.dnet.setStasisLink(action === "link");
  if (!result.success) {
    ns.print(`Stasis-Link ${action} auf ${currentHost} fehlgeschlagen: ${result.message}`);
  }
}
