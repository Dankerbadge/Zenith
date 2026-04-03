function stringifyError(err: any): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const msg = (err as any)?.message;
  if (typeof msg === 'string') return msg;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function looksLikeSchemaCacheDrift(message: string) {
  const m = message.toLowerCase();
  return m.includes('schema cache') || (m.includes('could not find') && m.includes('in the schema cache'));
}

function looksLikeMissingFunction(message: string) {
  const m = message.toLowerCase();
  return m.includes('function') && (m.includes('does not exist') || m.includes('could not find'));
}

function looksLikeMissingColumn(message: string) {
  const m = message.toLowerCase();
  return m.includes('column') && (m.includes('does not exist') || m.includes('could not find'));
}

export function userFacingErrorMessage(err: any, fallback: string) {
  const raw = stringifyError(err);
  const msg = raw || '';

  if (looksLikeSchemaCacheDrift(msg)) {
    return 'The server is updating. Try again in a minute. If it keeps happening, update the app.';
  }

  if (looksLikeMissingFunction(msg) || looksLikeMissingColumn(msg)) {
    return 'This feature is temporarily unavailable due to a server update. Please try again shortly.';
  }

  // Supabase / PostgREST often throws a helpful message; keep it if it's already user-safe and short.
  if (msg && msg.length <= 120 && !msg.toLowerCase().includes('pgrst')) {
    return msg;
  }

  return fallback;
}

export function devErrorDetail(err: any) {
  const raw = stringifyError(err);
  const code = String((err as any)?.code || '');
  const hint = String((err as any)?.hint || '');
  const details = String((err as any)?.details || '');
  const parts = [raw, code && `code=${code}`, hint && `hint=${hint}`, details && `details=${details}`].filter(Boolean);
  return parts.join(' · ');
}

