// Import this check and pass a Playwright Page after opening
// /session-preview.html?lang=en&platform=windows on the local server.
// The fixture overlays the native caption-button area; only sample data is edited.
export default async function checkMarkdownFullscreen(page) {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1):\d+\/session-preview\.html\?/.test(await page.url())) {
    throw new Error("Open the local session preview before running this check.");
  }
  const file = page.getByRole("button", { name: "review-notes.md 4.7 KB", exact: true });
  if (!await file.isVisible()) await page.getByRole("button", { name: "Project Files", exact: true }).click();
  await file.click();
  const chat = page.getByRole("button", { name: "Close tab: New task", exact: true });
  if (await chat.isVisible()) await chat.click();
  await page.getByRole("button", { name: "Select tab: review-notes.md", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "editable markdown", exact: true });
  await editor.waitFor({ state: "visible" });
  await page.getByRole("switch", { name: "Autosave", exact: true }).uncheck();
  const original = await editor.innerText();
  const marker = " Full-screen regression check.";
  await editor.click();
  await editor.press("End");
  await editor.pressSequentially(marker);
  const draft = await editor.innerText();
  if (!draft.includes(marker)) throw new Error("The sample edit was not entered.");

  const expand = page.getByRole("button", { name: "Expand document", exact: true });
  const exit = page.getByRole("button", { name: "Exit fullscreen", exact: true });
  const assertRestored = async () => {
    await expand.waitFor({ state: "visible" });
    if (await page.locator('[data-artifact-expanded="true"]').count()) throw new Error("Document stayed expanded.");
    if (await editor.innerText() !== draft) throw new Error("Restoring discarded the unsaved edit.");
  };

  await expand.click();
  if (!await exit.isVisible()) throw new Error("Exit fullscreen is hidden on this platform.");
  if (!await exit.evaluate(button => {
    const box = button.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth && box.top >= 0
      && box.bottom <= innerHeight && button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
      && getComputedStyle(button).getPropertyValue("app-region") === "no-drag";
  })) throw new Error("Exit fullscreen is clipped, covered, or part of the native drag region.");
  if (!await page.getByRole("button", { name: "Restore document panel", exact: true }).evaluate(button => {
    const box = button.getBoundingClientRect();
    const caption = document.querySelector("[data-preview-caption-controls]")?.getBoundingClientRect();
    return !caption || box.top >= caption.bottom;
  })) throw new Error("Document toolbar overlaps the native caption controls.");
  await exit.click();
  await assertRestored();

  await expand.click();
  await editor.press("Escape");
  await assertRestored();

  await expand.click();
  await page.getByRole("button", { name: "Restore document panel", exact: true }).click();
  await assertRestored();
  // Input drivers may create one undo entry per character instead of one per word.
  for (let undo = 0; undo < marker.length && await editor.innerText() !== original; undo++) {
    await editor.press("ControlOrMeta+z");
  }
  if (await editor.innerText() !== original) throw new Error("The editor lost its undo history while changing full-screen state.");
  console.log("PASS: labeled exit, caption clearance, Escape, restore icon, unsaved draft and undo history.");
}
