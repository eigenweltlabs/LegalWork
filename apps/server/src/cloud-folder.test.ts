import { expect, test } from "bun:test";
import { isMacCloudFolder } from "./cloud-folder.js";

test("File Provider folders include their nested projects and fully local contents", () => {
  expect(isMacCloudFolder("/Users/test/Library/CloudStorage/OneDrive-Firm/Matters", "/Users/test")).toBe(true);
  expect(isMacCloudFolder("/Users/test/Library/CloudStorage/Dropbox/Matters", "/Users/test")).toBe(true);
  expect(isMacCloudFolder("/Users/test/Library/Mobile Documents/com~apple~CloudDocs/Matters", "/Users/test")).toBe(true);
});

test("ordinary folders named OneDrive and sibling prefixes stay shareable", () => {
  expect(isMacCloudFolder("/Users/test/Projects/OneDrive contracts", "/Users/test")).toBe(false);
  expect(isMacCloudFolder("/Users/test/Library/CloudStorage-backup/Matters", "/Users/test")).toBe(false);
  expect(isMacCloudFolder("/Users/test/Library/Mobile Documents/com~apple~CloudDocs-backup", "/Users/test")).toBe(false);
});
