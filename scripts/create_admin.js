/**
 * Creates (or promotes) an admin account. Public signup only creates
 * customers, so the first admin is seeded with this script.
 *
 *   npm run seed:admin -- --email admin@courses4me.co.uk --password 'Str0ng!Pass' --name "Site Admin"
 *   npm run seed:admin -- --email editor@courses4me.co.uk --password 'Str0ng!Pass' --role editor
 *
 * Or via env: ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME, ADMIN_ROLE.
 * If the email already exists nothing is changed unless --force is passed;
 * with --force the account is promoted to the role and the password is
 * replaced (every existing session is logged out).
 */
require('dotenv').config({ quiet: true });

const db = require('../src/config/db');
const UserModel = require('../src/models/userModel');
const validators = require('../src/validators');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const email = arg('email', process.env.ADMIN_EMAIL);
  const password = arg('password', process.env.ADMIN_PASSWORD);
  const name = arg('name', process.env.ADMIN_NAME || 'Administrator');
  const role = arg('role', process.env.ADMIN_ROLE || 'admin');
  const force = process.argv.includes('--force');

  if (!email || !password) {
    console.error('Usage: npm run seed:admin -- --email <email> --password <password> [--name <name>] [--role admin|editor] [--force]');
    process.exit(1);
  }
  if (!['admin', 'editor'].includes(role)) {
    console.error(`Role must be admin or editor (got "${role}")`);
    process.exit(1);
  }
  const { error } = validators.auth.register.extract('password').validate(password);
  if (error) {
    console.error(`Password rejected: ${error.message}`);
    process.exit(1);
  }

  const passwordHash = await UserModel.hashPassword(password);
  const existing = await UserModel.findByEmail(email);

  if (existing) {
    if (!force) {
      console.error(`User #${existing.id} (${email}, role=${existing.role}) already exists. Re-run with --force to promote it to ${role} and replace its password.`);
      process.exitCode = 1;
      return;
    }
    await UserModel.update(existing.id, { name, role, status: 'active' });
    await UserModel.setPassword(existing.id, passwordHash);
    await UserModel.addActivity(existing.id, { action: 'Status Change', details: `Promoted to ${role} and password set by seed script` });
    console.log(`Updated existing user #${existing.id} (${email}) -> role=${role}, password replaced.`);
  } else {
    const id = await UserModel.create({ name, email, role, passwordHash, status: 'active' });
    await UserModel.addActivity(id, { action: 'Registration', details: `Account created with role: ${role} (seed script)` });
    console.log(`Created ${role} #${id} (${email}).`);
  }
}

main()
  .catch((err) => { console.error('Failed:', err.message); process.exitCode = 1; })
  .finally(() => db.destroy());
