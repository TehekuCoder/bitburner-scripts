import { NS } from "@ns";
import { ProvisionProfile } from "shared/types/game.js";
import { PAYLOADS } from "/shared/constants/payloads.js";

export async function ensureScriptsOnServer(
  ns: NS,
  serverName: string,
  scripts: readonly string[],
): Promise<boolean> {
  const missingFiles = scripts.filter(
    (file) => !ns.fileExists(file, serverName),
  );
  if (missingFiles.length === 0) return true;

  if (serverName === "home") {
    ns.print(`[PROVISION] Fehlende Worker-Dateien auf home: ${missingFiles.join(", ")}`);
    return false;
  }

  const missingAtHome = missingFiles.filter((file) => !ns.fileExists(file, "home"));
  if (missingAtHome.length > 0) {
    ns.print(`[PROVISION] Quelldateien fehlen auf home: ${missingAtHome.join(", ")}`);
    return false;
  }

  const copied = await ns.scp(missingFiles, serverName, "home");
  const stillMissing = missingFiles.filter(
    (file) => !ns.fileExists(file, serverName),
  );
  if (!copied || stillMissing.length > 0) {
    ns.print(
      `[PROVISION] Worker-Dateien konnten nicht auf ${serverName} bereitgestellt werden: ${stillMissing.join(", ") || missingFiles.join(", ")}`,
    );
    return false;
  }
  return true;
}

export async function provisionServer(
  ns: NS,
  serverName: string,
  profile: ProvisionProfile = "hgw",
): Promise<void> {
  if (serverName === "home") return;

  const filesToCopy = PAYLOADS[profile];
  const currentHost = ns.getHostname();
  const sourceCandidates = [currentHost, "home"];

  const missingFiles = filesToCopy.filter(
    (file) => !ns.fileExists(file, serverName),
  );

  if (missingFiles.length === 0) return;

  for (const file of missingFiles) {
    const sourceHost = sourceCandidates.find(
      (host) => host !== serverName && ns.fileExists(file, host),
    );

    if (sourceHost) {
      const copied = await ns.scp(file, serverName, sourceHost);
      if (!copied || !ns.fileExists(file, serverName)) {
        ns.print(`[PROVISION] Datei konnte nicht bereitgestellt werden: ${file} auf ${serverName}`);
      }
    } else {
      ns.print(`[PROVISION] Datei fehlt: ${file} auf ${currentHost} & home`);
    }
  }
}