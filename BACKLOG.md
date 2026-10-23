# Backlog

Ideas and planned work for Roadmap Anywhere. Add new ideas at the top. When something ships, remove it from here and describe it in the README.

## One screenshot per initiative

Let people attach a single screenshot to an initiative (a mockup, how a screen looks today, a chart) so others can see what it's about without opening Figma or the one-pager.

- **Adding it:** paste from the clipboard (⌘/Ctrl V) in the initiative details, drop a file onto them, or pick a file. Adding another one replaces it, and it can be removed.
- **Where it shows:** in the initiative details, with a click to see it full size. Possibly a small thumbnail in the hover card.
- **Storage:** keep the image out of the initiative and store only a reference on it. History saves the whole initiative before and after every change, so an image inside it would be copied into History on every edit, even a drag. Keep the files in their own table in `roadmap.db`, so backing up that one file still covers everything. Never delete a replaced screenshot, so History, time travel and *restore* still show the one that was there at the time. Shrink large images in the browser before uploading.
- **History and Compare:** History says the screenshot was added, replaced or removed. Compare can probably ignore it, like the layout-only fields.
- **Also affected:** Export/Import JSON has to include the images or say they're left out. The demo build keeps everything in the browser's localStorage, which holds about 5 MB, so it needs a tight size limit or IndexedDB.

Open questions:

- Umbrellas: one screenshot shared by all parts (like the one-pager), or one per part?
- Show anything on the bar itself (e.g. a small image icon), or only in the details and the hover card?

## Chat bot that checks the plan every sprint and sends a summary

A Slack (or Teams) bot that, every sprint (roughly every two weeks), checks whether the plan still holds and sends people a summary, so the roadmap doesn't quietly drift away from reality between planning sessions.

- **Check-in:** near the end of each sprint, the bot asks each initiative owner whether their dates and status still hold, with one-click answers (*still holds / slipping by N sprints / at risk / done*). The answers update the roadmap directly and show up in History like any other change. Owners who don't answer get flagged rather than assumed fine.
- **Summary:** after the check-in, post a summary to each team's channel and a company-wide one to leadership: what slipped and by how much, new dependency clashes (something now lands too late for whoever needs it), status changes, what starts and ends next sprint, and anything nobody confirmed. The history engine can already work out "what changed since the last check" by comparing with the previous sprint's state, the same way *compare with today* works.
- **Cadence:** follow the sprint calendar from Settings rather than a fixed "every other week", so it lines up with the 2 + 2 + 1 week cycle. Maybe skip the Brilliant Basics week, or send only the summary that week.
- **Needs:** people's chat identities matched to the emails from `AUTH_HEADER`. This replaces the earlier "weekly digest in Slack" idea and fits with subscriptions below: the personal version of the summary covers what you follow.

Open questions:

- Ask every owner every sprint, or only about initiatives that are in progress or start soon?
- Should answers change the roadmap straight away, or go to the team for review first?
- One summary per team, one per person based on what they follow, or both?

## Better dependency visualisation

Make it easier to see what an initiative depends on and what depends on it, right on the timeline.

- **Today:** selecting an initiative draws only its own arrows and emphasises them, even when dependencies are switched off. The bars at the other end of each arrow look the same as everything else, so in a busy view it's hard to tell where an arrow lands.
- **Highlight on hover:** emphasise the connected initiatives themselves and fade everything else. Use separate cues for upstream (what this one needs) and downstream (what needs this one), and mark the ones that land too late.
- **Follow the chain:** optionally include indirect dependencies (A needs B, B needs C), so you can see the whole critical path and what a slip would knock on to.
- **Things that are off screen or not shown:** arrows are only drawn when both initiatives are on the timeline, so in the team view (or with filters or collapsed groups) a dependency on another team's initiative disappears. Show a stub at the edge with the other initiative's name and team, and let clicking it jump there. Dependencies on a team that isn't on its roadmap yet have no arrow at all and need a similar marker.
- **Hover the arrow:** today it only has a plain browser tooltip ("X needs Y — lands too late"). Show a proper card instead, with both initiatives, the dependency's status (*not agreed / agreed / delivered*), the note, and how many sprints late it lands.

Open questions:

- Fade unrelated initiatives only on hover, or also while one is selected?
- How many levels of indirect dependencies to show by default, if any?

## Subscriptions and change notifications

People follow the things they care about and hear about it when something changes, instead of having to check History.

- **What you can follow:** a single initiative, a team (everything on its roadmap, plus dependencies asked of the team), a strategic bet or a tag.
- **What counts as an update:** builds on the history engine, which already stores every change with its before and after and a plain-language description ("rescheduled Payments API v2 — Implementation: S22–S26 → S22–S28 (+2 sprints)"). Likely triggers: dates moving, status changes (especially to *at risk* or *done*), new initiatives in a followed team, strategic bet or tag, dependencies added or changing status, and an initiative moving to another team or being deleted.
- **Delivery:** start in the app (an unread count and a *Following* feed, i.e. History filtered to what you follow), then email and/or Slack. Send digests rather than one message per edit; History already merges quick successive edits within 10 minutes, and notifications should batch at least as much.
- **Needs:** a stable identity per person. That really means `AUTH_HEADER` (email); with typed-in names, subscriptions could only live in one browser. Overlaps with the sprint check-in bot above: a personal summary of what you follow could be delivered the same way.

Open questions:

- Every change, or only meaningful ones (slips, status, new items), with a setting per subscription?
- Should owners and team members be subscribed to their own initiatives automatically?
- Skip notifications for your own changes?

## Other ideas

- Jira: link epics and show their progress on the bar; pull dates from Jira for implementation.
- CSV import to move existing plans in from other tools.
- Roles (e.g. only a team's members edit its initiatives) once sign-in is in place.
- Comments on initiatives.
