const path = require('path');

async function main() {
  const { deployFunction, deploySite, getOrCreateBucket } = require('@remotion/lambda');

  const region =
    process.env.REMOTION_LAMBDA_REGION ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    'us-east-1';

  const siteName = process.env.REMOTION_LAMBDA_SITE_NAME || 'auto-video-generator';

  const entryPoint = path.join(process.cwd(), 'remotion', 'src', 'index.tsx');
  const publicDir = path.join(process.cwd(), 'remotion', 'public');

  const memorySizeInMb = Number.parseInt(
    process.env.REMOTION_LAMBDA_MEMORY_MB || '4096',
    10,
  );
  const diskSizeInMb = Number.parseInt(
    process.env.REMOTION_LAMBDA_DISK_MB || '2048',
    10,
  );
  const timeoutInSeconds = Number.parseInt(
    process.env.REMOTION_LAMBDA_TIMEOUT_SECONDS || '120',
    10,
  );

  if (!Number.isFinite(memorySizeInMb) || memorySizeInMb <= 0) {
    throw new Error('REMOTION_LAMBDA_MEMORY_MB must be a positive integer');
  }
  if (!Number.isFinite(diskSizeInMb) || diskSizeInMb <= 0) {
    throw new Error('REMOTION_LAMBDA_DISK_MB must be a positive integer');
  }
  if (!Number.isFinite(timeoutInSeconds) || timeoutInSeconds <= 0) {
    throw new Error('REMOTION_LAMBDA_TIMEOUT_SECONDS must be a positive integer');
  }

  console.log('[remotion-lambda-deploy] Using config', {
    region,
    siteName,
    memorySizeInMb,
    diskSizeInMb,
    timeoutInSeconds,
  });

  const bucket = await getOrCreateBucket({ region });
  console.log('[remotion-lambda-deploy] Bucket', bucket);

  const site = await deploySite({
    entryPoint,
    bucketName: bucket.bucketName,
    region,
    siteName,
    privacy: 'public',
    options: {
      publicDir,
    },
  });

  console.log('[remotion-lambda-deploy] Site', site);

  const fn = await deployFunction({
    region,
    createCloudWatchLogGroup: true,
    timeoutInSeconds,
    memorySizeInMb,
    diskSizeInMb,
  });

  console.log('[remotion-lambda-deploy] Function', fn);

  console.log('\nSet these env vars on your backend service:');
  console.log(`REMOTION_RENDER_PROVIDER=lambda`);
  console.log(`REMOTION_LAMBDA_REGION=${region}`);
  console.log(`REMOTION_LAMBDA_FUNCTION_NAME=${fn.functionName}`);
  console.log(`REMOTION_LAMBDA_SERVE_URL=${site.serveUrl}`);
  console.log('\nOptional (polling interval ms):');
  console.log('REMOTION_LAMBDA_POLL_MS=5000');
}

main().catch((err) => {
  console.error('[remotion-lambda-deploy] FAILED', err?.stack || err?.message || String(err));
  process.exitCode = 1;
});
