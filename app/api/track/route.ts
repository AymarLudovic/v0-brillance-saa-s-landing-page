/**
 * app/api/track/route.ts
 * Receives pageview events from the poyne.js CDN script.
 * Saves to Firestore: analytics/{siteId}/pageviews/{autoId}
 */

import { NextRequest, NextResponse } from 'next/server';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// ─── CORS headers (required: tracker runs on 3rd-party domains) ──────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ─── IP extraction ────────────────────────────────────────────────────────────
function getClientIP(req: NextRequest): string {
  return (
    req.headers.get('x-vercel-forwarded-for') ||
    req.headers.get('cf-connecting-ip') ||           // Cloudflare
    req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    '0.0.0.0'
  );
}

// ─── Geo lookup ───────────────────────────────────────────────────────────────
// Priority 1: Vercel/Cloudflare edge headers (free, no extra API call)
// Priority 2: ip-api.com free tier (45 req/min, no key needed)
interface GeoResult {
  country: string;
  countryCode: string;
  city: string;
}

async function getGeo(req: NextRequest, ip: string): Promise<GeoResult> {
  // Vercel injects these headers at the edge → zero latency
  const vercelCountry = req.headers.get('x-vercel-ip-country');
  const vercelCity    = req.headers.get('x-vercel-ip-city');
  if (vercelCountry) {
    return {
      country:     decodeURIComponent(req.headers.get('x-vercel-ip-country-region') || vercelCountry),
      countryCode: vercelCountry,
      city:        vercelCity ? decodeURIComponent(vercelCity) : 'Unknown',
    };
  }

  // Cloudflare Workers / Pages
  const cfCountry = req.headers.get('cf-ipcountry');
  if (cfCountry && cfCountry !== 'XX') {
    return { country: cfCountry, countryCode: cfCountry, city: 'Unknown' };
  }

  // Localhost / private IPs
  const isLocal = ['::1', '127.0.0.1', '0.0.0.0'].includes(ip) ||
    ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.');
  if (isLocal) {
    return { country: 'Localhost', countryCode: 'LH', city: 'Local' };
  }

  // External fallback
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
  } catch { /* timeout or error — degrade gracefully */ }

  return { country: 'Unknown', countryCode: 'XX', city: 'Unknown' };
}

// ─── Payload validation ───────────────────────────────────────────────────────
interface TrackPayload {
  siteId:    string;
  page:      string;
  referrer?: string;
  title?:    string;
  sessionId?: string;
  width?:    number;
}

function isValid(body: unknown): body is TrackPayload {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  return typeof b.siteId === 'string' && b.siteId.length > 0 &&
         typeof b.page   === 'string' && b.page.length > 0;
}

// ─── POST /api/track ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null);

    if (!isValid(body)) {
      return NextResponse.json(
        { error: 'Missing or invalid fields: siteId, page are required.' },
        { status: 400, headers: CORS }
      );
    }

    const ip  = getClientIP(req);
    const geo = await getGeo(req, ip);
    const ua  = req.headers.get('user-agent') || '';

    await addDoc(
      collection(db, 'analytics', body.siteId, 'pageviews'),
      {
        siteId:      body.siteId,           // ← requis par les Firestore rules (isValidPageview)
        page:        body.page,
        referrer:    body.referrer   || '',
        title:       body.title      || '',
        sessionId:   body.sessionId  || '',
        width:       body.width      || 0,
        country:     geo.country,
        countryCode: geo.countryCode,
        city:        geo.city,
        userAgent:   ua,
        timestamp:   serverTimestamp(),
      }
    );

    return NextResponse.json({ ok: true }, { status: 200, headers: CORS });
  } catch (err) {
    console.error('[Poyne] Track error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: CORS }
    );
  }
}

// ─── OPTIONS /api/track (CORS preflight) ─────────────────────────────────────
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
    }
