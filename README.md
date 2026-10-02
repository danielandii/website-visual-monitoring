# Website Visual Monitoring

Mobile-first website monitor for public client URLs. A separate worker uses Playwright/Chromium to check each URL roughly once per hour, detects clear failures with deterministic signals first, uses OpenRouter visual AI only for ambiguous cases, and sends one Discord alert per failure episode.

## Decisions captured

- Public URLs only; no authenticated flows.
- Mobile viewport by default: `390x844`.
- Screenshots are ephemeral and not stored.
- MySQL stores monitored URLs and latest result only.
- Dashboard and worker run as separate processes.
- Light Playwright stealth is enabled; no proxies or CAPTCHA solving.

See `CONTEXT.md` and `docs/adr/` for the domain language and architecture decisions.

## Setup

```bash
npm install
cp .env.example .env
```

Set at minimum:

```bash
DATABASE_URL=mysql://user:password@host:3306/database
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=<sha256 password hash>
SESSION_SECRET=<32+ random chars>
DISCORD_WEBHOOK_URL=<discord webhook>
```

Generate a password hash:

```bash
node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" 'your-password'
```

`ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` only seed the first admin account on first sign-in. After that, users, roles (Admin / Viewer) and passwords are managed in the dashboard under Admin → Users. Values saved under Admin → Settings are stored in the database and override the matching environment variables; the worker reloads them about every 30 seconds.

Run migrations:

```bash
npm run db:migrate
```

Install Chromium for Playwright if needed:

```bash
npx playwright install chromium
```

## Development

Run the dashboard:

```bash
npm run dev
```

Run the monitoring worker in another terminal:

```bash
npm run dev:worker
```

## Production commands

```bash
npm run build
npm run start
npm run worker
```

Run dashboard and worker as separate processes/services.

## Docker deploy

Create `.env` from `.env.example`, set secrets, and set `DATABASE_URL` to your already-running MySQL database. Then deploy the dashboard app and worker in one command; the app runs migrations before it starts:

```bash
docker compose up --build -d
```

The dashboard is exposed on `http://localhost:3000` by default. Override the host port with `APP_PORT=8080 docker compose up --build -d`.

Dokploy: deploy this Compose file as the app stack, add the variables from `.env.example` in Dokploy, and point `DATABASE_URL` at your database service in the same Dokploy environment, for example `mysql://user:password@mysql:3306/website_visual_monitoring`. Use the actual DB service/container hostname Dokploy shows.

## CSV import

CSV format:

```csv
name,url,enabled
Client A,https://example.com,true
Client B,https://example.org,false
```

Duplicate URLs are skipped after light normalization.
