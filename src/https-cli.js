import { readFileSync } from 'node:fs';
import { managedDomain, inspectCertificate } from './https-status.js';

try {
  const { origin } = JSON.parse(
    readFileSync(process.env.RELAYDESK_CONFIG || '/app/data/runtime.json', 'utf8'),
  );
  if (process.argv[2] === 'domain') console.log(managedDomain(origin));
  else if (process.argv[2] === 'status') {
    const result = await inspectCertificate(origin);
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'valid') process.exitCode = 1;
  } else throw new Error('Usage: https-cli.js domain|status');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
