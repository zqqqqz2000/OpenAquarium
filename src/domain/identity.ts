export type IdFactory = (prefix: string) => string;

export interface MutationContext {
  createId: IdFactory;
  now(): string;
}

function parseStartedAtMs(startedAt?: string): number {
  if (!startedAt) {
    return 0;
  }

  const parsed = Date.parse(startedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createSequenceIdFactory(start = 0): IdFactory {
  let index = start;

  return (prefix: string) => {
    index += 1;
    return `${prefix}_${index.toString().padStart(4, "0")}`;
  };
}

export function createRuntimeContext(start = 0, startedAt = "2026-03-09T00:00:00.000Z"): MutationContext {
  const createId = createSequenceIdFactory(start);
  let tick = 0;

  return {
    createId,
    now() {
      const base = new Date(startedAt);
      base.setSeconds(base.getSeconds() + tick);
      tick += 1;
      return base.toISOString();
    },
  };
}

export function createSystemClockContext(start = 0, startedAt?: string): MutationContext {
  const createId = createSequenceIdFactory(start);
  let lastIssuedAtMs = parseStartedAtMs(startedAt);

  return {
    createId,
    now() {
      const nextMs = Math.max(Date.now(), lastIssuedAtMs + 1);
      lastIssuedAtMs = nextMs;
      return new Date(nextMs).toISOString();
    },
  };
}
