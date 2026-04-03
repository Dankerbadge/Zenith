#!/usr/bin/env node
/* eslint-disable no-console */

const {
  baseConfig,
  ensureFixtureUser,
  readJsonFile,
  restUpsert,
  writeJsonReport,
  tableExists,
} = require('./phase30-lib');

function isoDayFromOffset(dayOffset) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + Number(dayOffset || 0)));
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function seedNutritionDaily(config, userId, rows) {
  const exists = await tableExists(config, 'nutrition_daily');
  if (!exists) return { skipped: true, reason: 'nutrition_daily_missing', count: 0 };

  const payload = (Array.isArray(rows) ? rows : []).map((row) => ({
    user_id: userId,
    day: isoDayFromOffset(row.dayOffset),
    calories_kcal: row.calories_kcal,
    protein_g: row.protein_g,
    carbs_g: row.carbs_g,
    fat_g: row.fat_g,
    fiber_g: row.fiber_g,
    meal_breakdown: {},
    computed_at: new Date().toISOString(),
  }));
  if (!payload.length) return { skipped: true, reason: 'no_rows', count: 0 };

  const res = await restUpsert(config, {
    table: 'nutrition_daily',
    onConflict: 'user_id,day',
    rows: payload,
  });
  if (!res.ok) throw new Error(`seed_nutrition_daily_failed:${res.status}:${JSON.stringify(res.body)}`);
  return { skipped: false, count: payload.length };
}

async function seedConsent(config, userId) {
  const exists = await tableExists(config, 'food_v2_user_consent');
  if (!exists) return { skipped: true, reason: 'food_v2_user_consent_missing' };
  const res = await restUpsert(config, {
    table: 'food_v2_user_consent',
    onConflict: 'user_id',
    rows: {
      user_id: userId,
      notifications: false,
      analytics: false,
      public_sharing: false,
      consent_updated_at: new Date().toISOString(),
      notes: 'phase30_fixture',
    },
  });
  if (!res.ok) throw new Error(`seed_consent_failed:${res.status}:${JSON.stringify(res.body)}`);
  return { skipped: false };
}

async function seedPublicShares(config, userId, shares) {
  const exists = await tableExists(config, 'food_v2_public_shares');
  if (!exists) return { skipped: true, reason: 'food_v2_public_shares_missing', count: 0 };

  const payload = (Array.isArray(shares) ? shares : []).map((item) => ({
    user_id: userId,
    object_type: item.object_type,
    object_id: item.object_id,
    share_status: item.share_status,
    provenance: {
      seededBy: 'phase30-fixtures-setup',
      createdAt: new Date().toISOString(),
    },
  }));
  if (!payload.length) return { skipped: true, reason: 'no_rows', count: 0 };

  const res = await restUpsert(config, {
    table: 'food_v2_public_shares',
    onConflict: 'user_id,object_type,object_id',
    rows: payload,
  });
  if (!res.ok) throw new Error(`seed_public_shares_failed:${res.status}:${JSON.stringify(res.body)}`);
  return { skipped: false, count: payload.length };
}

async function main() {
  const config = baseConfig();
  const fixtures = readJsonFile('scripts/fixtures/phase30-fixtures.json');
  const users = Array.isArray(fixtures.users) ? fixtures.users : [];
  if (!users.length) throw new Error('No fixture users found.');

  const createdUsers = {};
  for (const user of users) {
    const ensured = await ensureFixtureUser(config, {
      email: user.email,
      password: user.password,
      displayName: user.displayName,
      username: user.username,
      userMetadata: {
        role: user.role || 'user',
        phase30_fixture: true,
      },
      appMetadata: {
        phase30_fixture: true,
      },
    });
    createdUsers[user.key] = ensured;
  }

  const regularUserId = createdUsers.regular?.userId;
  const deleteCandidateUserId = createdUsers.delete_candidate?.userId;
  if (!regularUserId || !deleteCandidateUserId) {
    throw new Error('Fixture users missing required keys: regular/delete_candidate');
  }

  const nutritionSeed = await seedNutritionDaily(config, regularUserId, fixtures.seed?.logs || []);
  const consentSeedRegular = await seedConsent(config, regularUserId);
  const consentSeedDelete = await seedConsent(config, deleteCandidateUserId);
  const sharesSeedRegular = await seedPublicShares(config, regularUserId, fixtures.seed?.publicShares || []);
  const sharesSeedDelete = await seedPublicShares(config, deleteCandidateUserId, [
    {
      object_type: 'recipe',
      object_id: 'fixture:delete-candidate',
      share_status: 'active',
    },
  ]);

  const report = {
    ok: true,
    createdAt: new Date().toISOString(),
    users: createdUsers,
    seeds: {
      nutritionDaily: nutritionSeed,
      consentRegular: consentSeedRegular,
      consentDeleteCandidate: consentSeedDelete,
      publicSharesRegular: sharesSeedRegular,
      publicSharesDeleteCandidate: sharesSeedDelete,
    },
  };

  const reportPath = writeJsonReport('PHASE30_FIXTURES_REPORT', report);
  console.log('Phase 30 fixtures setup complete.');
  console.log(`Report: ${reportPath}`);
}

main().catch((error) => {
  console.error(`Phase 30 fixtures setup failed: ${error.message}`);
  process.exit(1);
});

