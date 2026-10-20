# Security incident response — Weather Slip

Owner: ThePixelEdge (security contact: teampixeledge@gmail.com).
Applies to the production app (Shopify app "Weather Slip",
weatherslip.thepixeledge.in) and the staging app.
Adopted 2026-10-20; review once a year or after any incident.

## What counts as an incident

- Unauthorised access to, or disclosure of, merchant or customer data:
  the database, Shopify access tokens, or order data read by the app.
- A leaked secret: Shopify API secret, database URL, encryption key,
  OpenWeather or SMTP credentials, AWS keys.
- Compromise of an admin account: AWS, Neon, GitHub, the Shopify Partner
  Dashboard, Sentry, Vercel or GoDaddy DNS.
- Malicious code in the repository or a dependency that reached production.

## How we detect it

- Sentry alerts (new or regressed errors) and the app's operator alert
  emails.
- AWS CloudTrail and billing alerts, Neon and GitHub security emails.
- Reports from merchants, Shopify or anyone else, sent to
  teampixeledge@gmail.com.

## Response steps

1. **Triage (within 4 hours of noticing).** Confirm what happened, which
   systems and which shops are affected, and whether personal data was
   involved. Keep notes with timestamps from the start.
2. **Contain.**
   - Rotate every exposed secret. Production secrets live in AWS SSM
     (`/weather-slip/prod/*`); rotate them there, then rerun the deploy
     workflow.
   - Revoke compromised keys and sessions: AWS access keys, GitHub tokens,
     Neon API keys, the Shopify app secret (Dev Dashboard → rotate).
   - If the database may be exposed, reset the Neon role password.
   - If needed, take the app offline by scaling the Lightsail service down.
3. **Eradicate and recover.** Remove the cause (bad code, compromised
   dependency, leaked credential). Restore data from Neon point-in-time
   restore if it was altered. Redeploy from a known-good commit.
4. **Notify.**
   - Affected merchants: without undue delay, and within 72 hours of
     confirming that personal data was affected (GDPR Art. 33/34 timing).
     Merchants are the controllers of their customers' data.
   - Shopify: through the Partner Dashboard support channel, for any
     incident involving Shopify merchant or customer data.
   - Authorities: where the law requires it, for example an EU/UK
     supervisory authority, or CERT-In within 6 hours for reportable
     incidents in India.
5. **Review (within 2 weeks).** Write a short post-incident report: the
   timeline, the root cause, what data was affected, and the fixes. Update
   this policy and CLAUDE.md if anything should change.

## Prevention we keep in place

- Customer names, addresses, phones and emails are never stored (see
  `/privacy`). Request bodies and personal data are stripped from error
  reports.
- Secrets live only in AWS SSM and Vercel, never in the repository, which
  is public. GitHub reaches AWS with OIDC, with no stored keys.
- Two-factor authentication on every admin account: AWS root, Neon,
  GitHub, the Shopify Partner Dashboard, Sentry, Vercel and GoDaddy.
- Separate production and staging apps, databases and hosting.
- Every webhook's HMAC signature is verified, and HTTPS is used
  everywhere.
