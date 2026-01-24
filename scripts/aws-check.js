const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');

async function main() {
  try {
    const client = new STSClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const out = await client.send(new GetCallerIdentityCommand({}));
    console.log('OK', {
      Account: out.Account,
      Arn: out.Arn,
      UserId: out.UserId,
      Region: process.env.AWS_REGION || 'npx remotion lambda us-east-1',
    });
  } catch (e) {
    console.error('FAIL', e?.name || e?.Code || 'Error', e?.message || String(e));
    process.exitCode = 1;
  }
}

main();
