import type { ViewInput, ViewOwner } from "@legalwork/types/views";

export const sameViewOwner = (a: ViewOwner, b: ViewOwner) => a.kind === b.kind && a.id === b.id;
export const viewOwnerKey = (owner: ViewOwner) => `${owner.kind}:${owner.id}`;

/** Copies keep the reviewed data and original source links, never rebind queries to another wiki. */
export function viewInputForDestination(input: ViewInput, source: ViewOwner, destination: ViewOwner): ViewInput {
  if (sameViewOwner(source, destination)) return input;
  if (Object.keys(input.queries).some(name => !input.datasets?.[name])) throw new Error("Refresh the preview before copying this dashboard.");
  return { ...input, queries: {}, datasets: Object.fromEntries(Object.entries(input.datasets ?? {}).map(([name, data]) => [name, { ...data, sourceOwner: data.sourceOwner ?? source }])) };
}

export function viewInput(record: ViewInput): ViewInput {
  const { version, title, mode, catalog, program, queries, datasets, fallbackMarkdown } = record;
  return { version, title, mode, catalog, program, queries, datasets, fallbackMarkdown };
}
