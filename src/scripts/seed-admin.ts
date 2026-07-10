import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { resolveAuthDatabaseUrl } from '../config/env.config.js';
import { DatabaseService } from '../database/database.module.js';

// Load .env
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(
      password.normalize('NFKC'),
      salt,
      64,
      { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 },
      (err, derived) => {
        if (err) return reject(err);
        resolve(`${salt}:${derived.toString('hex')}`);
      },
    );
  });
}

function createRL(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const chars: string[] = [];

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (ch: string) => {
      const c = ch.toString();

      if (c === '\n' || c === '\r' || c === '\u0004') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(chars.join(''));
      } else if (c === '\u0003') {
        process.stdout.write('\n');
        process.exit(1);
      } else if (c === '\u007f' || c === '\b') {
        if (chars.length > 0) {
          chars.pop();
          process.stdout.write('\b \b');
        }
      } else {
        chars.push(c);
        process.stdout.write('*');
      }
    };

    process.stdin.on('data', onData);
  });
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function upsertAdminAuthUser(
  db: Pick<Pool, 'query'>,
  input: { fullName: string; email: string; password: string },
): Promise<{ created: boolean; accountCreated: boolean }> {
  const email = input.email.trim().toLowerCase();

  const existing = await db.query<{ id: string }>(
    'SELECT id FROM "user" WHERE email = $1',
    [email],
  );
  const userId = existing.rows[0]?.id ?? randomUUID();
  let created = false;

  if (existing.rows[0]) {
    await db.query(
      'UPDATE "user" SET name = $2, email = $3, role = $4, "updatedAt" = now() WHERE id = $1',
      [userId, input.fullName, email, 'admin'],
    );
  } else {
    created = true;
    await db.query(
      `
        INSERT INTO "user" (
          id, name, email, "emailVerified", image, role, banned, "banReason", "banExpires"
        )
        VALUES ($1, $2, $3, true, null, 'admin', false, null, null)
      `,
      [userId, input.fullName, email],
    );
  }

  const existingAccount = await db.query<{ id: string }>(
    'SELECT id FROM account WHERE "userId" = $1 AND "providerId" = $2',
    [userId, 'credential'],
  );
  await db.query(
    `
      INSERT INTO account (
        id, "userId", "accountId", "providerId", password
      )
      VALUES ($1, $2, $2, 'credential', $3)
      ON CONFLICT ("providerId", "userId")
      DO UPDATE SET
        "accountId" = EXCLUDED."accountId",
        password = EXCLUDED.password,
        "updatedAt" = now()
    `,
    [randomUUID(), userId, await hashPassword(input.password)],
  );

  return {
    created,
    accountCreated: !existingAccount.rows[0],
  };
}

async function main() {
  console.log('\n=== DHA EVD Admin User Setup ===\n');

  const rl = createRL();

  const fullName = await ask(rl, 'Full Name: ');
  if (!fullName) {
    console.error('Full name is required.');
    process.exit(1);
  }

  const email = await ask(rl, 'Email: ');
  const normalizedEmail = email.trim().toLowerCase();
  if (!validateEmail(normalizedEmail)) {
    console.error('Invalid email address.');
    process.exit(1);
  }

  rl.close();

  const password = await askHidden('Password: ');
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const confirm = await askHidden('Confirm Password: ');
  if (password !== confirm) {
    console.error('Passwords do not match.');
    process.exit(1);
  }

  console.log('\nCreating admin user...');

  const pool = new Pool({ connectionString: resolveAuthDatabaseUrl() });

  try {
    await new DatabaseService(pool).ensureSchema();
    const result = await upsertAdminAuthUser(pool, {
      fullName,
      email: normalizedEmail,
      password,
    });

    if (result.created) {
      console.log('✓ Auth user created');
    } else {
      console.log('✓ Existing auth user updated as admin');
    }
    console.log(
      result.accountCreated
        ? '✓ Credential account created'
        : '✓ Credential account updated',
    );

    console.log('\nDone! Admin user ready.\n');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  void main();
}
