import { NS, ProgramName, FactionName } from "@ns";

export async function main(ns: NS): Promise<void> {
  if (ns.args.length === 0) return;

  const action = String(ns.args[0]);
  let success = false;

  try {
    switch (action) {
      case "gang-buy-equipment": {
        const memberName = String(ns.args[1] ?? "");
        const equipName = String(ns.args[2] ?? "");
        success = !!ns.gang && ns.gang.purchaseEquipment(memberName, equipName);
        break;
      }
      case "home-upgrade-ram": {
        success = !!ns.singularity && ns.singularity.upgradeHomeRam();
        break;
      }
      case "home-upgrade-cores": {
        success = !!ns.singularity && ns.singularity.upgradeHomeCores();
        break;
      }
      case "hacknet-new-node": {
        success = ns.hacknet.purchaseNode() !== -1;
        break;
      }
      case "hacknet-upgrade-level": {
        const index = parseInt(String(ns.args[1] ?? "-1"), 10);
        const amount = parseInt(String(ns.args[2] ?? "1"), 10);
        success = index >= 0 && ns.hacknet.upgradeLevel(index, amount);
        break;
      }
      case "hacknet-upgrade-ram": {
        const index = parseInt(String(ns.args[1] ?? "-1"), 10);
        const amount = parseInt(String(ns.args[2] ?? "1"), 10);
        success = index >= 0 && ns.hacknet.upgradeRam(index, amount);
        break;
      }
      case "hacknet-upgrade-core": {
        const index = parseInt(String(ns.args[1] ?? "-1"), 10);
        const amount = parseInt(String(ns.args[2] ?? "1"), 10);
        success = index >= 0 && ns.hacknet.upgradeCore(index, amount);
        break;
      }
      case "pserv-buy": {
        const hostname = String(ns.args[1] ?? "");
        const ram = parseInt(String(ns.args[2] ?? "0"), 10);
        success = hostname !== "" && ram > 0 && ns.cloud.purchaseServer(hostname, ram) !== "";
        break;
      }
      case "pserv-upgrade": {
        const hostname = String(ns.args[1] ?? "");
        const ram = parseInt(String(ns.args[2] ?? "0"), 10);
        success = hostname !== "" && ram > 0 && ns.cloud.upgradeServer(hostname, ram);
        break;
      }
      case "program-purchase-tor": {
        success = !!ns.singularity && ns.singularity.purchaseTor();
        break;
      }
      case "program-purchase": {
        const programRaw = String(ns.args[1] ?? "");
        if (programRaw === "") break;
        const program = programRaw as ProgramName;
        success = !!ns.singularity && ns.singularity.purchaseProgram(program);
        break;
      }
      case "stock-purchase-license": {
        const license = String(ns.args[1] ?? "");
        if (!ns.stock) break;
        switch (license) {
          case "wse":
            success = ns.stock.purchaseWseAccount();
            break;
          case "tix":
            success = ns.stock.purchaseTixApi();
            break;
          case "4s":
            success = ns.stock.purchase4SMarketData();
            break;
          case "4s-tix":
            success = ns.stock.purchase4SMarketDataTixApi();
            break;
          default:
            success = false;
        }
        break;
      }
      case "stock-buy": {
        if (!ns.stock) break;
        const symbol = String(ns.args[1] ?? "");
        const type = String(ns.args[2] ?? "LONG");
        const sharePrice = type === "LONG" ? ns.stock.getAskPrice(symbol) : ns.stock.getBidPrice(symbol);
        const currentMoney = ns.getServerMoneyAvailable("home");
        let sharesToBuy = Math.floor((currentMoney - 100000) / sharePrice);
        sharesToBuy = Math.max(0, sharesToBuy);
        if (sharesToBuy <= 0) break;
        success = type === "LONG"
          ? ns.stock.buyStock(symbol, sharesToBuy) > 0
          : !!(type === "SHORT" && (() => { try { return ns.stock.buyShort(symbol, sharesToBuy) > 0; } catch { return false; } })());
        break;
      }
      case "sleeve-purchase-aug": {
        const sleeveId = parseInt(String(ns.args[1] ?? "-1"), 10);
        const augName = String(ns.args[2] ?? "");
        success = ns.sleeve !== undefined && sleeveId >= 0 && augName !== "" && ns.sleeve.purchaseSleeveAug(sleeveId, augName);
        break;
      }
      case "player-purchase-aug": {
        const factionRaw = String(ns.args[1] ?? "");
        const augName = String(ns.args[2] ?? "");
        if (factionRaw === "" || augName === "" || !ns.singularity) break;
        const faction = factionRaw as FactionName;
        success = ns.singularity.purchaseAugmentation(faction, augName);
        break;
      }
      case "player-purchase-aug-batch": {
        if (!ns.singularity) break;
        try {
          const batch = JSON.parse(String(ns.args[1] ?? "[]")) as { faction: FactionName; name: string }[];
          for (const item of batch) {
            if (item.faction && item.name) {
              success = ns.singularity.purchaseAugmentation(item.faction, item.name) || success;
            }
          }
        } catch {
          success = false;
        }
        break;
      }
      case "player-purchase-nfg": {
        const factionRaw = String(ns.args[1] ?? "");
        if (!ns.singularity || factionRaw === "") break;
        const faction = factionRaw as FactionName;
        let boughtAny = false;
        while (ns.singularity.purchaseAugmentation(faction, "NeuroFlux Governor")) {
          boughtAny = true;
        }
        success = boughtAny;
        break;
      }
      default: {
        ns.print(`[PURCHASE-ACTION] Unbekannte Aktion: ${action}`);
        break;
      }
    }
  } catch (err) {
    ns.print(`[PURCHASE-ACTION] Fehler bei Aktion ${action}: ${String(err)}`);
    success = false;
  }

  if (!success) {
    ns.print(`[PURCHASE-ACTION] Aktion fehlgeschlagen: ${action} ${ns.args.slice(1).map(String).join(" ")}`);
  }
}
