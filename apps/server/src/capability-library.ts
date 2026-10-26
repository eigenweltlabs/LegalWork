import { readFile } from "node:fs/promises";
import { listSkills, type SkippedSkill } from "./skills.js";
import { parseFrontmatter } from "./frontmatter.js";

/** The existing UI resolver also supplies the engine. One shared library;
 * nearer project overrides keep precedence without copied skill folders. */
export async function resolveCapabilityLibrary(directory: string) {
  const skipped: SkippedSkill[] = [];
  const skills = await listSkills(directory, true, skipped);
  const nativeSkills = await Promise.all(skills.map(async skill => {
    const { data, body } = parseFrontmatter(await readFile(skill.path, "utf8"));
    const metadata = data.metadata && typeof data.metadata === "object" ? Object.fromEntries(Object.entries(data.metadata)) : {};
    const boolean = (value: unknown) => typeof value === "boolean" ? value : value === 1 || ["true", "yes", "on", "1"].includes(String(value).toLowerCase()) ? true
      : value === 0 || ["false", "no", "off", "0"].includes(String(value).toLowerCase()) ? false : undefined;
    const autoinvoke = boolean(metadata["opencode/autoinvoke"]) ?? (boolean(data["disable-model-invocation"]) ? false : undefined);
    return { id: skill.name, name: skill.name, description: skill.description, path: skill.path, content: body,
      ...(autoinvoke === undefined ? {} : { autoinvoke }) };
  }));
  return { skills, nativeSkills, skipped };
}
