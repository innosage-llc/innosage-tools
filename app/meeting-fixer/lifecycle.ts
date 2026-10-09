export interface Terminable {
  terminate(): void;
}

export function terminateAndRethrow<T extends Terminable>(resource: T, error: unknown): never {
  resource.terminate();
  throw error;
}

export class RunLifecycle<T extends Terminable> {
  private currentRunId = 0;
  private activeResource: T | null = null;

  begin(): number {
    this.invalidate();
    return this.currentRunId;
  }

  invalidate(): number {
    this.currentRunId += 1;
    this.activeResource?.terminate();
    this.activeResource = null;
    return this.currentRunId;
  }

  claim(runId: number, resource: T): boolean {
    if (runId !== this.currentRunId) {
      resource.terminate();
      return false;
    }
    this.activeResource = resource;
    return true;
  }

  isCurrent(runId: number): boolean {
    return runId === this.currentRunId;
  }

  finish(runId: number, resource: T): boolean {
    if (this.activeResource === resource) this.activeResource = null;
    resource.terminate();
    return runId === this.currentRunId;
  }
}
