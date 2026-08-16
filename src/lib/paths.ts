// src/lib/paths.ts

export const PATHS = {
  core: {
    boot: "core/boot.js",
    logger: "core/sys-logger.js",
    dispatcher: "core/sys-dispatcher.js",
    kernel: "core/sys-kernel.js",
    orchestrator: "core/sys-orchestrator.js",
    apocalypse: "core/sys-apocalypse.js",
    financeCore: "core/finance-core.js",
    redpill: "core/sys-redpill.js",
    actions: {
      cloud: "core/actions/act-cloud.js",
      gang: "core/actions/act-gang.js",
      hacknet: "core/actions/act-hacknet.js",
      singularity: "core/actions/act-singularity.js",
      sleeve: "core/actions/act-sleeve.js",
      stock: "core/actions/act-stock.js",
    },
    engines: {
      prep: "core/engines/engine-prep.js",
      proto: "core/engines/engine-proto.js",
      shotgun: "core/engines/engine-shotgun.js",
      xpGrind: "core/engines/engine-xp-grind.js",
      jitBatcher: "core/engines/sys-jit-batcher.js",
    },
  },

  daemons: {
    backdoor: "daemons/backdoor.js",
    crawler: "daemons/dnet-crawler.js",
    fillShare: "daemons/fill-share.js",
    financeDispatcher: "daemons/finance-dispatcher.js",
    hackingOrchestrator: "daemons/hacking-orchestrator.js",
    perfMonitor: "daemons/perf-monitor.js",
  },

  payloads: {
    grow: "payloads/grow.js",
    hack: "payloads/hack.js",
    share: "payloads/share.js",
    weaken: "payloads/weaken.js",
    work: "payloads/work.js",
  },

  tasks: {
    analyzeAug: "tasks/analyze-augmentations.js",
    cctSolver: "tasks/cct-solver.js",
    company: "tasks/company.js",
    crime: "tasks/crime.js",
    loot: "tasks/dnet-loot.js",
    phish: "tasks/dnet-phish.js",
    dnetSolver: "tasks/dnet-solver.js",
    faction: "tasks/faction-grind.js",
    train: "tasks/train.js",
    uni: "tasks/uni.js",
  },

  managers: {
    dnet: "managers/dnet-master.js",
    gang: "managers/gang-manager.js",
    hash: "managers/hash-manager.js",
    sleeve: "managers/sleeve-manager.js",
  },

  ui: {
    roadmap: "ui/roadmap.js",
    gang: "ui/gang.js",
    sleeve: "ui/sleeve.js",
  },

  evaluators: {
    purchase: {
      cloud: "lib/evaluators/purchase/cloud.js",
      gang: "lib/evaluators/purchase/gang.js",
      hacknet: "lib/evaluators/purchase/hacknet.js",
      home: "lib/evaluators/purchase/home.js",
      player: "lib/evaluators/purchase/player.js",
      programs: "lib/evaluators/purchase/programs.js",
      sleeve: "lib/evaluators/purchase/sleeve.js",
      stock: "lib/evaluators/purchase/stock.js",
    },
    strategy: {
      hacking: "lib/evaluators/strategy/hacking-strategy.js",
      system: "lib/evaluators/strategy/system-strategy.js",
      target: "lib/evaluators/strategy/target-selection.js",
    },
  },
} as const;