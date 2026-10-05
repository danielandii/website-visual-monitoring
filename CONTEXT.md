# Website Visual Monitoring

This context defines the language for monitoring public client web pages for visible breakage and downtime.

## Language

**Monitored URL**:
A public web page URL checked for availability and visible rendering problems.
_Avoid_: Website, target, page

**Client**:
A person or organization whose public web pages are monitored.
_Avoid_: Account, customer

**Failure**:
A clear user-facing problem that makes a **Monitored URL** unavailable, blank, visibly erroneous, or severely visually broken.
_Avoid_: Small visual difference, minor design change

**Failure Category**:
The kind of **Failure** detected: down, blank, error page, or visually broken.
_Avoid_: Error type, status

**Website Block**:
A check outcome where a protection layer, evidenced by a challenge page or a **Protection Provider** signature, withholds the real page of a **Monitored URL** from the monitor. A **Website Block** is not a **Failure** and never produces an **Alert**; a bare refusal with no such evidence is a **Failure**.
_Avoid_: Blocked failure, anti-bot failure, blocked category

**Block Type**:
What the monitor was shown during a **Website Block**: CAPTCHA, bot challenge, access denied, or rate limited.
_Avoid_: Block reason, block category

**Block Episode**:
A period during which a **Monitored URL** remains in a confirmed **Website Block**, ended only by a successful check or a confirmed **Failure**. It may overlap an open **Failure Episode** and is never alerted.
_Avoid_: Block incident, blocked duration

**Protection Provider**:
The service that imposed a **Website Block**, such as Cloudflare or Akamai, when it can be identified.
_Avoid_: WAF, CDN, firewall

**Failure Episode**:
A period during which a **Monitored URL** remains in a confirmed **Failure** state.
_Avoid_: Incident, outage event

**Recovery**:
A later successful check that ends a **Failure Episode** and allows a future **Alert** if the **Monitored URL** fails again. A **Website Block** is never a **Recovery**.
_Avoid_: Recovery alert, resolved notification

**Latest Check Result**:
The most recent lightweight record of what happened when a **Monitored URL** was checked, excluding any retained image.
_Avoid_: Check history, screenshot record, log entry

**Suspicion Signal**:
Evidence that a **Monitored URL** may have a **Failure**, but is not enough by itself to trigger an **Alert**.
_Avoid_: Failure, alert reason

**Monitor Interference**:
Behavior on a **Monitored URL**, such as devtools-detection scripts, that disrupts the monitor while still letting it see and verify the real page.
_Avoid_: Failure, **Website Block**, broken site

**Confirmation Retry**:
A second check of the same **Monitored URL** used to confirm a suspected **Failure** or **Website Block** before recording it.
_Avoid_: Double check, rerun

**Alert**:
A notification sent once when a **Failure** is confirmed.
_Avoid_: Message, ping, repeated alert

**Alert Rate Limit**:
A cap on how many **Alerts** may be sent in a short period to prevent Discord flooding.
_Avoid_: Spam control, throttle

**Ephemeral Screenshot**:
A temporary image captured during a check and discarded before the check completes.
_Avoid_: Stored screenshot, archive image

**Viewport**:
The browser screen size used when visually checking a **Monitored URL**.
_Avoid_: Device, resolution

**Check Cadence**:
The intended time between checks for the same **Monitored URL**.
_Avoid_: Frequency, cron

**Check Spacing**:
The intended delay between starting checks for different **Monitored URLs**.
_Avoid_: Sleep, throttle

**Monitoring Dashboard**:
An internal interface for managing **Monitored URLs** and viewing their latest monitoring state.
_Avoid_: Admin panel, report dashboard
