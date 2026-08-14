import { describe, expect, it } from "vitest";

import { listFlowTemplates } from "./templates";
import { validateFlowForActivation } from "./validate";

describe("plantillas de flujos", () => {
  it("nacen completas y se pueden activar sin errores", () => {
    for (const template of listFlowTemplates()) {
      const issues = validateFlowForActivation(
        {
          name: template.name,
          trigger_type: template.trigger_type,
          trigger_config: template.trigger_config as Record<string, unknown>,
          entry_node_id: template.entry_node_id,
        },
        template.nodes.map((node) => ({
          ...node,
          config: node.config as Record<string, unknown>,
        })),
      );

      expect(
        issues.filter((issue) => issue.severity === "error"),
        template.slug,
      ).toEqual([]);
    }
  });
});
