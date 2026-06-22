// One-time backfill: decrypt the agents already stored in ~/.orbit/credentials.json
// and write their keys into the repo .env (SCOUT1/2_*, EXECUTOR1/2_*) so
// `node scripts/run-4-agents.js` can launch them.
//
// New registrations do this automatically (orbit setup / orbit import). This
// script is only needed for agents registered before that feature existed.
//
// Usage:
//   ORBIT_PASSWORD=yourpassword node scripts/sync-agents-to-env.js
//   node scripts/sync-agents-to-env.js            (prompts for password)

const path = require('path');
const { CredentialManager, syncAgentToEnv } = require('@orbit/core');

const ENV_PATH = path.join(__dirname, '..', '.env');

async function getPassword() {
  if (process.env.ORBIT_PASSWORD) return process.env.ORBIT_PASSWORD;
  const { password } = require('@inquirer/prompts');
  return password({ message: 'Credential password (unlocks ~/.orbit/credentials.json)', mask: '*' });
}

async function main() {
  const profiles = CredentialManager.listProfiles(); // no keys, safe metadata
  if (profiles.length === 0) {
    console.error('No agents found in ~/.orbit/credentials.json. Run `orbit setup` first.');
    process.exit(1);
  }

  // Dedupe by wallet; keep first occurrence of each unique wallet.
  const seen = new Set();
  const unique = [];
  for (const p of profiles) {
    const w = p.wallet.toLowerCase();
    if (seen.has(w)) continue;
    seen.add(w);
    unique.push(p);
  }

  const scouts = unique.filter((p) => p.type === 'scout').slice(0, 2);
  const executors = unique.filter((p) => p.type === 'executor').slice(0, 2);
  const chosen = [...scouts, ...executors];

  console.log('Agents to sync into .env:');
  for (const p of chosen) console.log(`  ${p.type.padEnd(8)} ${p.name.padEnd(16)} ${p.wallet}`);
  console.log('');

  const password = await getPassword();

  let failures = 0;
  for (const p of chosen) {
    try {
      const full = CredentialManager.loadProfile(p.name, password); // decrypts -> encryptedKey holds raw key
      const res = syncAgentToEnv(
        {
          type: full.type,
          wallet: full.wallet,
          privateKey: full.encryptedKey,
          developerWallet: full.developerWallet || full.wallet,
        },
        ENV_PATH
      );
      console.log(`  ✓ ${p.name.padEnd(16)} -> ${res.slotName}_PRIVATE_KEY (${res.action})`);
    } catch (e) {
      failures++;
      console.error(`  ✗ ${p.name.padEnd(16)} -> ${e.message}`);
    }
  }

  console.log('');
  if (failures > 0) {
    console.error(`${failures} agent(s) failed — likely a wrong password. .env left partially updated.`);
    process.exit(1);
  }
  console.log(`Done. ${chosen.length} agents written to ${ENV_PATH}`);
  console.log('Launch them with:  node scripts/run-4-agents.js');
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
