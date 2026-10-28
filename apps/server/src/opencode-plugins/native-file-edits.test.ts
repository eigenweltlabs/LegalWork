import { afterEach, expect, test } from "bun:test";
import { nativeFileEdits } from "./native-file-edits.js";
const prior = process.env.LEGALWORK_UI_CONTROL_DISCOVERY;
afterEach(() => { if (prior === undefined) delete process.env.LEGALWORK_UI_CONTROL_DISCOVERY; else process.env.LEGALWORK_UI_CONTROL_DISCOVERY = prior; });

test("native writes hand off exact project files, then release once on failure or completion", async () => {
  process.env.LEGALWORK_UI_CONTROL_DISCOVERY = "/test/profile";
  const events: unknown[] = [];
  const edits = nativeFileEdits("/project", async (session, paths) => {
    events.push({ session, paths }); return async () => { events.push("reload"); };
  });
  await edits.before({ tool: "read", sessionID: "chat", callID: "read" }, { args: { filePath: "/project/report.md" } });
  await edits.before({ tool: "write", sessionID: "chat", callID: "external" }, { args: { filePath: "/other/report.md" } });
  expect(events).toEqual([]);
  await edits.before({ tool: "write", sessionID: "chat", callID: "write" }, { args: { filePath: "/project/report.md" } });
  await edits.event({ event: { type: "message.part.updated", properties: { part: { type: "tool", sessionID: "chat", callID: "write", state: { status: "error" } } } } });
  await edits.after("chat", "write");
  expect(events).toEqual([{ session: "chat", paths: ["report.md"] }, "reload"]);
});

test("headless native tools do not discover or mutate a different desktop profile", async () => {
  delete process.env.LEGALWORK_UI_CONTROL_DISCOVERY;
  const edits = nativeFileEdits("/project", async () => { throw new Error("wrong profile"); });
  await edits.before({ tool: "edit", sessionID: "chat", callID: "call" }, { args: { filePath: "/project/report.md" } });
});

test("Stop reaches a handoff still waiting in the before hook",async()=>{
  process.env.LEGALWORK_UI_CONTROL_DISCOVERY="/test/profile";
  const started=Promise.withResolvers<void>();let cancelled="";
  const edits=nativeFileEdits("/project",async(_session,_paths,_request,signal)=>{
    started.resolve();await new Promise((_,reject)=>signal?.addEventListener("abort",()=>reject(signal.reason),{once:true}));return async()=>{};
  },async session=>{cancelled=session;});
  const pending=edits.before({tool:"write",sessionID:"child",callID:"call"},{args:{filePath:"/project/report.docx"}});
  await started.promise;
  await edits.event({event:{type:"session.error",properties:{sessionID:"child",error:{name:"MessageAbortedError"}}}});
  await expect(pending).rejects.toThrow();expect(cancelled).toBe("child");
});
