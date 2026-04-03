#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function expectMatch(source, regex, label) {
  const match = source.match(regex);
  if (!match) {
    throw new Error(`Missing ${label}`);
  }
  return match;
}

function expectNumber(source, regex, label, validator) {
  const match = expectMatch(source, regex, label);
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric value for ${label}`);
  }
  if (!validator(value)) {
    throw new Error(`${label} out of bounds: ${value}`);
  }
  return value;
}

function main() {
  const friends = read('utils/friendsService.ts');
  const messages = read('utils/messageService.ts');
  const clubs = read('utils/clubsService.ts');
  const moderation = read('utils/moderationService.ts');
  const community = read('app/(tabs)/community/index.tsx');
  const tabsLayout = read('app/(tabs)/_layout.tsx');
  const appConfig = read('utils/appConfig.ts');

  expectMatch(
    appConfig,
    /SOCIAL_FEATURES_ENABLED:\s*true\b/,
    'SOCIAL_FEATURES_ENABLED=true in appConfig (social must ship enabled)'
  );

  const friendDaily = expectNumber(
    friends,
    /const\s+FRIEND_REQUESTS_PER_DAY_LIMIT\s*=\s*(\d+);/,
    'FRIEND_REQUESTS_PER_DAY_LIMIT',
    (v) => v > 0 && v <= 50
  );
  const friendRepeatHours = expectNumber(
    friends,
    /const\s+FRIEND_REQUEST_REPEAT_COOLDOWN_HOURS\s*=\s*(\d+);/,
    'FRIEND_REQUEST_REPEAT_COOLDOWN_HOURS',
    (v) => v >= 1 && v <= 48
  );
  const friendDeclineCooldownDays = expectNumber(
    friends,
    /const\s+FRIEND_REQUEST_DECLINE_COOLDOWN_DAYS\s*=\s*(\d+);/,
    'FRIEND_REQUEST_DECLINE_COOLDOWN_DAYS',
    (v) => v >= 1 && v <= 14
  );

  const messagePerMin = expectNumber(
    messages,
    /const\s+MESSAGE_LIMIT_PER_MIN\s*=\s*(\d+);/,
    'MESSAGE_LIMIT_PER_MIN',
    (v) => v > 0 && v <= 25
  );
  const invitePerDay = expectNumber(
    messages,
    /const\s+INVITE_LIMIT_PER_DAY\s*=\s*(\d+);/,
    'INVITE_LIMIT_PER_DAY',
    (v) => v > 0 && v <= 30
  );
  const repeatInviteHours = expectNumber(
    messages,
    /const\s+REPEAT_INVITE_COOLDOWN_HOURS\s*=\s*(\d+);/,
    'REPEAT_INVITE_COOLDOWN_HOURS',
    (v) => v >= 6 && v <= 72
  );

  const joinReqPerDay = expectNumber(
    clubs,
    /const\s+JOIN_REQUESTS_PER_DAY_LIMIT\s*=\s*(\d+);/,
    'JOIN_REQUESTS_PER_DAY_LIMIT',
    (v) => v > 0 && v <= 30
  );
  const clubInvitesPerDay = expectNumber(
    clubs,
    /const\s+CLUB_INVITES_PER_DAY_LIMIT\s*=\s*(\d+);/,
    'CLUB_INVITES_PER_DAY_LIMIT',
    (v) => v > 0 && v <= 60
  );
  const tokenFailedLimit = expectNumber(
    clubs,
    /const\s+INVITE_TOKEN_FAILED_ATTEMPTS_PER_HOUR_LIMIT\s*=\s*(\d+);/,
    'INVITE_TOKEN_FAILED_ATTEMPTS_PER_HOUR_LIMIT',
    (v) => v > 0 && v <= 20
  );

  const reportsPerDay = expectNumber(
    moderation,
    /const\s+REPORTS_PER_DAY_LIMIT\s*=\s*(\d+);/,
    'REPORTS_PER_DAY_LIMIT',
    (v) => v > 0 && v <= 100
  );

  expectMatch(friends, /isBlockedBetweenUsers\(/, 'friend block enforcement entrypoint');
  expectMatch(messages, /isBlockedBetweenUsers\(/, 'message block enforcement');
  // Community feed must provide an explicit "following" (friends) mode so users are not
  // forced into a public feed by default. Earlier builds used Friends/Groups segments.
  const hasLegacySegments = /key:\s*'friends'[\s\S]*key:\s*'groups'/.test(community);
  const hasFeedModes =
    /type\s+FeedMode\s*=\s*'following'\s*\|\s*'for_you'/.test(community) &&
    /setMode\(\s*'following'\s*\)/.test(community) &&
    /setMode\(\s*'for_you'\s*\)/.test(community);
  const hasModeDataSplit =
    /mode\s*===\s*'following'[\s\S]*getFriendsFeed/.test(community) &&
    /getCommunityFeed/.test(community);

  if (!hasLegacySegments && !(hasFeedModes && hasModeDataSplit)) {
    throw new Error('Missing community Following/For You mode segments');
  }
  // Teams is a first-class bottom tab (not a Community segment).
  expectMatch(
    tabsLayout,
    /name="teams"/,
    'Teams tab route'
  );

  console.log('Social safety check passed.');
  console.log(`- Friend requests/day: ${friendDaily}`);
  console.log(`- Friend repeat cooldown: ${friendRepeatHours}h`);
  console.log(`- Friend decline cooldown: ${friendDeclineCooldownDays}d`);
  console.log(`- Messages/min: ${messagePerMin}`);
  console.log(`- Invites/day (DM): ${invitePerDay}`);
  console.log(`- Invite repeat cooldown: ${repeatInviteHours}h`);
  console.log(`- Club join requests/day: ${joinReqPerDay}`);
  console.log(`- Club invites/day: ${clubInvitesPerDay}`);
  console.log(`- Invite token failures/hour: ${tokenFailedLimit}`);
  console.log(`- Reports/day: ${reportsPerDay}`);
}

main();
