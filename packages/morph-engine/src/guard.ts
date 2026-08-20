import type {
  AttentionState,
  Severity,
  UIBlueprint,
  UIComponent,
  UIPatch,
  UIPatchOperation,
} from "@particle/contracts";
import { isStructuralOp } from "@particle/contracts";
import { DEFAULT_MORPH_POLICY, type MorphPolicy } from "./policy";

export type GuardInput = {
  currentUI: UIBlueprint;
  desiredPatch: UIPatch;
  attention: AttentionState;
  confidence: number;
  severity: Severity;
  /** epoch ms — passed in, never read from the clock inside pure code */
  now: number;
  lastMorphAt?: number;
  lastMajorMorphAt?: number;
  policy?: MorphPolicy;
};

export type GuardResult = {
  /** the patch that survived the guard (may have fewer ops, or none) */
  patch: UIPatch;
  /** whether anything at all is allowed through */
  allowed: boolean;
  /** ops that were dropped, with the reason code */
  dropped: { op: UIPatchOperation; reason: string }[];
  reasonCodes: string[];
};

function subtreeIds(node: UIComponent, acc = new Set<string>()): Set<string> {
  acc.add(node.id);
  for (const c of node.children ?? []) subtreeIds(c, acc);
  return acc;
}

function findNode(root: UIComponent, id: string): UIComponent | undefined {
  if (root.id === id) return root;
  for (const c of root.children ?? []) {
    const f = findNode(c, id);
    if (f) return f;
  }
  return undefined;
}

/** ids on the path from root to `id`, inclusive (ancestors + self). */
function pathIds(root: UIComponent, id: string, trail: string[] = []): string[] | undefined {
  const next = [...trail, root.id];
  if (root.id === id) return next;
  for (const c of root.children ?? []) {
    const found = pathIds(c, id, next);
    if (found) return found;
  }
  return undefined;
}

function subtreeHasVolatile(node: UIComponent): boolean {
  if (node.volatile) return true;
  return (node.children ?? []).some(subtreeHasVolatile);
}

/** The id a structural/prop op acts on within the current tree (undefined for pure add). */
function targetId(op: UIPatchOperation): string | undefined {
  return "targetId" in op ? op.targetId : undefined;
}

/**
 * The Morph Guard: decides which operations of a desired patch may safely apply, given
 * confidence, cooldown/dwell timing, active user focus, and unsaved state. Pure function.
 */
export function guardPatch(input: GuardInput): GuardResult {
  const policy = input.policy ?? DEFAULT_MORPH_POLICY;
  const root = input.currentUI.root;
  const ops = input.desiredPatch.operations;
  const dropped: GuardResult["dropped"] = [];
  const reasonCodes = new Set<string>();

  const isCritical = input.severity === "critical";
  const bypassCooldown = isCritical && policy.allowCriticalBypass;

  const structuralCount = ops.filter((o) => isStructuralOp(o.op)).length;
  const totalIds = subtreeIds(root).size;
  const isMajor =
    totalIds > 0 && structuralCount / totalIds >= policy.majorChangeRatio;

  // ── whole-patch rejections ───────────────────────────────────────
  if (input.confidence < policy.minConfidence && !isCritical) {
    return rejectAll(input, ops, "confidence_below_min");
  }
  if (!bypassCooldown && input.lastMorphAt !== undefined) {
    if (input.now - input.lastMorphAt < policy.cooldownMs) {
      return rejectAll(input, ops, "cooldown_active");
    }
  }

  const focusedPath =
    input.attention.typing && input.attention.focusedComponentId
      ? new Set(pathIds(root, input.attention.focusedComponentId) ?? [])
      : undefined;
  const focusedId = input.attention.focusedComponentId;

  const survivors: UIPatchOperation[] = [];

  for (const op of ops) {
    const structural = isStructuralOp(op.op);

    // Structural ops need higher confidence.
    if (structural && input.confidence < policy.minConfidenceStructural && !isCritical) {
      dropped.push({ op, reason: "structural_confidence_below_min" });
      reasonCodes.add("structural_confidence_below_min");
      continue;
    }

    // Major transformation must respect dwell time (unless critical).
    if (structural && isMajor && !isCritical && input.lastMajorMorphAt !== undefined) {
      if (input.now - input.lastMajorMorphAt < policy.majorDwellMs) {
        dropped.push({ op, reason: "major_dwell_active" });
        reasonCodes.add("major_dwell_active");
        continue;
      }
    }

    const tid = targetId(op);
    const node = tid ? findNode(root, tid) : undefined;

    // Never destroy unsaved work — not even on critical events.
    if (node && (op.op === "remove" || op.op === "replace" || op.op === "move")) {
      if (subtreeHasVolatile(node)) {
        dropped.push({ op, reason: "protects_unsaved_state" });
        reasonCodes.add("protects_unsaved_state");
        continue;
      }
    }

    // Focus protection: while the user types, don't disturb the focused subtree.
    if (focusedPath && tid) {
      const disturbsFocus =
        // op removes/replaces/moves an ancestor-or-self of the focused node
        ((op.op === "remove" || op.op === "replace" || op.op === "move") &&
          focusedPath.has(tid)) ||
        // op rewrites props/bindings of the focused node itself
        ((op.op === "updateProps" || op.op === "updateBinding") && tid === focusedId);
      if (disturbsFocus) {
        dropped.push({ op, reason: "protects_focus" });
        reasonCodes.add("protects_focus");
        continue;
      }
    }

    survivors.push(op);
  }

  return {
    patch: { ...input.desiredPatch, operations: survivors },
    allowed: survivors.length > 0,
    dropped,
    reasonCodes: [...reasonCodes],
  };
}

function rejectAll(
  input: GuardInput,
  ops: UIPatchOperation[],
  reason: string,
): GuardResult {
  return {
    patch: { ...input.desiredPatch, operations: [] },
    allowed: false,
    dropped: ops.map((op) => ({ op, reason })),
    reasonCodes: [reason],
  };
}
