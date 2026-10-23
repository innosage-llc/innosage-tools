// Reproducible fixture inputs only. This module opens no database or connection.
export function trialPlan(provider, scale, seed) {
  if (!["drive", "webdav"].includes(provider) || ![10, 1000].includes(scale) ||
      !Number.isSafeInteger(seed) || seed < 1) throw new Error("Invalid safety trial identity");
  let state = seed;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  const span = scale - 6;
  const first = 5 + next() % span;
  const second = 5 + (first - 5 + 1 + next() % (span - 1)) % span;
  return { provider, scale, seed, differentPageIndices: [first, second],
    recoveryOrder: next() % 2 ? ["b", "a", "b", "a"] : ["a", "b", "a", "b"] };
}

export function safetySchedule() {
  let seed = 0;
  return ["drive", "webdav"].flatMap((provider) =>
    [10, 1000].flatMap((scale) =>
      Array.from({ length: 25 }, () => trialPlan(provider, scale, ++seed)),
    ),
  );
}
