import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { EngineProjectStatus } from "@legalwork/types/engine-project";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { ProjectSetupGate } from "../src/react-app/domains/onboarding/project-setup-gate";
import { engineProjectStatusQueryKey } from "../src/react-app/domains/workspace/engine-project-approval";

test("first-run AI setup waits for the selected project's explicit review and resumes when it is ready", () => {
  const client = createLegalworkServerClient({ baseUrl: "http://fixture.invalid", token: "fixture-only" });
  const cache = new QueryClient();
  const status: EngineProjectStatus = { state: "approval_required", required: true, directory: "/fixture/selected-project",
    approvalScope: [{ directory: "/fixture", configPaths: ["/fixture/opencode.json"] }],
    plugins: [{ target: "project-plugin", sources: ["/fixture/opencode.json"], approved: false }], projection: {},
  };
  let approvals = 0;
  const render = (workspaceId: string | null = "selected", connected = true) => renderToStaticMarkup(
    <QueryClientProvider client={cache}><ProjectSetupGate client={connected ? client : null} workspaceId={workspaceId} onApproved={() => { approvals++; }}>
      <div>Connect your AI provider</div>
    </ProjectSetupGate></QueryClientProvider>,
  );
  try {
    cache.setQueryData(engineProjectStatusQueryKey(client, "selected"), status);
    const pending = render();
    expect(pending).toContain("Allow project automation");
    expect(pending).toContain("/fixture/selected-project");
    expect(pending).toContain("/fixture/opencode.json");
    expect(pending).not.toContain("Connect your AI provider");
    expect(approvals).toBe(0);
    cache.setQueryData(engineProjectStatusQueryKey(client, "selected"), { ...status, state: "configuration_conflict", projection: { diagnostic: "Resolve authored configuration" } });
    expect(render()).toContain("Resolve authored configuration");
    expect(render()).not.toContain("Connect your AI provider");
    cache.setQueryData(engineProjectStatusQueryKey(client, "selected"), { ...status, state: "ready" });
    expect(render()).toBe("<div>Connect your AI provider</div>");
    expect(render("different-project")).not.toContain("Connect your AI provider");
    expect(render(null, false)).not.toContain("Connect your AI provider");
    expect(render(null, false)).toContain('role="status"');
    expect(render(null, false)).not.toContain("Not connected to a server");
    expect(approvals).toBe(0);
  } finally { cache.clear(); }
});
