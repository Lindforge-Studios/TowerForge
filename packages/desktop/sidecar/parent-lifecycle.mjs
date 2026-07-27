export function parseParentPid(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const pid = Number(value);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

export function createParentProcessWatch({
  parentPid,
  probe = process.kill.bind(process),
  onMissing,
  intervalMs = 1_000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
}) {
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0 || typeof onMissing !== "function") {
    return Object.freeze({ stop() {} });
  }
  let active = true;
  const timer = setIntervalFn(() => {
    if (!active) return;
    try {
      probe(parentPid, 0);
    } catch {
      active = false;
      clearIntervalFn(timer);
      onMissing();
    }
  }, intervalMs);
  timer?.unref?.();
  return Object.freeze({
    stop() {
      if (!active) return;
      active = false;
      clearIntervalFn(timer);
    }
  });
}
