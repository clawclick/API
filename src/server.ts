import { runtimeEnv } from "#config/env";
import { buildApp } from "./app.js";

const app = buildApp();

try {
  await app.listen({ host: runtimeEnv.host, port: runtimeEnv.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}