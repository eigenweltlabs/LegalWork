import { execFile } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

const header = z.string().max(2000).refine(value => !/[\r\n\0]/.test(value));
const draftSchema = z.object({
  subject: header, body: z.string().max(500000), from: header,
  to: z.array(header).max(2000), cc: z.array(header).max(2000), bcc: z.array(header).max(2000),
  attachments: z.array(z.object({
    name: z.string().min(1).max(255).refine(value => !/[\\/\r\n\0]/.test(value) && value !== "." && value !== ".."),
    data: z.instanceof(Uint8Array),
  })).max(20),
});

// A fixed program, with all user content delivered as JSON on stdin. Never
// interpolate a subject, address, body or filename into executable source.
export const APPLE_MAIL_DRAFT_SCRIPT = `
ObjC.import("Foundation");
function run() {
  var data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  var input = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding)));
  var mail = Application("com.apple.mail");
  var message = mail.OutgoingMessage({ subject: input.subject, content: input.body, visible: true });
  mail.outgoingMessages.push(message);
  if (input.from) message.sender = input.from;
  input.to.forEach(function(address) { message.toRecipients.push(mail.ToRecipient({ address: address })); });
  input.cc.forEach(function(address) { message.ccRecipients.push(mail.CcRecipient({ address: address })); });
  input.bcc.forEach(function(address) { message.bccRecipients.push(mail.BccRecipient({ address: address })); });
  input.attachments.forEach(function(file) {
    message.content.attachments.push(mail.Attachment({ fileName: Path(file) }));
  });
  mail.save(message);
  message.visible = true;
  mail.activate();
}`;

// Outlook templates can silently omit attachments in modern Outlook for Mac.
// Create an outgoing message and attach each private file explicitly instead.
export const OUTLOOK_DRAFT_SCRIPT = `
ObjC.import("Foundation");
function run() {
  var data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  var input = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding)));
  var mail = Application(input.applicationPath);
  var message = mail.OutgoingMessage({ subject: input.subject, plainTextContent: input.body });
  message = message.make();
  // Modern Outlook uses its selected account; its sender setter is ignored.
  input.to.forEach(function(address) { message.toRecipients.push(mail.ToRecipient({ emailAddress: { address: address } })); });
  input.cc.forEach(function(address) { message.ccRecipients.push(mail.CcRecipient({ emailAddress: { address: address } })); });
  input.bcc.forEach(function(address) { message.bccRecipients.push(mail.BccRecipient({ emailAddress: { address: address } })); });
  input.attachments.forEach(function(file) { message.attachments.push(mail.Attachment({ file: Path(file) })); });
  if (message.attachments.length !== input.attachments.length) throw new Error("Outlook did not import every attachment.");
  // Outlook persists outgoing messages itself; its save command exports a file.
  mail.open(message);
  mail.activate();
}`;

/** @param {string} input
 * @param {string} script
 * @param {string} appName
 * @param {string} automationName
 */
function runMailScript(input, script, appName, automationName) {
  return new Promise((resolve, reject) => {
    const child = execFile("/usr/bin/osascript", ["-l", "JavaScript", "-e", script],
      { timeout: 120000, maxBuffer: 64000 }, (error) => {
        if (!error) { resolve(undefined); return; }
        if (error.message.includes("-1743")) {
          reject(new Error(`Allow LegalWork to control ${automationName} in System Settings > Privacy & Security > Automation, then try again.`));
        } else {
          reject(new Error(`${appName} could not finish opening the draft. Check ${appName} for a partially created draft before trying again.`));
        }
      });
    child.stdin.on("error", () => {}); // execFile's callback reports an early process exit.
    child.stdin.end(input);
  });
}

/** @param {string} input */
async function runOutlookScript(input) {
  // Prefer the installed application over backups registered with Launch Services.
  for (const applicationPath of ["/Applications/Microsoft Outlook.app", path.join(homedir(), "Applications/Microsoft Outlook.app")]) {
    try { await access(applicationPath); } catch { continue; }
    return runMailScript(JSON.stringify({ ...JSON.parse(input), applicationPath }), OUTLOOK_DRAFT_SCRIPT, "Outlook", "Microsoft Outlook");
  }
  throw new Error("Install Microsoft Outlook in Applications, or use Outlook web from the draft menu.");
}

/** @typedef {{ platform?: string, runScript?: (input: string) => Promise<unknown> }} MailDraftOptions */

/** @param {unknown} input @param {MailDraftOptions} [options] */
export async function composeAppleMailDraft(input, options = {}) {
  return composeNativeMailDraft(input, "Apple Mail", {
    ...options, runScript: options.runScript ?? (value => runMailScript(value, APPLE_MAIL_DRAFT_SCRIPT, "Apple Mail", "Mail")),
  });
}

/** @param {unknown} input @param {MailDraftOptions} [options] */
export async function composeOutlookDraft(input, options = {}) {
  return composeNativeMailDraft(input, "Outlook", { ...options, runScript: options.runScript ?? runOutlookScript });
}

/** Stages attachments until the mail application saves its own draft. Never sends mail.
 * @param {unknown} input
 * @param {string} appName
 * @param {{ platform?: string, runScript: (input: string) => Promise<unknown> }} options
 */
async function composeNativeMailDraft(input, appName, { platform = process.platform, runScript }) {
  if (platform !== "darwin") throw new Error(`${appName} drafts are available on macOS only.`);
  const draft = draftSchema.parse(input);
  if (draft.attachments.reduce((size, item) => size + item.data.byteLength, 0) > 20 * 1024 * 1024) {
    throw new Error("Attachments must total 20 MB or less.");
  }
  const folder = await mkdtemp(path.join(tmpdir(), "legalwork-mail-"));
  try {
    await chmod(folder, 0o700);
    const attachments = [];
    for (const [index, item] of draft.attachments.entries()) {
      const directory = path.join(folder, String(index));
      await mkdir(directory, { mode: 0o700 });
      const target = path.join(directory, item.name);
      await writeFile(target, item.data, { mode: 0o600 });
      attachments.push(target);
    }
    // Mail imports these private copies before saving its own draft.
    await runScript(JSON.stringify({ ...draft, attachments }));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
