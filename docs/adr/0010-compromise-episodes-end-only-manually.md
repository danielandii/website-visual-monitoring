# Compromise Episodes end only when an Admin marks them cleaned

Unlike a Failure Episode, which ends automatically on Recovery, a Compromise Episode stays open, and the Monitored URL stays shown as Hacked, until an Admin marks it cleaned. Injected content is often intermittent (served on some visits, at some hours, or to some visitors), so a clean check proves nothing, and auto-closing would make the URL flap between Clean and Hacked and re-send Alerts. Cleaning a compromised site is a human action that deserves a human confirmation; wrongly closing an episode is worse than closing it late.

## Consequences

- The first-seen evidence, first-seen time, and last-seen time are kept for the open episode, so an Admin can see why the URL is Hacked even after later checks come back clean.
- If Compromise Evidence is seen again after an Admin closes the episode, a new episode opens and a new Alert is sent.
