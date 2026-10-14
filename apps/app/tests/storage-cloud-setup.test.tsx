/** @jsxImportSource react */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { FileStorageView } from "../src/react-app/domains/settings/pages/file-storage-view";
import { HubScopeContext } from "../src/react-app/domains/settings/pages/hub-scope-context";
import { StorageDriveTree } from "../src/react-app/domains/session/panel/storage-drive-tree";

const client = createLegalworkServerClient({ baseUrl: "http://localhost:1", token: "synthetic", hostToken: "synthetic-host" });
function cache() {
  const value = new QueryClient();
  value.setQueryData(["storage-connections", "workspace"], { connections: [{ id: "connector:google-drive:account", name: "Google Drive", config: { kind: "oauth", provider: "google-drive", accountId: "account", root: "" }, readOnly: true, enabled: true, updatedAt: 0, configuredSecrets: [] }] });
  value.setQueryData(["storage-oauth-providers", "workspace"], { providers: [{ id: "box", name: "Box", rootHint: "" }, { id: "dropbox", name: "Dropbox", rootHint: "" }] });
  return value;
}
test("File Storage owns native cloud setup and shows a connected account once without legacy connection controls", () => {
  const queryClient = cache();
  const html = renderToStaticMarkup(<QueryClientProvider client={queryClient}><FileStorageView client={client} workspaceId="workspace" /></QueryClientProvider>);
  for (const name of ["Google Drive", "OneDrive", "OneDrive Personal", "SharePoint", "Box", "Dropbox", "Network share", "WebDAV", "S3-compatible", "Azure Blob", "Google Cloud Storage", "SFTP", "FTP"]) expect(html).toContain(name);
  expect(html.match(/>Google Drive</g)).toHaveLength(1); expect(html).toContain("Add a folder or library");
  expect(html).not.toContain("Edit Google Drive"); expect(html).not.toContain("Disconnect Google Drive"); expect(html).not.toMatch(/<img[^>]+src="https?:/);
  queryClient.clear();
});
test("personal native cloud setup does not appear in the team storage tab", () => {
  const queryClient = cache();
  const html = renderToStaticMarkup(<QueryClientProvider client={queryClient}><HubScopeContext.Provider value="team"><FileStorageView client={client} workspaceId="workspace" /></HubScopeContext.Provider></QueryClientProvider>);
  expect(html).not.toContain("Google Drive"); expect(html).not.toContain("Add a folder or library"); queryClient.clear();
});
test("Memory Drive uses bundled provider marks and preserves read-only root controls", () => {
  const queryClient = new QueryClient();
  const html = renderToStaticMarkup(<QueryClientProvider client={queryClient}><StorageDriveTree client={client} workspaceId="workspace" roots={[{ id: "cloud", name: "Google Drive", kind: "oauth", provider: "google-drive", writable: false }]} onOpenFile={() => {}} /></QueryClientProvider>);
  expect(html).toContain("Google Drive"); expect(html).toContain("/ext-googledrive.svg"); expect(html).not.toContain("https://"); expect(html).toContain("disabled"); queryClient.clear();
});
