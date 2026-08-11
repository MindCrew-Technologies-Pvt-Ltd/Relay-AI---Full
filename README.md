# Relay AI — Website + Enquiry Backend

Marketing site for Relay AI with a small Express backend that captures enquiries
from the hero contact form, stores them in PostgreSQL, and (optionally) emails
you whenever someone submits.

```
index-b.html      the live site (Version B — emerald)
index.html        Version A (earlier blue concept, kept for reference)
css/ js/ assets/  front-end
server.js         Express server: static site + /api/enquiry + /admin
```

---

## 1. Deploy on Railway

1. **New Project → Deploy from GitHub repo** → pick this repository.
   Railway detects Node, runs `npm install`, then `npm start`.
2. **Add a database:** in the same project, **New → Database → PostgreSQL**.
   Railway injects `DATABASE_URL` automatically — no code changes needed.
   (Without it the app still runs and writes to `data/enquiries.json`, but that
   file is wiped on every redeploy, so add the database for anything real.)
3. **Add variables** (Service → Variables):

   | Variable      | Required | What it does                                        |
   |---------------|----------|-----------------------------------------------------|
   | `ADMIN_TOKEN` | **Yes**  | Long random string; unlocks `/admin`                 |
   | `DATABASE_URL`| auto     | Added by Railway when you attach PostgreSQL          |
   | `SMTP_HOST`   | optional | Mail server, e.g. `smtp.gmail.com`                   |
   | `SMTP_PORT`   | optional | `587` (or `465` for SSL)                             |
   | `SMTP_USER`   | optional | Mailbox username                                     |
   | `SMTP_PASS`   | optional | Mailbox password / app password                      |
   | `NOTIFY_TO`   | optional | Where new-enquiry emails are sent                    |
   | `NOTIFY_FROM` | optional | From address (defaults to `SMTP_USER`)               |

4. **Settings → Networking → Generate Domain** to get a public URL.

The site is served at `/`, the form posts to `/api/enquiry`.

---

## 2. Where the data goes

Every submission is written to the `enquiries` table in PostgreSQL:

| column | meaning |
|--------|---------|
| `id` | auto-increment |
| `full_name`, `email`, `country_code`, `phone` | what the visitor typed |
| `requirement` | `development` or `marketing` |
| `source`, `ip`, `created_at` | where it came from and when |

**Three ways to read it:**

- **Admin page** — `https://YOUR-DOMAIN/admin?token=YOUR_ADMIN_TOKEN`
  A table of every enquiry, newest first, with a **Download CSV** button.
- **CSV export** — `https://YOUR-DOMAIN/api/enquiries.csv?token=YOUR_ADMIN_TOKEN`
  Opens straight in Excel / Google Sheets.
- **Email** — set the SMTP variables above and you get a message per enquiry,
  with the visitor's address as `Reply-To`, so you can reply directly.

You can also browse the table in Railway: **PostgreSQL service → Data**.

> Keep `ADMIN_TOKEN` private — anyone with it can read every enquiry.

---

## 3. Run it locally

```bash
npm install
cp .env.example .env      # then edit ADMIN_TOKEN
ADMIN_TOKEN=dev-token npm start
```

- Site: <http://localhost:3000>
- Admin: <http://localhost:3000/admin?token=dev-token>

Without `DATABASE_URL`, enquiries are saved to `data/enquiries.json`
(git-ignored) so you can develop without a database.

---

## 4. Built-in protections

- Server-side validation of every field (the browser check is convenience only)
- Honeypot field that silently absorbs bot submissions
- Rate limit of 10 submissions per IP per hour
- HTML escaping on the admin page
- The admin routes refuse to work unless `ADMIN_TOKEN` is set

## 5. Placeholders to replace before launch

Search the HTML for `REPLACEABLE CONTENT`:

- phone, email and social links in the hero and footer
- Privacy Policy and Terms links
