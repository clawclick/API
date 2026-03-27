import { SIGNAL_EVENT_PREFIX } from "./signalEmitter.js";

let configured = false;

function shouldAllowStdout(args) {
  if (args.length === 0) {
    return false;
  }

  const [first] = args;
  return typeof first === "string" && first.startsWith(SIGNAL_EVENT_PREFIX);
}

export function configureSignalSolLogging() {
  if (configured) {
    return;
  }
  configured = true;

  const verbose = ["1", "true", "yes", "on"].includes((process.env.SIGNAL_SOL_VERBOSE || "").trim().toLowerCase());
  if (verbose) {
    return;
  }

  const originalLog = console.log.bind(console);

  console.log = (...args) => {
    if (shouldAllowStdout(args)) {
      originalLog(...args);
    }
  };

  console.info = () => {};
  console.debug = () => {};
  console.warn = () => {};
  console.clear = () => {};
  console.time = () => {};
  console.timeEnd = () => {};
}
