const SIGNAL_EVENT_PREFIX = "__SIGNAL_SOL_EVENT__";

export function emitSignalEvent(stream, type, data = {}, options = {}) {
  const payload = {
    stream,
    scope: options.scope || (stream === "chartHealth" ? "token" : "global"),
    ...(options.tokenAddress ? { tokenAddress: options.tokenAddress } : {}),
    type,
    emittedAt: new Date().toISOString(),
    source: "signal-sol-script",
    data,
  };

  console.log(`${SIGNAL_EVENT_PREFIX}${JSON.stringify(payload)}`);
}

export { SIGNAL_EVENT_PREFIX };
