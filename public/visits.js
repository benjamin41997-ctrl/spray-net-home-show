// One authenticated project open per page/visitor. No cookies, fingerprint,
// localStorage or analytics service. Recording never blocks the visitor flow.
export function createVisitRecorder(send) {
  let visitId = crypto.randomUUID(), generation = 0;
  const completed = new Set(), pending = new Map();
  function record(access) {
    if (!access?.id || !access?.token) return Promise.resolve(false);
    const key = `${access.id}:${access.token}`;
    if (completed.has(key)) return Promise.resolve(false);
    if (pending.has(key)) return pending.get(key).promise;
    const controller = new AbortController(), version = generation;
    const timeout = setTimeout(() => controller.abort(),8000), entry = {controller};
    entry.promise = Promise.resolve().then(() => {
      if (controller.signal.aborted) return false;
      return send(access,{visitId},controller.signal);
    }).then(() => {
      if (version !== generation || controller.signal.aborted) return false;
      completed.add(key);return true;
    }).catch(() => false).finally(() => {clearTimeout(timeout);if (pending.get(key) === entry) pending.delete(key);});
    pending.set(key,entry);return entry.promise;
  }
  function reset() {
    generation++;for (const entry of pending.values()) entry.controller.abort();
    pending.clear();completed.clear();visitId = crypto.randomUUID();
  }
  return {record,reset};
}
