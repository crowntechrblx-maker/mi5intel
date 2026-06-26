const fetch = require('node-fetch');

const ROBLOX_APIS = {
  users: 'https://users.roblox.com/v1',
  groups: 'https://groups.roblox.com/v1',
  friends: 'https://friends.roblox.com/v1',
  games: 'https://games.roblox.com/v2',
  thumbnails: 'https://thumbnails.roblox.com/v1',
  badges: 'https://badges.roblox.com/v1',
  inventory: 'https://inventory.roblox.com/v2',
  accountinfo: 'https://accountinformation.roblox.com/v1',
};

async function apiFetch(url) {
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      timeout: 10000,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function apiPost(url, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
      timeout: 10000,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function resolveUsername(username) {
  const data = await apiPost(`${ROBLOX_APIS.users}/usernames/users`, {
    usernames: [username],
    excludeBannedUsers: false,
  });
  if (!data || !data.data || data.data.length === 0) return null;
  return data.data[0];
}

async function getUserById(userId) {
  return apiFetch(`${ROBLOX_APIS.users}/users/${userId}`);
}

async function getUsernameHistory(userId) {
  const data = await apiFetch(`${ROBLOX_APIS.users}/users/${userId}/username-history?limit=50&sortOrder=Desc`);
  return data ? data.data || [] : [];
}

async function getUserGroups(userId) {
  const data = await apiFetch(`${ROBLOX_APIS.groups}/users/${userId}/groups/roles`);
  return data ? data.data || [] : [];
}

async function getFriendsCount(userId) {
  const data = await apiFetch(`${ROBLOX_APIS.friends}/users/${userId}/friends/count`);
  return data ? data.count : 0;
}

async function getFollowersCount(userId) {
  const data = await apiFetch(`${ROBLOX_APIS.friends}/users/${userId}/followers/count`);
  return data ? data.count : 0;
}

async function getFollowingCount(userId) {
  const data = await apiFetch(`${ROBLOX_APIS.friends}/users/${userId}/followings/count`);
  return data ? data.count : 0;
}

async function getFriendsList(userId) {
  const data = await apiFetch(`${ROBLOX_APIS.friends}/users/${userId}/friends?limit=50`);
  return data ? data.data || [] : [];
}

async function getCreatedGames(userId) {
  const data = await apiFetch(`${ROBLOX_APIS.games}/users/${userId}/games?sortOrder=Desc&limit=50`);
  return data ? data.data || [] : [];
}

async function getAvatarUrl(userId) {
  const data = await apiFetch(
    `${ROBLOX_APIS.thumbnails}/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`
  );
  if (!data || !data.data || data.data.length === 0) return null;
  return data.data[0].imageUrl || null;
}

async function getBodyAvatarUrl(userId) {
  const data = await apiFetch(
    `${ROBLOX_APIS.thumbnails}/users/avatar?userIds=${userId}&size=250x250&format=Png&isCircular=false`
  );
  if (!data || !data.data || data.data.length === 0) return null;
  return data.data[0].imageUrl || null;
}

async function getRobloxBadges(userId) {
  const data = await apiFetch(`${ROBLOX_APIS.accountinfo}/users/${userId}/roblox-badges`);
  return data || [];
}

async function fullProfileFetch(identifier) {
  let userId;
  let basicProfile;

  const isNumeric = /^\d+$/.test(String(identifier).trim());

  if (isNumeric) {
    userId = String(identifier).trim();
    basicProfile = await getUserById(userId);
    if (!basicProfile) return { error: `No user found with ID ${userId}` };
  } else {
    const resolved = await resolveUsername(String(identifier).trim());
    if (!resolved) return { error: `Username "${identifier}" not found on Roblox` };
    userId = String(resolved.id);
    basicProfile = await getUserById(userId);
    if (!basicProfile) return { error: `Could not fetch profile for user ID ${userId}` };
  }

  const [
    usernameHistory,
    groups,
    friendsCount,
    followersCount,
    followingCount,
    friends,
    games,
    avatarUrl,
    bodyAvatarUrl,
    robloxBadges,
  ] = await Promise.all([
    getUsernameHistory(userId),
    getUserGroups(userId),
    getFriendsCount(userId),
    getFollowersCount(userId),
    getFollowingCount(userId),
    getFriendsList(userId),
    getCreatedGames(userId),
    getAvatarUrl(userId),
    getBodyAvatarUrl(userId),
    getRobloxBadges(userId),
  ]);

  return {
    roblox_id: userId,
    username: basicProfile.name,
    display_name: basicProfile.displayName,
    description: basicProfile.description || '',
    is_banned: basicProfile.isBanned || false,
    created: basicProfile.created,
    avatar_url: avatarUrl,
    body_avatar_url: bodyAvatarUrl,
    username_history: usernameHistory,
    groups,
    friends_count: friendsCount,
    followers_count: followersCount,
    following_count: followingCount,
    friends_list: friends,
    games,
    roblox_badges: robloxBadges,
    fetched_at: new Date().toISOString(),
  };
}

module.exports = { fullProfileFetch, resolveUsername, getUserById };
