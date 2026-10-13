import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { runInNewContext } from "node:vm";
import { APPLE_MAIL_DRAFT_SCRIPT, OUTLOOK_DRAFT_SCRIPT, composeAppleMailDraft, composeOutlookDraft } from "./mail-draft.mjs";

const draft = {
  subject: 'Review "quoted" text', body: 'Grüße\n\nLiteral text: "); mail.send(message); //', from: "",
  to: ["review@example.com"], cc: ["cc@example.com"], bcc: ["bcc@example.com"],
  attachments: [{ name: "notes.txt", data: new Uint8Array([0, 10, 255]) }],
};

for (const { name, compose } of [{ name: "Apple Mail", compose: composeAppleMailDraft }, { name: "Outlook", compose: composeOutlookDraft }]) {
test(`${name} handoff preserves fields and duplicate filenames in private copies, then removes them`, async () => {
  let files = [];
  await compose({ ...draft, attachments: [...draft.attachments, ...draft.attachments] }, {
    platform: "darwin",
    runScript: async raw => {
      const input = JSON.parse(raw);
      assert.equal(input.subject, draft.subject);
      assert.equal(input.body, draft.body);
      assert.deepEqual([input.to, input.cc, input.bcc], [draft.to, draft.cc, draft.bcc]);
      files = input.attachments;
      assert.notEqual(files[0], files[1]);
      for (const file of files) {
        assert.deepEqual(new Uint8Array(await readFile(file)), draft.attachments[0].data);
        assert.equal((await stat(file)).mode & 0o777, 0o600);
        assert.equal((await stat(dirname(file))).mode & 0o777, 0o700);
      }
    },
  });
  for (const file of files) await assert.rejects(stat(file), { code: "ENOENT" });
});

test(`${name} failed handoffs clean up private attachment copies`, async () => {
  let file;
  await assert.rejects(compose(draft, { platform: "darwin", runScript: async raw => {
    file = JSON.parse(raw).attachments[0];
    throw new Error("Permission denied");
  } }), /Permission denied/);
  await assert.rejects(stat(file), { code: "ENOENT" });
});

test(`${name} rejects path escapes, header injection, oversized payloads and unsupported platforms before launch`, async () => {
  const options = { platform: "darwin", runScript: async () => assert.fail("must not launch Mail") };
  for (const name of ["../secret", "/secret", "..", "bad\\name", "bad\0name"]) {
    await assert.rejects(compose({ ...draft, attachments: [{ ...draft.attachments[0], name }] }, options));
  }
  await assert.rejects(compose({ ...draft, subject: "Subject\nBcc: injected@example.com" }, options));
  await assert.rejects(compose({ ...draft, attachments: [{ name: "large", data: new Uint8Array(20 * 1024 * 1024 + 1) }] }, options), /20 MB/);
  await assert.rejects(compose(draft, { ...options, platform: "linux" }), /macOS only/);
});

}

test("the fixed Mail program saves a visible compose draft and treats message content only as data", () => {
  const message = { toRecipients: [], ccRecipients: [], bccRecipients: [], content: { attachments: [] }, visible: false };
  let saved = false, activated = false;
  const payload = { ...draft, attachments: ["/private/tmp/notes.txt"] };
  const mail = {
    OutgoingMessage: fields => { assert.equal(fields.visible, true); assert.equal(fields.content, draft.body); assert.equal(fields.subject, draft.subject); return message; },
    outgoingMessages: [], ToRecipient: value => value, CcRecipient: value => value, BccRecipient: value => value, Attachment: value => value,
    save: value => { assert.equal(value, message); saved = true; message.visible = false; },
    activate: () => { activated = true; },
    send: () => assert.fail("must never send"),
  };
  runInNewContext(APPLE_MAIL_DRAFT_SCRIPT + "\nrun();", {
    ObjC: { import() {}, unwrap: value => value },
    $: { NSFileHandle: { fileHandleWithStandardInput: { readDataToEndOfFile: JSON.stringify(payload) } }, NSString: { alloc: { initWithDataEncoding: value => value } } },
    Application: id => { assert.equal(id, "com.apple.mail"); return mail; }, Path: value => value,
  });
  assert.equal(saved, true); assert.equal(activated, true); assert.equal(message.visible, true);
  assert.equal(message.toRecipients[0].address, draft.to[0]);
  assert.equal(message.ccRecipients[0].address, draft.cc[0]);
  assert.equal(message.bccRecipients[0].address, draft.bcc[0]);
  assert.equal(message.content.attachments[0].fileName, payload.attachments[0]);
});


test("Outlook creates an editable persisted draft with recipients and attachments, never sending", () => {
  const message = { toRecipients: [], ccRecipients: [], bccRecipients: [], attachments: [], sender: null, make() { calls.push("make"); return this; } };
  const calls = [];
  const payload = { ...draft, from: "sender@example.com", applicationPath: "/Applications/Microsoft Outlook.app", attachments: ["/private/tmp/notes.txt"] };
  const outlook = {
    OutgoingMessage: fields => { assert.equal(fields.plainTextContent, draft.body); assert.equal(fields.subject, draft.subject); return message; },
    outgoingMessages: [], ToRecipient: value => value, CcRecipient: value => value, BccRecipient: value => value, Attachment: value => value,
    save: value => { assert.equal(value, message); calls.push("save"); },
    open: value => { assert.equal(value, message); calls.push("open"); },
    activate: () => calls.push("activate"),
    send: () => assert.fail("must never send"),
  };
  const context = {
    ObjC: { import() {}, unwrap: value => value },
    $: { NSFileHandle: { fileHandleWithStandardInput: { readDataToEndOfFile: JSON.stringify(payload) } }, NSString: { alloc: { initWithDataEncoding: value => value } } },
    Application: id => { assert.equal(id, payload.applicationPath); return outlook; }, Path: value => value,
  };
  runInNewContext(OUTLOOK_DRAFT_SCRIPT + "\nrun();", context);
  assert.deepEqual(calls, ["make", "open", "activate"]);
  assert.equal(message.sender, null); // Outlook selects its own sending account.
  assert.equal(message.toRecipients[0].emailAddress.address, draft.to[0]);
  assert.equal(message.ccRecipients[0].emailAddress.address, draft.cc[0]);
  assert.equal(message.bccRecipients[0].emailAddress.address, draft.bcc[0]);
  assert.equal(message.attachments[0].file, payload.attachments[0]);

  // Do not report a successful handoff if Outlook silently ignores an attachment.
  calls.length = 0;
  message.attachments.length = 0;
  message.attachments.push = () => 0;
  assert.throws(() => runInNewContext(OUTLOOK_DRAFT_SCRIPT + "\nrun();", context), /did not import every attachment/);
  assert.deepEqual(calls, ["make"]);
});
