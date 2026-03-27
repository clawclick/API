import { startSignalWorker, stopSignalWorker } from "#services/signalWorker";

process.on("unhandledRejection", (reason) => {
  console.error("[signal-worker] Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[signal-worker] Uncaught exception:", error);
  process.exit(1);
});

let stopping = false;

async function shutdown(signal: string): Promise<void> {
  if (stopping) {
    return;
  }

  stopping = true;
  console.log(`[signal-worker] Received ${signal}, shutting down...`);
  await stopSignalWorker();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

await startSignalWorker();
console.log("[signal-worker] Ready.");
