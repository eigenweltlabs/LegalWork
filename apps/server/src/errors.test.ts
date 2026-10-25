import { expect, test } from "bun:test";
import { ApiError, projectFileError } from "./errors.js";

test.each([
  { code: "Unknown system error -81", errno: -81 },
  { code: "ENEEDAUTH" },
])("cloud authentication errors explain how to recover ($code)", (systemError) => {
  const cause = Object.assign(new Error("Unknown system error -81, read"), systemError);
  const error = projectFileError("/projects/Client matter", cause);
  expect(error.status).toBe(503);
  expect(error.code).toBe("cloud_auth_required");
  expect(error.message).toContain("Client matter");
  expect(error.message).toContain("sign in");
  expect(error.message).toContain("Nextcloud");
  expect(error.details).toMatchObject({ reason: cause.message });
});

test.each(["EACCES", "EIO", "ETIMEDOUT"])("other file failures retain their real reason (%s)", (code) => {
  const cause = Object.assign(new Error(`${code}: cannot read project file`), { code });
  const error = projectFileError("/projects/Client matter", cause);
  expect(error.code).toBe("project_files_unavailable");
  expect(error.message).toContain(cause.message);
  expect(error.message).toContain("retry");
});

test("existing API errors keep their status, code and message", () => {
  const error = new ApiError(422, "invalid_jsonc", "Failed to parse JSONC");
  expect(projectFileError("/projects/matter", error)).toBe(error);
});
