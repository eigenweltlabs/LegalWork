import { expect, test } from "bun:test";
import { createParser, createStreamingParser } from "@openuidev/react-lang";
import { renderToStaticMarkup } from "react-dom/server";
import { OPENUI_CATALOG } from "./catalog";
import { OpenUIView, openUILibrary } from "./runtime";

test("the agent catalog example parses with the exact runtime component schemas", () => {
  const parsed = createParser(openUILibrary.toJSONSchema()).parse(OPENUI_CATALOG.example);
  expect(parsed.meta.errors).toEqual([]);
  expect(parsed.meta.incomplete).toBe(false);
  expect(parsed.root?.typeName).toBe("Stack");
  expect(parsed.queryStatements).toHaveLength(1);
  expect(parsed.mutationStatements).toEqual([]);
});
test("streaming surfaces an unfinished string, then completes without losing its prefix", () => {
  const parser = createStreamingParser(openUILibrary.toJSONSchema());
  const partial = parser.push('root = Text("Client');
  expect(partial.root?.props.text).toBe("Client");
  expect(partial.meta.incomplete).toBe(true);
  const complete = parser.push(' engagements")');
  expect(complete.root?.props.text).toBe("Client engagements");
  expect(complete.meta.errors).toEqual([]);
  expect(complete.meta.incomplete).toBe(false);
});
test("bundled stock components render a report without a provider or network", () => {
  const html = renderToStaticMarkup(<OpenUIView program={'root = Stack([Heading("Portfolio",1), Metric("Clients",12), Card("Status", [Badge("Active","success"), Table([{title:"Aster",stage:"Diligence"}],[{field:"title",label:"Client"},{field:"stage",label:"Stage"}]), Board([{title:"Aster",stage:"Diligence"}],"stage","title")])])'} />);
  expect(html).toContain("Portfolio");
  expect(html).toContain("Aster");
  expect(html).toContain("Diligence");
  expect(html).not.toContain("<iframe");
  expect(html).not.toContain("cdn.jsdelivr");
});
