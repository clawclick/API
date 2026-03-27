import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { runtimeEnv } from "#config/env";
import {
  GLOBAL_SIGNAL_STREAMS,
  closeSignalBus,
  getActiveChartHealthTokens,
  isSignalRedisConfigured,
  publishSignalEvent,
  type GlobalSignalStream,
  type SignalEvent,
} from "#services/signalBus";

const SERVICES_DIR = path.dirname(fileURLToPath(import.meta.url));
const SIGNAL_SOL_DIR = path.resolve(SERVICES_DIR, "../../SIGNAL_SOL");
const SIGNAL_EVENT_PREFIX = "__SIGNAL_SOL_EVENT__";
const DEFAULT_SIGNAL_SOL_BASE_URL = `http://127.0.0.1:${runtimeEnv.port}`;
const GLOBAL_RESTART_DELAY_MS = 3_000;
const CHART_HEALTH_RESTART_DELAY_MS = 5_000;
const CHART_HEALTH_RECONCILE_INTERVAL_MS = 15_000;

type ManagedChild = {
  key: string;
  stream: GlobalSignalStream | "chartHealth";
  tokenAddress?: string;
  script: string;
  child: ChildProcess;
  restartTimer: NodeJS.Timeout | null;
  stopping: boolean;
};

const GLOBAL_SCRIPT_CONFIG: Record<GlobalSignalStream, string> = {
  bottomsUp: "bottomsUp.js",
  momentumGains: "momentumGains.js",
  momentumStart: "momentumStart.js",
  newPump: "newPump.js",
};

const WORKER_AUTOSTART_STREAMS = [
  "bottomsUp",
  "momentumGains",
  "momentumStart",
  "newPump",
] as const;

const globalChildren = new Map<GlobalSignalStream, ManagedChild>();
const chartHealthChildren = new Map<string, ManagedChild>();
const chartHealthRestartTimers = new Map<string, NodeJS.Timeout>();
let chartHealthReconcileTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;

function buildSignalSolEnv(): NodeJS.ProcessEnv {
  const configuredBaseUrl = process.env.SIGNAL_SOL_API_BASE_URL?.trim();
  const configuredApiKey = process.env.SIGNAL_SOL_API_KEY?.trim();

  return {
    ...process.env,
    SIGNAL_SOL_API_BASE_URL: configuredBaseUrl || DEFAULT_SIGNAL_SOL_BASE_URL,
    SIGNAL_SOL_API_KEY: configuredApiKey || "",
    FORCE_COLOR: "0",
  };
}

function logWorkerMessage(prefix: string, line: string, isError = false): void {
  if (!line.trim()) {
    return;
  }

  const message = `[signal-worker:${prefix}] ${line}`;
  if (isError) {
    console.error(message);
  } else {
    console.log(message);
  }
}

async function publishStatus(
  stream: GlobalSignalStream | "chartHealth",
  input: {
    status: "idle" | "warming_up" | "starting" | "running" | "stopped" | "error";
    running: boolean;
    tokenAddress?: string;
    pid?: number | null;
    script?: string;
    message?: string;
  },
): Promise<void> {
  await publishSignalEvent({
    stream,
    scope: stream === "chartHealth" ? "token" : "global",
    ...(input.tokenAddress ? { tokenAddress: input.tokenAddress } : {}),
    type: input.status === "error" ? "error" : "status",
    emittedAt: new Date().toISOString(),
    source: "signal-worker",
    data: {
      status: input.status,
      running: input.running,
      ...(typeof input.pid !== "undefined" ? { pid: input.pid } : {}),
      ...(input.script ? { script: input.script } : {}),
      ...(input.message ? { message: input.message } : {}),
    },
  });
}

function normalizeEventFromScript(line: string): SignalEvent | null {
  if (!line.startsWith(SIGNAL_EVENT_PREFIX)) {
    return null;
  }

  try {
    return JSON.parse(line.slice(SIGNAL_EVENT_PREFIX.length)) as SignalEvent;
  } catch (error) {
    console.error("[signal-worker] Failed to parse script event:", error);
    return null;
  }
}

function attachOutputHandlers(childInfo: ManagedChild): void {
  if (!childInfo.child.stdout || !childInfo.child.stderr) {
    throw new Error(`Missing stdio pipes for managed child ${childInfo.key}.`);
  }

  const stdout = createInterface({ input: childInfo.child.stdout });
  const stderr = createInterface({ input: childInfo.child.stderr });

  stdout.on("line", (line) => {
    const event = normalizeEventFromScript(line);
    if (event) {
      void publishSignalEvent(event).catch((error) => {
        console.error("[signal-worker] Failed to publish script event:", error);
      });
      return;
    }

    logWorkerMessage(childInfo.key, line);
  });

  stderr.on("line", (line) => {
    logWorkerMessage(childInfo.key, line, true);
  });
}

function spawnManagedChild(input: {
  key: string;
  stream: GlobalSignalStream | "chartHealth";
  script: string;
  args?: string[];
  tokenAddress?: string;
}): ManagedChild {
  const child = spawn(
    process.execPath,
    [path.join(SIGNAL_SOL_DIR, input.script), ...(input.args ?? [])],
    {
      cwd: SIGNAL_SOL_DIR,
      env: buildSignalSolEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const childInfo: ManagedChild = {
    ...input,
    child,
    restartTimer: null,
    stopping: false,
  };

  attachOutputHandlers(childInfo);
  return childInfo;
}

function scheduleGlobalRestart(stream: GlobalSignalStream): void {
  const existing = globalChildren.get(stream);
  if (!existing || existing.restartTimer || shuttingDown) {
    return;
  }

  existing.restartTimer = setTimeout(() => {
    existing.restartTimer = null;
    void startGlobalChild(stream);
  }, GLOBAL_RESTART_DELAY_MS);
  existing.restartTimer.unref?.();
}

async function startGlobalChild(stream: GlobalSignalStream): Promise<void> {
  const existing = globalChildren.get(stream);
  if (existing && existing.child.exitCode === null && !existing.child.killed) {
    return;
  }

  const script = GLOBAL_SCRIPT_CONFIG[stream];
  await publishStatus(stream, {
    status: "starting",
    running: false,
    script,
  });

  const childInfo = spawnManagedChild({
    key: stream,
    stream,
    script,
  });
  globalChildren.set(stream, childInfo);

  await publishStatus(stream, {
    status: "running",
    running: true,
    pid: childInfo.child.pid,
    script,
  });

  childInfo.child.on("exit", (code, signal) => {
    const wasStopping = childInfo.stopping || shuttingDown;
    void publishStatus(stream, {
      status: wasStopping ? "stopped" : "error",
      running: false,
      pid: childInfo.child.pid,
      script,
      message: wasStopping
        ? "Process stopped."
        : `Process exited with code=${code ?? "null"} signal=${signal ?? "null"}.`,
    });
    if (!wasStopping) {
      scheduleGlobalRestart(stream);
    }
  });

  childInfo.child.on("error", (error) => {
    void publishStatus(stream, {
      status: "error",
      running: false,
      pid: childInfo.child.pid,
      script,
      message: error.message,
    });
    scheduleGlobalRestart(stream);
  });
}

function scheduleChartHealthRestart(tokenAddress: string): void {
  if (chartHealthRestartTimers.has(tokenAddress) || shuttingDown) {
    return;
  }

  const timer = setTimeout(async () => {
    chartHealthRestartTimers.delete(tokenAddress);
    const activeTokens = await getActiveChartHealthTokens();
    if (activeTokens.includes(tokenAddress)) {
      await startChartHealthChild(tokenAddress);
    }
  }, CHART_HEALTH_RESTART_DELAY_MS);
  timer.unref?.();
  chartHealthRestartTimers.set(tokenAddress, timer);
}

async function startChartHealthChild(tokenAddress: string): Promise<void> {
  const restartTimer = chartHealthRestartTimers.get(tokenAddress);
  if (restartTimer) {
    clearTimeout(restartTimer);
    chartHealthRestartTimers.delete(tokenAddress);
  }

  const existing = chartHealthChildren.get(tokenAddress);
  if (existing && existing.child.exitCode === null && !existing.child.killed) {
    return;
  }

  await publishStatus("chartHealth", {
    status: "starting",
    running: false,
    tokenAddress,
    script: "chartHealth.js",
  });

  const childInfo = spawnManagedChild({
    key: `chartHealth:${tokenAddress}`,
    stream: "chartHealth",
    script: "chartHealth.js",
    args: [tokenAddress],
    tokenAddress,
  });
  chartHealthChildren.set(tokenAddress, childInfo);

  await publishStatus("chartHealth", {
    status: "running",
    running: true,
    tokenAddress,
    pid: childInfo.child.pid,
    script: "chartHealth.js",
  });

  childInfo.child.on("exit", (code, signal) => {
    const wasStopping = childInfo.stopping || shuttingDown;
    void publishStatus("chartHealth", {
      status: wasStopping ? "stopped" : "error",
      running: false,
      tokenAddress,
      pid: childInfo.child.pid,
      script: "chartHealth.js",
      message: wasStopping
        ? "Process stopped."
        : `Process exited with code=${code ?? "null"} signal=${signal ?? "null"}.`,
    });
    chartHealthChildren.delete(tokenAddress);
    if (!wasStopping) {
      scheduleChartHealthRestart(tokenAddress);
    }
  });

  childInfo.child.on("error", (error) => {
    void publishStatus("chartHealth", {
      status: "error",
      running: false,
      tokenAddress,
      pid: childInfo.child.pid,
      script: "chartHealth.js",
      message: error.message,
    });
    scheduleChartHealthRestart(tokenAddress);
  });
}

async function reconcileChartHealthChildren(): Promise<void> {
  const activeTokens = new Set(await getActiveChartHealthTokens());

  for (const tokenAddress of activeTokens) {
    if (!chartHealthChildren.has(tokenAddress)) {
      await startChartHealthChild(tokenAddress);
    }
  }

  for (const [tokenAddress, childInfo] of chartHealthChildren) {
    if (activeTokens.has(tokenAddress)) {
      continue;
    }

    childInfo.stopping = true;
    childInfo.child.kill("SIGTERM");
    chartHealthChildren.delete(tokenAddress);
  }
}

export async function startSignalWorker(): Promise<void> {
  if (!isSignalRedisConfigured()) {
    throw new Error("REDIS_URL is required before starting the signal worker.");
  }

  console.log("[signal-worker] Starting global SIGNAL_SOL workers...");
  for (const stream of WORKER_AUTOSTART_STREAMS) {
    await startGlobalChild(stream);
  }

  await reconcileChartHealthChildren();
  chartHealthReconcileTimer = setInterval(() => {
    void reconcileChartHealthChildren().catch((error) => {
      console.error("[signal-worker] Chart health reconcile failed:", error);
    });
  }, CHART_HEALTH_RECONCILE_INTERVAL_MS);
  chartHealthReconcileTimer.unref?.();
}

export async function stopSignalWorker(): Promise<void> {
  shuttingDown = true;

  if (chartHealthReconcileTimer) {
    clearInterval(chartHealthReconcileTimer);
    chartHealthReconcileTimer = null;
  }

  for (const childInfo of globalChildren.values()) {
    childInfo.stopping = true;
    childInfo.child.kill("SIGTERM");
    if (childInfo.restartTimer) {
      clearTimeout(childInfo.restartTimer);
    }
  }
  globalChildren.clear();

  for (const childInfo of chartHealthChildren.values()) {
    childInfo.stopping = true;
    childInfo.child.kill("SIGTERM");
    if (childInfo.restartTimer) {
      clearTimeout(childInfo.restartTimer);
    }
  }
  chartHealthChildren.clear();

  for (const timer of chartHealthRestartTimers.values()) {
    clearTimeout(timer);
  }
  chartHealthRestartTimers.clear();

  await closeSignalBus();
}
