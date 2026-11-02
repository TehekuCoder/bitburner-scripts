import type { NS } from "@ns";
import { shouldInfluenceStockPosition } from "/domain/evaluators/purchase/stock-runtime.js";

export interface StockInfluenceTarget {
  symbol: string;
  hostname: string;
  type: "LONG" | "SHORT";
  forecast: number;
  score: number;
}

export function getStockInfluenceTargets(
  ns: NS,
  servers: readonly string[],
  alreadyInfluencing = false,
): StockInfluenceTarget[] {
  if (
    ns.getResetInfo().currentNode !== 8 ||
    !ns.stock ||
    !ns.stock.has4SDataTixApi()
  ) {
    return [];
  }

  const rootedServers = servers
    .filter((hostname) => hostname !== "home" && ns.hasRootAccess(hostname))
    .map((hostname) => ({
      hostname,
      organization: ns.getServer(hostname).organizationName,
      maxMoney: ns.getServerMaxMoney(hostname),
      requiredHackingSkill: ns.getServerRequiredHackingLevel(hostname),
    }))
    .filter(
      (server) =>
        server.maxMoney > 0 &&
        server.requiredHackingSkill <= ns.getHackingLevel(),
    );

  const targets: StockInfluenceTarget[] = [];
  for (const symbol of ns.stock.getSymbols()) {
    const organization = ns.stock.getOrganization(symbol);
    const server = rootedServers.find(
      (candidate) => candidate.organization === organization,
    );
    if (!server) continue;

    const forecast = ns.stock.getForecast(symbol);
    const [longShares, , shortShares] = ns.stock.getPosition(symbol);
    const longPositionValue = longShares * ns.stock.getBidPrice(symbol);
    const shortPositionValue = shortShares * ns.stock.getAskPrice(symbol);
    const directions: {
      type: "LONG" | "SHORT";
      shares: number;
      positionValue: number;
    }[] = [
      {
        type: "LONG",
        shares: longShares,
        positionValue: longPositionValue,
      },
      {
        type: "SHORT",
        shares: shortShares,
        positionValue: shortPositionValue,
      },
    ];

    for (const direction of directions) {
      if (
        direction.shares <= 0 ||
        !Number.isFinite(direction.positionValue) ||
        direction.positionValue <= 0 ||
        !shouldInfluenceStockPosition(
          direction.type,
          forecast,
          alreadyInfluencing,
        )
      ) {
        continue;
      }

      const positionStrength = Math.abs(forecast - 0.5);
      targets.push({
        symbol,
        hostname: server.hostname,
        type: direction.type,
        forecast,
        score: direction.positionValue * positionStrength,
      });
    }
  }

  const bestByHostname = new Map<string, StockInfluenceTarget>();
  for (const target of targets) {
    const previous = bestByHostname.get(target.hostname);
    if (!previous || target.score > previous.score) {
      bestByHostname.set(target.hostname, target);
    }
  }
  return [...bestByHostname.values()].sort((a, b) => b.score - a.score);
}
