# Personal Assistant

Open **Assistant** in the sidebar to coordinate work across your projects. On
first use, choose a name and appearance. Each calendar day has its own chat;
earlier conversations remain available in Assistant history.

Animated dots appear while the Assistant prepares a reply, including when a
model is thinking or using tools. Replies arrive as complete bubbles. The dots
disappear when the reply finishes, stops, or needs your answer or approval.

Ask the Assistant to find a project, check tasks or calendar entries, or delegate
work to a project chat. Delegated research and scheduled work run in separate
sessions and return their results to the Assistant. Permission requests remain
yours to answer; delegation does not grant additional project access.

## Relevant updates

The Assistant can send you a new message when something relevant changes, even
while you are not chatting. It keeps its own concise scratchpad of important
recent topics, things you asked to hear about, and specific developments it wants
to bring back to you. There is no list you need to create or maintain. Tell it
"let me know when Alex sends the signed agreement" or "stop updating me about
that matter" and it updates its scratchpad itself.

While LegalWork is running, it checks new or changed tasks, project calendar
entries, and newly received mail and calendar changes from activated Gmail,
Outlook, Google Calendar and Outlook Calendar accounts about every three minutes.
To connect an account, open **Add > Plugins**, select the connector and connect
it. Account-wide mail and calendar checks require **Settings > Assistant >
Project access > All projects**. Project checks follow the Assistant's project
access settings.

EU Jev scores every change collected in each interval for relevance to the
Assistant's scratchpad. Once the whole interval has been checked, the Assistant receives
results scoring at least 80% together and decides whether one short message would help
or whether to stay quiet. Without an explicit match, it is not interrupted. Active
conversations and outstanding questions or approvals take priority. These
updates do not authorize sending mail, starting work or changing your records.
The existing desktop notification preference applies to new Assistant messages.

Checks require a connected source and an available EU decision model. If a
source or model is unavailable, the check waits and retries. An empty scratchpad
means no event alerts. Closing LegalWork stops the local checks until it runs
again. Timed checks, such as revisiting a website in five hours, still use normal
[scheduled tasks](scheduled-tasks.md).

## Morning briefings

After a few useful exchanges, the Assistant may suggest a morning briefing if
you do not already have one. It proposes a time and days, then creates the
schedule only after you agree. A refusal is remembered, and deleting the
schedule does not cause another automatic offer. You can ask for one later.
Open its saved task card or **Scheduled tasks** to change, pause or delete it.
The briefing includes accessible recordings and transcripts, email, calendar
and tasks. The Assistant's scratchpad helps it prioritize topics without hiding
other important commitments.

## Settings

Open **Settings > Assistant** to change its appearance, add custom instructions, or choose Plugins, Workflows and Skills
it should know about. Selections supply descriptions and references; workers
load the resources when doing the work.

Under project access, choose all projects, no projects, only selected projects,
or all except selected projects. These restrictions also apply to delegated
and scheduled Assistant work. Use **AI Providers** to configure its models.
