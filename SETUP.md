# CDR Call Analytics App

A simple call analytics dashboard that authenticates users by tenant and displays CDR data with charts, filters, and CSV export.

## Features

- **Login page** — username/password maps to a tenant ID
- **Dashboard** — KPI cards, daily volume chart, hourly distribution, call status/direction pie charts, top callers
- **Filters** — date range, status, direction, phone number search
- **CSV upload** — upload your own CDR CSV files for analysis
- **CSV export** — download filtered data
- **API integration** — connects to PortaBilling/Bicom API when configured
- **Demo mode** — generates realistic demo data when no API is configured
- **Embeddable** — iframe-friendly headers for embedding in GHL

## Quick Start (Local Development)

```bash
cd cdr-analytics
npm install
npm run dev
```

Open http://localhost:3000 and login with:
- **Username:** demo
- **Password:** demo123

## Deploy to Vercel (Free)

1. Push this project to a GitHub repo
2. Go to https://vercel.com and sign in with GitHub
3. Click "Import Project" and select the repo
4. Add these environment variables in Vercel:
   - `JWT_SECRET` — a random secret string (use: `openssl rand -hex 32`)
   - `TENANTS` — your tenant config JSON (see below)
   - `API_BASE_URL` — your PortaBilling API URL (optional)
   - `API_KEY` — your API key (optional)
5. Click "Deploy"

## Adding Tenants

Use the helper script to generate tenant entries:

```bash
node scripts/add-tenant.mjs john password123 1001 "Acme Corp"
node scripts/add-tenant.mjs jane secretpass 1002 "Beta Inc"
```

This outputs the JSON to add to your `TENANTS` environment variable. Combine multiple tenants like:

```json
TENANTS={"john":{"password_hash":"$2b$10$...","tenant_id":"1001","name":"Acme Corp"},"jane":{"password_hash":"$2b$10$...","tenant_id":"1002","name":"Beta Inc"}}
```

## Embedding in GHL

Once deployed to Vercel, you'll get a URL like `https://cdr-analytics.vercel.app`.

In GHL:
1. Go to your website/funnel editor
2. Add a **Custom Code** or **HTML** element
3. Paste this iframe code:

```html
<iframe
  src="https://your-app.vercel.app"
  width="100%"
  height="800"
  frameborder="0"
  style="border: none; border-radius: 12px;"
></iframe>
```

Or add it as a menu link that opens in a new tab.

## CSV Format

When uploading CSV files, the app auto-detects these column names:

| Our Field   | Accepted CSV Headers                              |
|-------------|---------------------------------------------------|
| timestamp   | timestamp, date, connect_time, bill_time          |
| caller      | caller, CLI, source, from                         |
| callee      | callee, CLD, destination, to                      |
| duration    | duration, charged_quantity                         |
| status      | status, disconnect_cause                           |
| direction   | direction, call_class                              |
| cost        | cost, charged_amount                               |

## Connecting to PortaBilling API

Set these environment variables:
- `API_BASE_URL`: e.g., `https://mybilling.server.com/rest`
- `API_KEY`: Your API authentication token

The app calls `GET /CDR/get_xdr_list?i_customer={tenant_id}` to fetch CDR records.
