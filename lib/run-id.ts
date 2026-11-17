// No imports, so the browser bundle can use it as well as the server.

/** Whether `value` is a telemetry run ID, as the collector accepts one. */
export function isRunId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(value);
}
