# Personal Assistant

Open **Assistant** in the sidebar to coordinate work across your projects. On
first use, choose a name and appearance. Each calendar day has its own chat;
earlier conversations remain available in Assistant history.

The Assistant receives your name, email address and organization from your
signed-in LegalWork account when available. It updates this context when you
switch accounts or sign out. Your account profile is separate from the name
and appearance you choose for the Assistant.

To show or hide the Assistant entry, open **Customize navigation** using the
gear at the top of the sidebar. Under **Chat sidebar**, toggle **Your assistant**
below **New Chat**, then choose **Done**. This only changes sidebar visibility.
To change its name or avatar, click the assistant at the top of its conversation, or open
**Settings > Assistant**.

The Assistant uses one conversation tab. Subagents work in the background until
you open the small subagent toggle at the top of the chat and choose one. Their
tabs keep their own titles and close when the run finishes. You can reopen a
completed subagent from the same list to inspect its result. Opening another day
reuses the Assistant tab without replacing an open subagent.

Your message appears in the chat as soon as you press **Send**, including while
attachments are uploading. Delivery continues in the background. If sending
fails, your draft stays available and the chat shows the delivery error.

Use the microphone button beside **Send** to dictate a message. Stop dictation
to review the text, or use its **Send** button to send it directly.

Hover over a message to see its time and copy button, or edit your own message.
These controls appear below the message without shifting the conversation.
You can also reach them with the keyboard.

Animated dots appear only while the Assistant writes a message to you. They stay
off during thinking, tool calls and waiting for delegated work. Each reply
arrives as a complete bubble, and the dots disappear as soon as that text is
finished, even if background work continues. They also stop when a run is
stopped or needs your answer or approval.

The Assistant uses emoji reactions on the left edge of your bubble for brief
acknowledgements, especially confirmations, answers to its questions and retries.
For example, a reaction to “yes” replaces a separate “I’ll do that” message,
including when work is delegated. Its next message carries the result or a
necessary question. Reactions mean receipt, not approval or completion, and
only appear before it replies or starts work.

The Assistant remembers details you provide, such as your phone number, contact
email and booking preferences, in `.legalwork/user-details.md` inside its own
project folder. It checks these notes before asking again and can reuse relevant
details across days and app restarts. Tell it when a detail changes, to forget it,
or to use something only once. It passes only the details needed for the requested
work to a worker. These notes are separate from its follow-up conditions.

Ask the Assistant to find a project, check tasks or calendar entries, or delegate
work to a project chat. Delegated research and scheduled work run in separate
sessions and return their results to the Assistant. Permission requests remain
yours to answer; delegation does not grant additional project access.

Once a final result returns, the Assistant stops watching that delegated chat
and its subagents. Continuing an unrelated conversation there will not send
updates back to the Assistant. Ask the Assistant for a follow-up to start a new
round of delegated work. Pending questions and approvals keep the current round
open until the work returns a final result.

## Browser work

The Assistant delegates all browser work, including short website tasks, to a
browser worker. This keeps the conversation available while the worker uses a
separate model. The default is **GPT-6.1 Terra**, independent of the model you
choose for the Assistant. Connected variants such as **GPT-6.1 Terra (EU)** and
**GPT-6.1 Terra Fast** are recognized automatically; no separate selection is
needed. If Terra is unavailable, browsing waits for you to connect
it or select another browser model. It never silently uses the Assistant's model.

Click the Assistant at the top of the chat, expand **Advanced**, and choose
**Browser model**. You can also change it under **Settings > Assistant**. Changes
save automatically.

The worker's browser appears as a small preview tile in the main Assistant chat,
including when the worker started in an earlier daily chat. Its own chat stays
closed unless you open it. Workers do not send desktop notifications; only the
Assistant's replies to you can notify you.
Click the tile to open that actual browser beside the
conversation. The preview disappears when its worker finishes or stops; a browser
you opened yourself stays open. Tiles remain while a worker is waiting for your
answer or approval. Background browsing does not switch your screen. Existing website
permissions and approval requirements still apply.

## Relevant updates

The Assistant can send you a new message when something relevant changes, even
while you are not chatting. It keeps its own concise scratchpad of important
recent topics, things you asked to hear about, and specific developments it wants
to bring back to you. There is no list you need to create or maintain. Tell it
"let me know when Alex sends the signed agreement" or "stop updating me about
that matter" and it updates its scratchpad itself. When you say you are waiting
for an email and ask to be told, it checks now and keeps an eye out if it has not
arrived. You do not need to repeat the request or configure an alert.

You can also ask for work when a condition occurs, for example: "When a new
client intake request arrives, create a project and use my intake workflow."
The Assistant records the condition itself and uses the existing email checks,
without creating a separate recurring inbox task. It uses the installed skill's
configured templates. Details about the future client are resolved when the
request arrives, rather than blocking setup.

While LegalWork is running, it checks new or changed tasks, project calendar
entries, and newly received mail and calendar changes from activated Gmail,
Outlook, Google Calendar and Outlook Calendar accounts about every three minutes.
To connect an account, open **Add > Plugins**, select the connector and connect
it. Account-wide mail and calendar checks require **Settings > Assistant >
Project access > All projects**. Project checks follow the Assistant's project
access settings.

EU Jev scores every change collected in each interval for relevance to the
Assistant's scratchpad. Once the whole interval has been checked, the Assistant receives
results scoring at least 65% together and decides whether one short message would help
or whether to stay quiet. Without an explicit match, it is not interrupted. Active
conversations and outstanding questions or approvals take priority. These
updates do not authorize additional work by themselves. If you explicitly asked
for work when a condition occurs, the Assistant can carry out that scope with
its usual tools and permissions, including delegating a skill to the appropriate
project. For a new matter, it starts a new project chat and brings you the result
when that work is ready. It stays quiet while the work runs, unless it needs your
answer or approval or encounters a blocker. It checks for existing work to avoid
duplicates. Actual approvals remain required; an email cannot grant permission. Recurring conditions stay
active until you cancel them, and the Assistant removes fulfilled one-time
conditions.
The existing desktop notification preference applies to new Assistant messages.

Checks require a connected source and an available EU decision model. If a
source or model is unavailable, the check waits and retries. An empty scratchpad
means there are no follow-ups being checked. Closing LegalWork stops the local
checks until it runs again. Saved follow-ups resume after restarting, including
in the next day's Assistant chat, with the access available when you requested
them. Later access restrictions still apply. Follow-ups saved by older versions
without that access record need you to confirm the request once in the Assistant;
the app keeps undelivered events queued until then. Timed checks, such as revisiting a website in five
hours, still use normal
[scheduled tasks](scheduled-tasks.md).

## Briefings and visual reports

Ask for a morning briefing, matter overview or dashboard. The Assistant can deliver a dated report, a dashboard, or a Markdown document with an embedded chart. It chooses a document when the result benefits from more space than a chat reply.

After a few useful exchanges, the Assistant may suggest a morning briefing if
you do not already have one. It proposes a time and days, then creates the
schedule only after you agree. A refusal is remembered, and deleting the
schedule does not cause another automatic offer. You can ask for one later.
Open its saved task card or **Scheduled tasks** to change, pause or delete it.
The briefing includes accessible recordings and transcripts, email, calendar
and tasks. The Assistant's scratchpad helps it prioritize topics without hiding
other important commitments.

A morning briefing can combine an overview of actions by matter, priority emails with links to their original messages, and a checklist grouped by matter. Email requires an authorized connected account. The Assistant uses recorded owners and dates, preserves checked items and your notes on updates, and avoids repeating existing tasks. A daily briefing is a snapshot of the information checked when it was prepared.

Select the document card, or **Open** on it, to open a tab beside the conversation. Preparing or sharing a report does not open a tab automatically. Markdown briefings remain editable and follow the editor's autosave setting. Embedded charts have an **Open in tab** button for a larger view. The report toolbar shows whether the data is a snapshot or a live dashboard and offers refresh, export and save-copy controls.

Shared document cards remain available when you reopen the conversation,
including documents shared while the Assistant was doing several actions
together. A card for a project deliverable opens that project's original file.

Scheduled morning briefings use the same layout and share one primary document card. An unchanged built-in briefing schedule receives the new instructions automatically; custom schedule instructions are preserved. To use the layout in a custom schedule, ask it to prepare a visual morning briefing with an embedded matter chart and linked priority emails and tasks.

Related: [Dashboards and reports](dashboards.md), [Files](files-documents.md), [Scheduled tasks](scheduled-tasks.md).

## Settings

Open **Settings > Assistant** to change its appearance, add custom instructions, or choose Plugins, Workflows and Skills
it should know about. Selections supply descriptions and references; workers
load the resources when doing the work.

Under project access, choose all projects, no projects, only selected projects,
or all except selected projects. These restrictions also apply to delegated
and scheduled Assistant work. Use **AI Providers** to configure its models.
