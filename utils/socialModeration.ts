export function canModerateContent(
  currentUser: { id?: string | null; role?: string | null } | null | undefined,
  contentOwnerUserId?: string | null
) {
  const currentId = String(currentUser?.id || '').trim();
  const ownerId = String(contentOwnerUserId || '').trim();
  if (!currentId || !ownerId) return false;
  if (currentId === ownerId) return true;
  const role = String(currentUser?.role || '').trim().toLowerCase();
  return role === 'admin' || role === 'moderator';
}
