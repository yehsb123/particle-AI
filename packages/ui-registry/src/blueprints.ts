import type { UIBlueprint, UIComponent, UIPatch } from "@particle/contracts";
import { UI_SCHEMA_VERSION } from "@particle/contracts";

/**
 * The initial development workspace. This is a *code workspace*, not a chat screen —
 * an editor-oriented layout with a subtle AI presence indicator.
 */
export function developmentBlueprint(now: string, decisionId = "seed"): UIBlueprint {
  return {
    schemaVersion: UI_SCHEMA_VERSION,
    workspaceId: "ws-dev",
    goal: "Develop the application",
    mode: "development",
    root: {
      id: "workspace",
      type: "Stack",
      props: { gap: "md" },
      children: [
        {
          id: "topbar",
          type: "Row",
          props: { justify: "between", align: "center" },
          children: [
            { id: "title", type: "Heading", props: { text: "Workspace", level: 2 } },
            { id: "workspace-mode", type: "Badge", props: { text: "development", tone: "muted" } },
          ],
        },
        {
          id: "main",
          type: "SplitPane",
          props: { orientation: "horizontal", ratio: 0.24 },
          children: [
            {
              id: "files",
              type: "FileExplorer",
              props: {
                title: "Files",
                items: ["src/server.ts", "src/routes.ts", "src/db.ts", "package.json"],
              },
            },
            {
              id: "editor",
              type: "CodeEditor",
              // holds unsaved user work — the morph guard must never destroy it
              volatile: true,
              props: {
                title: "src/routes.ts",
                language: "typescript",
                value:
                  "export async function getUser(id: string) {\n  return db.users.findById(id);\n}\n",
              },
            },
          ],
        },
        {
          id: "devstatus",
          type: "Panel",
          props: { title: "Development status" },
          children: [
            { id: "build-state", type: "Badge", props: { text: "Build: passing", tone: "ok" } },
            { id: "test-state", type: "Badge", props: { text: "Tests: 42 passing", tone: "ok" } },
          ],
        },
      ],
    },
    metadata: {
      generatedAt: now,
      decisionId,
      confidence: 1,
      reasonSummary: "Initial development workspace.",
    },
  };
}

export type IncidentKind = "runtime_error" | "build_failure" | "test_failure" | "security_alert";

const ACTIONS: UIComponent = {
  id: "incident-actions",
  type: "ActionPanel",
  props: { title: "Suggested actions" },
  children: [
    {
      id: "action-revert",
      type: "Button",
      props: { text: "Revert recent diff", tone: "primary" },
      actions: [{ event: "user.requested_action", capabilityId: "development.revert_diff" }],
    },
    {
      id: "action-undo-morph",
      type: "Button",
      props: { text: "Undo this change", tone: "muted" },
      actions: [{ event: "user.requested_undo" }],
    },
  ],
};

/** Build the incident panel (id "incident") for a given problem kind. */
function incidentPanel(kind: IncidentKind): UIComponent {
  if (kind === "build_failure") {
    return {
      id: "incident",
      type: "Panel",
      props: { title: "Build failure", tone: "critical", badge: "BUILD" },
      children: [
        {
          id: "incident-grid",
          type: "Grid",
          props: { columns: 2, gap: "md" },
          children: [
            {
              id: "incident-logs",
              type: "LogViewer",
              props: {
                title: "Compiler errors",
                lines: [
                  "src/routes.ts:2:19 - error TS2551: Property 'users' does not exist on type 'DB'.",
                  "  Did you mean 'user'?",
                  "Found 1 error in src/routes.ts",
                ],
              },
            },
            {
              id: "incident-diff",
              type: "DiffViewer",
              props: {
                title: "Recent changes",
                diff: "- return db.users.findById(id);\n+ return db.user.findById(id);",
              },
            },
            {
              id: "incident-assessment",
              type: "Card",
              props: { title: "AI assessment" },
              children: [
                {
                  id: "incident-assessment-text",
                  type: "Markdown",
                  props: { text: "The rename `db.users` → `db.user` broke the type check. Revert or fix the reference." },
                },
                { id: "incident-confidence", type: "Progress", props: { value: 0.9, label: "confidence" } },
              ],
            },
            {
              id: "incident-timeline",
              type: "Timeline",
              props: {
                title: "Build timeline",
                items: [
                  { time: "T+0s", label: "Build started" },
                  { time: "T+3s", label: "Type error in src/routes.ts" },
                  { time: "T+3s", label: "Build failed" },
                ],
              },
            },
          ],
        },
        ACTIONS,
      ],
    };
  }

  if (kind === "test_failure") {
    return {
      id: "incident",
      type: "Panel",
      props: { title: "Test failure", tone: "critical", badge: "TESTS" },
      children: [
        {
          id: "incident-grid",
          type: "Grid",
          props: { columns: 2, gap: "md" },
          children: [
            {
              id: "incident-tests",
              type: "Table",
              props: {
                title: "Failing tests",
                columns: ["Test", "Status"],
                rows: [
                  ["getUser returns a user", "failed"],
                  ["getUser handles missing id", "passed"],
                ],
              },
            },
            {
              id: "incident-diff",
              type: "DiffViewer",
              props: {
                title: "Assertion",
                diff: "- expected: { id: '42', name: 'Ada' }\n+ received: undefined",
              },
            },
            {
              id: "incident-assessment",
              type: "Card",
              props: { title: "AI assessment" },
              children: [
                {
                  id: "incident-assessment-text",
                  type: "Markdown",
                  props: { text: "`getUser` returns undefined — the `db.user` lookup likely misses. Confidence 78%." },
                },
                { id: "incident-confidence", type: "Progress", props: { value: 0.78, label: "confidence" } },
              ],
            },
            {
              id: "incident-timeline",
              type: "Timeline",
              props: {
                title: "Test timeline",
                items: [
                  { time: "T+0s", label: "Test run started" },
                  { time: "T+2s", label: "1 assertion failed" },
                  { time: "T+2s", label: "Suite failed" },
                ],
              },
            },
          ],
        },
        ACTIONS,
      ],
    };
  }

  if (kind === "security_alert") {
    return {
      id: "incident",
      type: "Panel",
      props: { title: "Security alert", tone: "critical", badge: "SECURITY" },
      children: [
        {
          id: "incident-grid",
          type: "Grid",
          props: { columns: 2, gap: "md" },
          children: [
            {
              id: "incident-vuln",
              type: "Table",
              // real rows come from the security.scan_dependencies capability at morph time
              props: { title: "Vulnerable dependency", columns: ["Package", "Severity", "Advisory"], rows: [] },
              bindings: [{ prop: "rows", source: "capability:security.scan_dependencies:rows" }],
            },
            {
              id: "incident-assessment",
              type: "Card",
              props: { title: "AI assessment" },
              children: [
                {
                  id: "incident-assessment-text",
                  type: "Markdown",
                  props: { text: "`lodash@4.17.20` has a known prototype-pollution vulnerability. Updating to 4.17.21 resolves it." },
                },
                { id: "incident-confidence", type: "Progress", props: { value: 0.95, label: "confidence" } },
              ],
            },
            {
              id: "incident-timeline",
              type: "Timeline",
              props: {
                title: "Security timeline",
                items: [
                  { time: "T+0s", label: "Advisory published" },
                  { time: "T+1s", label: "Dependency matched in lockfile" },
                  { time: "T+1s", label: "Awaiting your decision" },
                ],
              },
            },
          ],
        },
        {
          id: "incident-actions",
          type: "ActionPanel",
          props: { title: "Suggested actions" },
          children: [
            {
              id: "action-update-dep",
              type: "Button",
              props: { text: "Update dependency", tone: "primary" },
              actions: [{ event: "user.requested_action", capabilityId: "security.update_dependency" }],
            },
            {
              id: "action-undo-morph",
              type: "Button",
              props: { text: "Undo this change", tone: "muted" },
              actions: [{ event: "user.requested_undo" }],
            },
          ],
        },
      ],
    };
  }

  // runtime_error (default)
  return {
    id: "incident",
    type: "Panel",
    props: { title: "Runtime incident", tone: "critical", badge: "CRITICAL" },
    children: [
      {
        id: "incident-grid",
        type: "Grid",
        props: { columns: 2, gap: "md" },
        children: [
          {
            id: "incident-logs",
            type: "LogViewer",
            // real lines come from the development.read_logs capability at morph time
            props: { title: "Error logs", lines: ["collecting…"] },
            bindings: [{ prop: "lines", source: "capability:development.read_logs:lines" }],
          },
          {
            id: "incident-diff",
            type: "DiffViewer",
            props: {
              title: "Recent changes",
              diff: "- return db.users.findById(id);\n+ return db.user.findById(id);",
            },
          },
          {
            id: "incident-services",
            type: "Table",
            props: {
              title: "Service state",
              columns: ["Service", "State"],
              rows: [
                ["API", "failed"],
                ["DB", "healthy"],
              ],
            },
          },
          {
            id: "incident-assessment",
            type: "Card",
            props: { title: "AI assessment" },
            children: [
              {
                id: "incident-assessment-text",
                type: "Markdown",
                props: { text: "Probable cause: `db.users` renamed to `db.user` in the recent diff. Confidence 82%." },
              },
              { id: "incident-confidence", type: "Progress", props: { value: 0.82, label: "confidence" } },
            ],
          },
          {
            id: "incident-timeline",
            type: "Timeline",
            props: {
              title: "Incident timeline",
              items: [
                { time: "T+0s", label: "First 500 on GET /users/42" },
                { time: "T+1s", label: "Error rate spike detected" },
                { time: "T+2s", label: "Probable cause localized to recent diff" },
              ],
            },
          },
          {
            id: "incident-chart",
            type: "Chart",
            props: { title: "Errors / min", data: [0, 0, 1, 4, 9, 12, 7] },
          },
        ],
      },
      ACTIONS,
    ],
  };
}

/**
 * The autonomous morph applied when a problem is detected. It does NOT destroy the editor —
 * it reduces the file explorer and adds an incident panel (id "incident") beside the work.
 * The layout adapts to the problem kind (runtime error / build failure / test failure).
 *
 * `recurrence` >= 2 marks the incident as recurring — the runtime's episodic memory has seen
 * this situation before, and the body reflects that experience with a badge.
 */
export function incidentPatch(
  decisionId = "decision-incident",
  kind: IncidentKind = "runtime_error",
  recurrence = 0,
): UIPatch {
  const panel = incidentPanel(kind);
  if (recurrence >= 2) {
    panel.children = [
      {
        id: "incident-recurrence",
        type: "Row",
        props: { align: "center" },
        children: [
          { id: "incident-recurrence-badge", type: "Badge", props: { text: "recurring", tone: "warn" } },
          { id: "incident-recurrence-count", type: "Badge", props: { text: `×${recurrence}`, tone: "warn" } },
        ],
      },
      ...(panel.children ?? []),
    ];
  }
  return {
    patchId: `patch-incident-${kind}`,
    fromWorkspaceId: "ws-dev",
    decisionId,
    operations: [
      { op: "collapse", targetId: "files" },
      { op: "add", parentId: "workspace", index: 2, component: panel },
      { op: "highlight", targetId: "incident" },
    ],
  };
}

/**
 * The morph applied once the incident is resolved and stability is observed: the incident
 * panel is removed and the file explorer expands back to the normal development layout.
 */
export function recoveryPatch(decisionId = "decision-recovery"): UIPatch {
  return {
    patchId: "patch-recovery",
    fromWorkspaceId: "ws-dev",
    decisionId,
    operations: [
      { op: "remove", targetId: "incident" },
      { op: "expand", targetId: "files" },
    ],
  };
}


/**
 * Concept v2 — an *augment* morph: no problem, no incident. The body adds one context card
 * that serves the person's current intent (returning → re-entry summary; stuck → related
 * context). Idempotent by id "context"; recovery/undo remove it like any other morph.
 */
export type AugmentKind = "returning" | "stuck";

export function augmentPatch(decisionId = "decision-augment", kind: AugmentKind = "returning"): UIPatch {
  const card: UIComponent =
    kind === "returning"
      ? {
          id: "context",
          type: "Card",
          props: { title: "Welcome back" },
          children: [
            { id: "context-text", type: "Markdown", props: { text: "You were away. Nothing broke while you were gone — here is where you left off." },
              bindings: [{ prop: "text", source: "capability:workspace.get_state:summary" }] },
            { id: "context-dismiss", type: "Button", props: { text: "Dismiss", tone: "muted" }, actions: [{ event: "user.requested_undo" }] },
          ],
        }
      : {
          id: "context",
          type: "Card",
          props: { title: "You seem stuck on this" },
          children: [
            { id: "context-text", type: "Markdown", props: { text: "The same action has repeated several times. Related context is now beside your work." } },
            { id: "context-diff", type: "DiffViewer", props: { title: "Recent changes", diff: "- return db.users.findById(id);\n+ return db.user.findById(id);" } },
            { id: "context-dismiss", type: "Button", props: { text: "Dismiss", tone: "muted" }, actions: [{ event: "user.requested_undo" }] },
          ],
        };
  return {
    patchId: `patch-augment-${kind}`,
    fromWorkspaceId: "ws-dev",
    decisionId,
    operations: [
      { op: "add", parentId: "workspace", index: 1, component: card },
      { op: "highlight", targetId: "context" },
    ],
  };
}
