/**
 * app/api/track/route.ts
 * Receives pageview events from the poyne.js CDN script.
 * Saves to Firestore via REST API (no SDK — stable en environnement serveur/edge).
 * Collection path: analytics/{siteId}/pageviews/{autoId}
 */

import { NextRequest, NextResponse } from 'next/server';

// ─── CORS headers ─────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ─── Firestore REST API ───────────────────────────────────────────────────────
// On utilise l'API REST directement → pas de SDK client instable côté serveur.
const FIREBASE_PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'artboxx';
const FIREBASE_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY    || 'AIzaSyDvWAR0JBl8U61rr_nXdU_E5eI6jZgcjbI';

/** Convertit un objet JS en format champs Firestore REST. */
function toFields(data: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string')       fields[k] = { stringValue: v };
    else if (typeof v === 'number')  fields[k] = { integerValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else                             fields[k] = { stringValue: String(v ?? '') };
  }
  // Timestamp serveur réel
  fields['timestamp'] = { timestampValue: new Date().toISOString() };
  return fields;
}

async function writeToFirestore(
  siteId: string,
  doc: Record<string, unknown>
): Promise<void> {
  // POST sans documentId → Firestore génère un ID auto
  const url =
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}` +
    `/databases/(default)/documents/analytics/${encodeURIComponent(siteId)}/pageviews` +
    `?key=${FIREBASE_API_KEY}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFields(doc) }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore REST ${res.status}: ${text}`);
  }
}

// ─── IP extraction ────────────────────────────────────────────────────────────
function getClientIP(req: NextRequest): string {
  return (
    req.headers.get('x-vercel-forwarded-for') ||
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    '0.0.0.0'
  );
}

// ─── Geo lookup ───────────────────────────────────────────────────────────────
interface GeoResult { country: string; countryCode: string; city: string; }

// Convertit un code ISO 3166-1 en nom de pays anglais (ex: "CM" → "Cameroon")
// Intl.DisplayNames est natif en Node.js 12+ — zéro API externe
function isoToCountryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) || code;
  } catch { return code; }
}

async function getGeo(req: NextRequest, ip: string): Promise<GeoResult> {
  const vercelCountry = req.headers.get('x-vercel-ip-country');
  const vercelCity    = req.headers.get('x-vercel-ip-city');
  if (vercelCountry) {
    return {
      country:     isoToCountryName(vercelCountry),   // "CM" → "Cameroon"
      countryCode: vercelCountry.toUpperCase(),        // "CM" (pas la région "CE")
      city:        vercelCity ? decodeURIComponent(vercelCity) : 'Unknown',
    };
  }
  const cfCountry = req.headers.get('cf-ipcountry');
  if (cfCountry && cfCountry !== 'XX') {
    return { country: cfCountry, countryCode: cfCountry, city: 'Unknown' };
  }
  const isLocal = ['::1','127.0.0.1','0.0.0.0'].includes(ip) ||
    ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.');
  if (isLocal) {
    return { country: 'Localhost', countryCode: 'LH', city: 'Local' };
  }
  try {
    const res = await fetch(
      `http://ip-api.com/json/${ip}?fields=country,countryCode,city`,
      { signal: AbortSignal.timeout(2500) }
    );
    if (res.ok) {
      const data = await res.json();
      return {
        country:     data.country     || 'Unknown',
        countryCode: data.countryCode || 'XX',
        city:        data.city        || 'Unknown',
      };
    }
  } catch { /* timeout — pas grave */ }
  return { country: 'Unknown', countryCode: 'XX', city: 'Unknown' };
}

// ─── Payload validation ───────────────────────────────────────────────────────
interface TrackPayload {
  siteId: string; page: string;
  referrer?: string; title?: string; sessionId?: string; width?: number;
}

function isValid(body: unknown): body is TrackPayload {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  return typeof b.siteId === 'string' && b.siteId.length > 0 &&
         typeof b.page   === 'string' && b.page.length   > 0;
}

// ─── POST /api/track ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null);

    if (!isValid(body)) {
      return NextResponse.json(
        { error: 'Missing or invalid fields: siteId and page are required.' },
        { status: 400, headers: CORS }
      );
    }

    const ip  = getClientIP(req);
    const geo = await getGeo(req, ip);
    const ua  = req.headers.get('user-agent') || '';

    await writeToFirestore(body.siteId, {
      siteId:      body.siteId,
      page:        body.page,
      referrer:    body.referrer  || '',
      title:       body.title     || '',
      sessionId:   body.sessionId || '',
      width:       body.width     || 0,
      country:     geo.country,
      countryCode: geo.countryCode,
      city:        geo.city,
      userAgent:   ua,
    });

    return NextResponse.json({ ok: true }, { status: 200, headers: CORS });

  } catch (err) {
    console.error('[Poyne] Track error:', err);
    return NextResponse.json(
      { error: 'Internal server error', detail: String(err) },
      { status: 500, headers: CORS }
    );
  }
}

// ─── OPTIONS /api/track (CORS preflight) ─────────────────────────────────────
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
