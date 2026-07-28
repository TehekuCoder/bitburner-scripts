import { NS } from "@ns";

const LOCK_PORT = 10;
const LOCK_TIMEOUT_MS = 3000;

/**
 * Führt eine DNet-Aktion exklusiv aus (verhindert Connection-Stealing durch parallele Solver).
 */
export async function withDnetLock<T>(ns: NS, action: () => Promise<T>): Promise<T> {
  const port = ns.getPortHandle(LOCK_PORT);
  const start = Date.now();

  // Warten, bis der Lock frei ist (Port ist leer)
  while (!port.empty()) {
    if (Date.now() - start > LOCK_TIMEOUT_MS) {
      // Emergency Reset bei verwaistem Lock
      port.clear();
      break;
    }
    await ns.asleep(20);
  }

  // Lock setzen
  port.write("LOCKED");

  try {
    return await action();
  } finally {
    // Lock wieder freigeben
    port.clear();
  }
}