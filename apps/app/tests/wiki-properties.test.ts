import { describe, expect, test } from "bun:test";
import { setWikiProperty, wikiPropertyFields } from "../src/react-app/domains/wiki/wiki-properties";

describe("wiki properties keep Markdown as the source of truth", () => {
  test("edits only a scalar range and preserves comments, Unicode, CRLF, and unknown mappings", () => {
    const source = '\uFEFF---\r\n# Firm metadata\r\n"stage": draft # retain\r\nactive: false\r\namount: 0\r\nunknown:\r\n  nested: [a, b]\r\n...\r\n\r\n# Über uns\r\n[[Client]]\r\n';
    const changed = setWikiProperty(source, "stage", "signed");
    expect(changed).toBe(source.replace("draft # retain", '"signed" # retain'));
    const fields = wikiPropertyFields(changed).fields;
    expect(fields.find(field => field.key === "active")?.value).toBe(false);
    expect(fields.find(field => field.key === "amount")?.value).toBe(0);
    expect(fields.find(field => field.key === "unknown")?.editable).toBe(false);
  });

  test("preserves types through zero, false, dates, nulls, quotes and page references", () => {
    let source = "# Body\n";
    for (const [key, value] of Object.entries({ amount: 0, active: false, date: "2026-10-11", empty: null, client: "[[Clients/A.md]]", quote: 'a: # "b"' })) source = setWikiProperty(source, key, value);
    expect(Object.fromEntries(wikiPropertyFields(source).fields.map(field => [field.key, field.value]))).toEqual({ amount: 0, active: false, date: "2026-10-11", empty: null, client: "[[Clients/A.md]]", quote: 'a: # "b"' });
    expect(source).toEndWith("# Body\n");
    expect(setWikiProperty("---\nempty:\n---\nBody", "empty", "x")).toContain('empty: "x"');
  });

  test("refuses malformed, duplicate, complex, anchored and tagged values without rewriting source", () => {
    for (const yaml of ["stage: [a,b]", "stage: &shared draft\ncopy: *shared", "stage: !!str draft", "stage: |\n  draft", "stage: draft\nstage: signed", "[a,b]", "stage: ["]) {
      expect(() => setWikiProperty(`---\n${yaml}\n---\nBody`, "stage", "signed")).toThrow();
    }
    expect(() => setWikiProperty("---\nmissing: end", "stage", "signed")).toThrow();
    expect(() => setWikiProperty("Body", "amount", NaN)).toThrow();
  });

  test("adding a field keeps existing source untouched and escaped keys remain valid", () => {
    const source = "---\n# Comment\nactive: false\n---\nBody";
    expect(setWikiProperty(source, "Follow up", "tomorrow")).toBe(source.replace("active: false\n", 'active: false\n"Follow up": "tomorrow"\n'));
    expect(wikiPropertyFields(setWikiProperty("Body", "With:colon", "yes")).fields[0].key).toBe("With:colon");
  });
});
