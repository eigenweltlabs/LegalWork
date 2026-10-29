export type ConnectorCategory = "popular" | "communication" | "files" | "legal" | "practice" | "productivity";
export const connectorCategories: ConnectorCategory[] = ["popular", "communication", "files", "legal", "practice", "productivity"];

/** Categories describe the user's work, independent of the connection mechanism. */
export function connectorCategory(id: string, name: string): Exclude<ConnectorCategory, "popular"> {
  const value = `${id} ${name}`.toLowerCase();
  if (/gmail|outlook|calendar|slack|teams|mail|whatsapp|zoom/.test(value)) return "communication";
  if (/drive|sharepoint|dropbox|storage|datasite|imanage|netdocuments|file-system/.test(value)) return "files";
  if (/beck|juris|westlaw|lexis|legal.?data|midpage|descrybe|court|patent|vlex|vaquill/.test(value)) return "legal";
  if (/actaport|system.?one|clio|lawve|counsel|practice|ra-micro|advoware/.test(value)) return "practice";
  return "productivity";
}

export function popularConnector(id: string) {
  return ["gmail", "outlook", "google-drive", "google-calendar", "onedrive", "sharepoint-files", "beck-online", "juris"].includes(id);
}
