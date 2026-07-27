import { NS } from "@ns";
import { PAYLOADS } from "/lib/constants";

/**
 * Kopiert alle benötigten Worker-Skripte auf den Zielserver, falls sie fehlen.
 * @param ns NS API Objekt
 * @param serverName Der Zielserver (z.B. "p-serv-01" oder "n00dles")
 */
export async function provisionServer(
  ns: NS,
  serverName: string,
): Promise<void> {
  // Home braucht keine Kopien seiner eigenen Dateien
  if (serverName === "home") return;

  const currentHost = ns.getHostname();
  const sourceCandidates = [currentHost, "home"].filter(
    (host, index, hosts) => hosts.indexOf(host) === index,
  );

  const missingFiles = PAYLOADS.filter(
    (file) => !ns.fileExists(file, serverName),
  );

  if (missingFiles.length === 0) return;

  for (const file of missingFiles) {
    const sourceHost = sourceCandidates.find(
      (host) => host !== serverName && ns.fileExists(file, host),
    );

    if (sourceHost) {
      ns.scp(file, serverName, sourceHost);
    }
  }
}
