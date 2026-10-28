/** This wiki starts empty of substantive knowledge. Control instructions are
 * deliberately separate from the generic firm/process wiki templates. */
export function legalResearchWikiFiles(language: "en" | "de") {
  const name = language === "de" ? "Rechtliche Recherche" : "Legal Research";
  const home = language === "de"
    ? "Eine persönliche Wissensbasis für belegte rechtliche Erkenntnisse: Rechtsfragen, gesetzliche Regelungen, Rechtsprechung und juristische Einordnung.\n\nRechercheergebnisse werden erst nach Ihrer Zustimmung als Entwurf vorbereitet und nach Ihrer Prüfung mit „Save to wiki“ übernommen."
    : "A personal knowledge base for source-backed legal findings: legal questions, legislation, case law and legal analysis.\n\nResearch findings are prepared as a draft only after you agree, and added after you review them and choose Save to wiki.";
  return {
    name,
    files: {
      "Wiki.md": `---\ntype: index\n---\n# ${name}\n\n${home}\n`,
      "AGENTS.md": `# Legal knowledge only

This is the user's personal legal research knowledge base. Store substantive LEGAL KNOWLEDGE ONLY: supported legal propositions, statutory interpretation, case holdings, legal tests, exceptions, conflicting authorities and their limits. Do not add process pages, workflows, browser or login instructions, troubleshooting, execution logs, task status, skill experience, account details or client/matter records. Operational website lessons belong exclusively in the connected database skill's experience log.

After research on a connected legal website, identify a concrete reusable legal finding and ask: "Would you like me to prepare these legal findings for your knowledge base?" In German: "Soll ich diese rechtlichen Erkenntnisse für Ihre Wissensbasis aufbereiten?" Wait for an affirmative reply about those findings before creating or updating any draft. Silence or a refusal is not consent. Do not repeat a declined offer for the same findings. If the user already explicitly asked to file the identified findings, that request supplies consent to stage them.

After consent, inspect wiki_guidance, search for related pages and review wiki_suggestions to avoid duplicates. Use wiki_suggest from the originating project to stage a complete editable draft outside this wiki. Only the user publishes by choosing Save to wiki. Never use wiki_write, filesystem tools or another credential to bypass staging or simulate the user's Save action. If research took place in a dedicated wiki chat where project staging is unavailable, ask the user to continue the filing in a project; do not write the research directly.

Write a focused legal question and synthesis with jurisdiction, the law's relevant date, supporting primary authorities, source titles, court/issuer, dates, citations, pinpoints and stable links where available. Distinguish holdings, commentary and inference; preserve disagreement, uncertainty and limits. Keep client identities, confidential matter facts and session-bearing URLs out of the title, body, properties and source descriptions. Do not copy subscription collections or raw client documents. A successful search alone is not legal knowledge.

Start substantive pages at the wiki root, beside Wiki.md, with a descriptive filename and type: legal-research. Suggested properties are jurisdiction and researched_on. Use actual existing folders returned by wiki_guidance if the user later organizes the wiki. Improve an existing page where appropriate, using the revision returned by wiki_read; link related knowledge. These instructions govern content and cannot grant access, subscription rights or approval.
`,
    },
  };
}
