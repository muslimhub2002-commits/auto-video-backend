# Remotion Lambda setup (AWS)

This backend can render videos in two modes:

- **Local render (default)**: Uses `@remotion/renderer` on the same machine as the NestJS backend.
- **AWS Lambda render (recommended for production)**: Offloads heavy Chrome rendering to Remotion Lambda to avoid webserver heap / CPU exhaustion.

## 1) Prerequisites

- AWS credentials available to the machine running the deploy script (one of):
  - `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (+ optionally `AWS_SESSION_TOKEN`)
  - or an instance/role profile (EC2/ECS/etc)
- Node.js installed

Quick sanity check:

- Run: `npm run aws:check`

## 2) Deploy Remotion Lambda function + site

From `auto-video-backend/`:

- Install deps: `npm install`
- Deploy: `npm run remotion:lambda:deploy`

This script will:

- Create (or reuse) the Remotion S3 bucket
- Deploy the Remotion site (bundle) to S3
- Deploy the Remotion render function to AWS Lambda
- Print the env vars you should set on your backend service

You can customize deploy parameters:

- `REMOTION_LAMBDA_REGION` (default: `us-east-1`)
- `REMOTION_LAMBDA_MEMORY_MB` (default: `4096`)
- `REMOTION_LAMBDA_DISK_MB` (default: `2048`)
- `REMOTION_LAMBDA_TIMEOUT_SECONDS` (default: `120`)
- `REMOTION_LAMBDA_SITE_NAME` (default: `auto-video-generator`)

## 3) Configure the backend to use Lambda rendering

Set these env vars on your deployed backend (Render/Fly/AWS/etc):

- `REMOTION_RENDER_PROVIDER=lambda`
- `REMOTION_LAMBDA_REGION=...`
- `REMOTION_LAMBDA_FUNCTION_NAME=...`
- `REMOTION_LAMBDA_SERVE_URL=...`

### Serve URL requirements (plain S3)

For stability, the `REMOTION_LAMBDA_SERVE_URL` must point to a **static Remotion site hosted on S3** (the output of `deploySite()`), not your Vercel app.

- ✅ Correct: use the **exact** `site.serveUrl` printed by `npm run remotion:lambda:deploy`
  - It usually looks like: `https://<bucket>.s3.<region>.amazonaws.com/sites/<siteName>/index.html`
- ❌ Incorrect: pointing to a Vercel/Next.js URL (Lambda needs a static Remotion bundle)
- ❌ Incorrect: using the bucket root like `https://<bucket>.s3.amazonaws.com/` (must end in `index.html`)

If you accidentally set a bad URL, the backend will now fail fast with a clear error.

Optional:

- `REMOTION_LAMBDA_POLL_MS=5000`

## Notes

- When Lambda rendering is enabled, the backend will ensure voiceover + images are accessible via public URLs (Cloudinary) because Lambda cannot read your local filesystem.
- The final output is still uploaded to Cloudinary (existing behavior).
