import type { UIPatch } from "@dm/contracts";

/** A bounded stack of inverse patches enabling "undo last morph". */
export class MorphHistory {
  private stack: UIPatch[] = [];
  constructor(private readonly limit = 50) {}

  /** Record the inverse of a just-applied patch. */
  push(inverse: UIPatch): void {
    this.stack.push(inverse);
    if (this.stack.length > this.limit) this.stack.shift();
  }

  /** Pop the most recent inverse patch (to be applied to undo). */
  pop(): UIPatch | undefined {
    return this.stack.pop();
  }

  get canUndo(): boolean {
    return this.stack.length > 0;
  }

  get depth(): number {
    return this.stack.length;
  }

  clear(): void {
    this.stack = [];
  }
}
