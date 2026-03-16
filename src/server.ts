import { runtimeEnv } from "#config/env";
import { buildApp } from "./app.js";

const app = buildApp();

/* ── Graceful crash handling ──────────────────────────────── */
process.on("unhandledRejection", (reason) => {
  app.log.error({ err: reason }, "Unhandled promise rejection — this is a bug, not an expected error");
});

process.on("uncaughtException", (error) => {
  app.log.fatal({ err: error }, "Uncaught exception — shutting down");
  process.exit(1);
});

try {
  await app.listen({ host: runtimeEnv.host, port: runtimeEnv.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}