import { expect, spyOn, test } from "bun:test";
import chromeDevtools from "./legalwork-chrome-devtools.js";
import { AnthropicAuthPlugin } from "./legalwork-anthropic-auth.js";

test("bundled default plugins register browser tools and Anthropic sign-in without network", async () => {
  const network = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Plugin registration must stay offline"));
  try {
    const browser = await chromeDevtools();
    expect(await browser.tool.browser_version.execute()).toBe("opencode-chrome-devtools@1.0.4");
    expect(Object.keys(browser.tool)).toContain("browser_list");
    expect(Object.keys(browser.tool)).toContain("browser_screenshot");
    const auth = await AnthropicAuthPlugin({ client: {} });
    expect(auth.auth).toMatchObject({ provider: "anthropic" });
    expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); }
});
