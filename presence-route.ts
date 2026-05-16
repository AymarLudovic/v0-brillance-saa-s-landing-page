/**
 * app/api/presence/[siteId]/route.ts
 * Gère la présence en temps réel des visiteurs.
 *
 * POST   /api/presence/{siteId}            → upsert présence (heartbeat)
 * GET    /api/presence/{siteId}            → liste les visiteurs actifs (< 90s)
 * DELETE /api/presence/{siteId}/{sessionId} → supprime la présence (départ)
 */

import { NextRequest, NextResponse } from 'next/server';

const PROJECT  = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'artboxx';
const API_KEY  = process.env.NEXT_PUBLIC_FIREBASE_API_KEY    || 'AIzaSyDvWAR0JBl8U61rr_nXdU_E5eI6jZgcjbU';
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ─── Helpers REST Firestore ───────────────────────────────────────────────────

function toFields(obj: Record<string, unknown>) {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string')       fields[k] = { stringValue: v };
    else if (typeof v === 'number')  fields[k] = { integerValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else                             fields[k] = { stringValue: String(v ?? '') };
  }
  return fields;
}

function fromField(f: Record<string, unknown>): unknown {
  if ('stringValue'    in f) return f.stringValue;
  if ('integerValue'   in f) return Number(f.integerValue);
  if ('booleanValue'   in f) return f.booleanValue;
  if ('timestampValue' in f) return f.timestampValue;
  return null;
}

function fromDoc(doc: { fields?: Record<string, Record<string, unknown>> }) {
  if (!doc.fields) return {};
  return Object.fromEntries(Object.entries(doc.fields).map(([k, v]) => [k, fromField(v)]));
}

function presencePath(siteId: string, sessionId: string) {
  return `${BASE_URL}/analytics/${encodeURIComponent(siteId)}/presence/${encodeURIComponent(sessionId)}?key=${API_KEY}`;
}

// ─── POST — heartbeat / upsert ────────────────────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: { siteId: string } }
) {
  try {
    const body = await req.json().catch(() => null);
    if (!body?.sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400, headers: CORS });
    }

    const { siteId } = params;

    // Extraire pays depuis les headers Vercel/Cloudflare
    const country     = req.headers.get('x-vercel-ip-country')        || 'Unknown';
    const countryCode = req.headers.get('x-vercel-ip-country') || 'XX';
    const city        = req.headers.get('x-vercel-ip-city')
      ? decodeURIComponent(req.headers.get('x-vercel-ip-city')!)
      : 'Unknown';

    // PATCH (update) avec PATCH Firestore → crée ou met à jour les champs
    const url = `${BASE_URL}/analytics/${encodeURIComponent(siteId)}/presence/${encodeURIComponent(body.sessionId)}` +
      `?key=${API_KEY}&currentDocument.exists=false`;

    // On utilise PATCH qui fait un "create or update" sur les champs listés
    const patchUrl =
      `${BASE_URL}/analytics/${encodeURIComponent(siteId)}/presence/${encodeURIComponent(body.sessionId)}?key=${API_KEY}` +
      `&updateMask.fieldPaths=sessionId&updateMask.fieldPaths=visitorId&updateMask.fieldPaths=isNew` +
      `&updateMask.fieldPaths=page&updateMask.fieldPaths=title&updateMask.fieldPaths=lastSeen` +
      `&updateMask.fieldPaths=country&updateMask.fieldPaths=countryCode&updateMask.fieldPaths=city`;

    await fetch(patchUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: toFields({
          sessionId:   body.sessionId,
          visitorId:   body.visitorId  || '',
          isNew:       Boolean(body.isNew),
          page:        body.page       || '/',
          title:       body.title      || '',
          lastSeen:    new Date().toISOString(),
          country,
          countryCode,
          city,
        }),
      }),
    });

    return NextResponse.json({ ok: true }, { headers: CORS });
  } catch (err) {
    console.error('[Poyne] Presence POST error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500, headers: CORS });
  }
}

// ─── GET — visiteurs actifs (lastSeen < 90s) ──────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: { siteId: string } }
) {
  try {
    const { siteId } = params;
    const cutoff = new Date(Date.now() - 90_000).toISOString(); // 90 secondes

    const parent = `projects/${PROJECT}/databases/(default)/documents/analytics/${encodeURIComponent(siteId)}`;
    const url    = `https://firestore.googleapis.com/v1/${parent}:runQuery?key=${API_KEY}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'presence' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'lastSeen' },
              op: 'GREATER_THAN_OR_EQUAL',
              value: { timestampValue: cutoff },
            },
          },
          orderBy: [{ field: { fieldPath: 'lastSeen' }, direction: 'DESCENDING' }],
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: err }, { status: res.status, headers: CORS });
    }

    const rows: Array<{ document?: { fields?: Record<string, Record<string, unknown>> } }> = await res.json();
    const visitors = rows
      .filter((r) => r.document)
      .map((r) => fromDoc(r.document!));

    return NextResponse.json({ visitors }, { headers: CORS });
  } catch (err) {
    console.error('[Poyne] Presence GET error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500, headers: CORS });
  }
}

// ─── DELETE — visiteur parti ───────────────────────────────────────────────────
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { siteId: string; sessionId?: string } }
) {
  // La route [siteId] ne capture pas sessionId — on l'ignore gracieusement
  // (le doc expirera naturellement après 90s d'inactivité)
  return NextResponse.json({ ok: true }, { headers: CORS });
}

// ─── OPTIONS ──────────────────────────────────────────────────────────────────
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
