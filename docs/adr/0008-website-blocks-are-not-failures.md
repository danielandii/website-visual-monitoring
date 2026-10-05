# Treat Website Blocks as a separate outcome, not a Failure

When a protection layer (CAPTCHA, bot challenge, access denial, or rate limiting with a Protection Provider signature or challenge-page evidence) withholds the real page, the check is recorded as a Website Block rather than a Failure, and it never sends a Discord alert. A Website Block proves nothing about what real visitors see, and alerting on it flooded Discord with noise the operator could not act on as an outage. A bare HTTP 403 or 429 with no protection evidence stays a Failure, because a misconfigured site refusing every visitor is a real outage we would rather over-alert on than silently miss.

## Consequences

- A Website Block neither starts nor ends a Failure Episode, so it is never a Recovery and never causes a duplicate Alert when the site flips between failing and blocked.
- A long-running Block Episode means the URL is effectively unmonitored; this is surfaced only on the dashboard (with its start time), by design, not in Discord.
