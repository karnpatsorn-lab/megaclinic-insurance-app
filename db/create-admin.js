// Usage: node db/create-admin.js <username> <password> [displayName]
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./pool');

async function main() {
  const [username, password, displayName] = process.argv.slice(2);
  if (!username || !password) {
    console.error('Usage: node db/create-admin.js <username> <password> [displayName]');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO admin_users (username, password_hash, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, display_name = EXCLUDED.display_name`,
    [username, hash, displayName || username]
  );
  console.log(`Admin user '${username}' created/updated.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
