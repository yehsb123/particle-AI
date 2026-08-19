import type { UIBlueprint, UIPatch } from "@dm/contracts";
import { UI_SCHEMA_VERSION } from "@dm/contracts";

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
            { id: "ai-presence", type: "Badge", props: { text: "AI · observing", tone: "muted" } },
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

/**
 * The autonomous morph applied when a runtime incident is detected. It does NOT destroy
 * the editor — it reduces the file explorer and adds an incident panel beside the work.
 */
export function incidentPatch(decisionId = "decision-incident"): UIPatch {
  return {
    patchId: "patch-incident",
    fromWorkspaceId: "ws-dev",
    decisionId,
    operations: [
      { op: "collapse", targetId: "files" },
      {
        op: "add",
        parentId: "workspace",
        index: 2,
        component: {
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
                  props: {
                    title: "Error logs",
                    lines: [
                      "GET /users/42 → 500 Internal Server Error",
                      "TypeError: Cannot read properties of undefined (reading 'findById')",
                      "  at getUser (src/routes.ts:2:19)",
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
                      props: {
                        text: "Probable cause: `db.users` renamed to `db.user` in the recent diff. Confidence 82%.",
                      },
                    },
                    { id: "incident-confidence", type: "Progress", props: { value: 0.82, label: "confidence" } },
                  ],
                },
              ],
            },
            {
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
            },
          ],
        },
      },
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
