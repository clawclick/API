import { execFile, spawn, type ChildProcess } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runtimeEnv } from "#config/env";

const SERVICES_DIR = path.dirname(fileURLToPath(import.meta.url));
const SIGNAL_SOL_DIR = path.resolve(SERVICES_DIR, "../../SIGNAL_SOL");
const SIGNAL_SOL_LOG_DIR = path.resolve(SERVICES_DIR, "../../.runtime/signal-sol");
const DEFAULT_SIGNAL_SOL_BASE_URL = `http://127.0.0.1:${runtimeEnv.port}`;
const ONE_SHOT_BUFFER_BYTES = 10 * 1024 * 1024;

type SignalSolScriptName =
  | "artificialVolumeScan.js"
  | "bottomsUp.js"
  | "chartHealth.js"
  | "momentumGains.js"
  | "momentumStart.js"
  | "newPump.js";

export type SignalSolRunContext = {
  apiKey?: string | null;
  baseUrl?: string | null;
};

export type SignalSolOneShotResult = {
  mode: "oneshot";
  script: string;
  output: string;
};

export type SignalSolBackgroundResult = {
  mode: "background";
  script: string;
  status: "started" | "already_running";
  pid: number | null;
  logFile: string;
  trackingFile?: string;
};

type ManagedSignalSolProcess = {
  child: ChildProcess;
  logFile: string;
  trackingFile?: string;
};

const backgroundProcesses = new Map<string, ManagedSignalSolProcess>();

function buildSignalSolEnv(context: SignalSolRunContext = {}): NodeJS.ProcessEnv {
  const configuredBaseUrl = process.env.SIGNAL_SOL_API_BASE_URL?.trim();
  const configuredApiKey = process.env.SIGNAL_SOL_API_KEY?.trim();

  return {
    ...process.env,
    SIGNAL_SOL_API_BASE_URL: configuredBaseUrl || context.baseUrl?.trim() || DEFAULT_SIGNAL_SOL_BASE_URL,
    SIGNAL_SOL_API_KEY: configuredApiKey || context.apiKey?.trim() || "",
  };
}

function getScriptPath(script: SignalSolScriptName): string {
  return path.join(SIGNAL_SOL_DIR, script);
}

function ensureSignalSolLogDir(): void {
  mkdirSync(SIGNAL_SOL_LOG_DIR, { recursive: true });
}

function getSafeLogName(key: string): string {
  return key.replace(/[^a-z0-9_.-]+/gi, "_").toLowerCase();
}

function getChartHealthTrackingFile(tokenAddress: string): string {
  return path.join(SIGNAL_SOL_DIR, "tracking", `${tokenAddress}.json`);
}

function runSignalSolScript(
  script: SignalSolScriptName,
  args: string[] = [],
  context: SignalSolRunContext = {},
): Promise<SignalSolOneShotResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [getScriptPath(script), ...args],
      {
        cwd: SIGNAL_SOL_DIR,
        env: buildSignalSolEnv(context),
        maxBuffer: ONE_SHOT_BUFFER_BYTES,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }

        resolve({
          mode: "oneshot",
          script,
          output: stdout.trim(),
        });
      },
    );
  });
}

function startBackgroundSignalSolScript(input: {
  script: SignalSolScriptName;
  key: string;
  args?: string[];
  trackingFile?: string;
  context?: SignalSolRunContext;
}): SignalSolBackgroundResult {
  const active = backgroundProcesses.get(input.key);

  if (active && active.child.exitCode === null && !active.child.killed) {
    return {
      mode: "background",
      script: input.script,
      status: "already_running",
      pid: active.child.pid ?? null,
      logFile: active.logFile,
      ...(active.trackingFile ? { trackingFile: active.trackingFile } : {}),
    };
  }

  backgroundProcesses.delete(input.key);
  ensureSignalSolLogDir();

  const logFile = path.join(SIGNAL_SOL_LOG_DIR, `${getSafeLogName(input.key)}.log`);
  const stdoutFd = openSync(logFile, "a");
  const stderrFd = openSync(logFile, "a");

  try {
    const child = spawn(
      process.execPath,
      [getScriptPath(input.script), ...(input.args ?? [])],
      {
        cwd: SIGNAL_SOL_DIR,
        env: buildSignalSolEnv(input.context),
        stdio: ["ignore", stdoutFd, stderrFd],
      },
    );

    closeSync(stdoutFd);
    closeSync(stderrFd);

    const entry: ManagedSignalSolProcess = {
      child,
      logFile,
      ...(input.trackingFile ? { trackingFile: input.trackingFile } : {}),
    };

    backgroundProcesses.set(input.key, entry);

    const clearEntry = () => {
      const current = backgroundProcesses.get(input.key);
      if (current?.child.pid === child.pid) {
        backgroundProcesses.delete(input.key);
      }
    };

    child.on("exit", clearEntry);
    child.on("error", clearEntry);

    return {
      mode: "background",
      script: input.script,
      status: "started",
      pid: child.pid ?? null,
      logFile,
      ...(input.trackingFile ? { trackingFile: input.trackingFile } : {}),
    };
  } catch (error) {
    closeSync(stdoutFd);
    closeSync(stderrFd);
    throw error;
  }
}

export function stopAllSignalSolProcesses(): void {
  for (const [key, processInfo] of backgroundProcesses) {
    if (processInfo.child.exitCode === null && !processInfo.child.killed) {
      processInfo.child.kill("SIGTERM");
    }
    backgroundProcesses.delete(key);
  }
}

export async function runArtificialVolumeScan(
  tokenAddress: string,
  context: SignalSolRunContext = {},
): Promise<SignalSolOneShotResult> {
  return runSignalSolScript("artificialVolumeScan.js", [tokenAddress], context);
}

export function runBottomsUp(context: SignalSolRunContext = {}): SignalSolBackgroundResult {
  return startBackgroundSignalSolScript({
    script: "bottomsUp.js",
    key: "bottomsUp",
    context,
  });
}

export function runChartHealth(
  tokenAddress: string,
  tokenName?: string,
  context: SignalSolRunContext = {},
): SignalSolBackgroundResult {
  return startBackgroundSignalSolScript({
    script: "chartHealth.js",
    key: `chartHealth:${tokenAddress.toLowerCase()}`,
    args: tokenName ? [tokenAddress, tokenName] : [tokenAddress],
    trackingFile: getChartHealthTrackingFile(tokenAddress),
    context,
  });
}

export function runMomentumGains(context: SignalSolRunContext = {}): SignalSolBackgroundResult {
  return startBackgroundSignalSolScript({
    script: "momentumGains.js",
    key: "momentumGains",
    context,
  });
}

export function runMomentumStart(context: SignalSolRunContext = {}): SignalSolBackgroundResult {
  return startBackgroundSignalSolScript({
    script: "momentumStart.js",
    key: "momentumStart",
    context,
  });
}

// export function runNewPump(context: SignalSolRunContext = {}): SignalSolBackgroundResult {
//   return startBackgroundSignalSolScript({
//     script: "newPump.js",
//     key: "newPump",
//     context,
//   });
// }
