# Detect Compromise passively from the monitor's own page visit

We detect a Compromise (gambling spam, defacement, hostile redirects, foreign scripts, hidden frames) only from what the existing hourly Playwright visit already sees, as a normal visitor would. We deliberately do not probe for XSS or HTML-injection vulnerabilities, because sending attack payloads to client sites would trip their WAFs (turning checks into Website Blocks), could pollute their data, and is a different, heavier job than 24/7 monitoring. We also do not query an external reputation service such as Google Safe Browsing or Web Risk: Safe Browsing is licensed for non-commercial use only, and Web Risk's free tier would not cover hourly lookups for hundreds of URLs, so the monitor stays self-contained.

## Consequences

- A compromise served only to search-engine crawlers or search referrers (cloaking), or planted on pages other than the Monitored URL, is not detected.
- A Monitored URL already compromised when its Known Script Sources are first learned will have the planted script learned as known; gambling-spam, defacement, and redirect detection still catch most such cases.
