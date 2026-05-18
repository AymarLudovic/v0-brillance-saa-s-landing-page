/**
 * app/api/presence/[siteId]/route.ts
 * Gère la présence en temps réel des visiteurs.
 *
 * POST /api/presence/{siteId}  → heartbeat (upsert)
 * GET  /api/presence/{siteId}  → visiteurs actifs (< 90s)
 */

import { NextRequest, NextResponse } from 'next/server';

const PROJECT  = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'artboxx';
const API_KEY  = process.env.NEXT_PUBLIC_FIREBASE_API_KEY    || 'AIzaSyDvWAR0JBl8U61rr_nXdU_E5eI6jZgcjbI';
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ─── Helpers REST Firestore ───────────────────────────────────────────────────

/**
 * Convertit un objet JS en champs Firestore REST.
 * lastSeen est forcé en timestampValue pour permettre les comparaisons
 * GREATER_THAN dans les queries.
 */
function toFields(obj: Record<string, unknown>) {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'lastSeen') {
      // IMPORTANT : doit être timestampValue pour que runQuery puisse le comparer
      fields[k] = { timestampValue: typeof v === 'string' ? v : new Date().toISOString() };
    } else if (typeof v === 'string')       fields[k] = { stringValue: v };
    else if (typeof v === 'number')         fields[k] = { integerValue: v };
    else if (typeof v === 'boolean')        fields[k] = { booleanValue: v };
    else                                    fields[k] = { stringValue: String(v ?? '') };
  }
  return fields;
}

function fromField(f: Record<string, unknown>): unknown {
  if ('stringValue'    in f) return f.stringValue;
  if ('integerValue'   in f) return Number(f.integerValue);
  if ('booleanValue'   in f) return f.booleanValue;
  if ('timestampValue' in f) return f.timestampValue; // retourné comme ISO string
  return null;
}

function fromDoc(doc: { fields?: Record<string, Record<string, unknown>> }) {
  if (!doc.fields) return {};
  return Object.fromEntries(Object.entries(doc.fields).map(([k, v]) => [k, fromField(v)]));
}

// ─── POST — heartbeat ─────────────────────────────────────────────────────────
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

    const country     = req.headers.get('x-vercel-ip-country')            || 'Unknown';
    const countryCode = req.headers.get('x-vercel-ip-country')            || 'XX';
    const rawCity     = req.headers.get('x-vercel-ip-city');
    const city        = rawCity ? decodeURIComponent(rawCity) : 'Unknown';

    // PATCH = create-or-update (pas besoin de vérifier si le doc existe)
    const docPath = `${BASE_URL}/analytics/${encodeURIComponent(siteId)}/presence/${encodeURIComponent(body.sessionId)}`;
    const fields  = [
      'sessionId','visitorId','isNew','page','title',
      'lastSeen','country','countryCode','city',
    ];
    const mask    = fields.map((f) => `updateMask.fieldPaths=${f}`).join('&');
    const patchUrl = `${docPath}?key=${API_KEY}&${mask}`;

    const fsRes = await fetch(patchUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: toFields({
          sessionId:   String(body.sessionId),
          visitorId:   String(body.visitorId  || ''),
          isNew:       Boolean(body.isNew),
          page:        String(body.page       || '/'),
          title:       String(body.title      || ''),
          lastSeen:    new Date().toISOString(), // → timestampValue dans toFields()
          country,
          countryCode,
          city,
        }),
      }),
    });

    if (!fsRes.ok) {
      const err = await fsRes.text();
      console.error('[Poyne] Presence PATCH error:', err);
      return NextResponse.json({ error: err }, { status: fsRes.status, headers: CORS });
    }

    return NextResponse.json({ ok: true }, { headers: CORS });
  } catch (err) {
    console.error('[Poyne] Presence POST error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500, headers: CORS });
  }
}

// ─── GET — visiteurs actifs (lastSeen dans les 90 dernières secondes) ─────────
export async function GET(
  _req: NextRequest,
  { params }: { params: { siteId: string } }
) {
  try {
    const { siteId } = params;

    // Fenêtre : 45 secondes (le heartbeat tourne toutes les 15s → 3 battements max)
    const cutoff = new Date(Date.now() - 45_000).toISOString();

    const parent = `projects/${PROJECT}/databases/(default)/documents/analytics/${encodeURIComponent(siteId)}`;
    const url    = `https://firestore.googleapis.com/v1/${parent}:runQuery?key=${API_KEY}`;

    const fsRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'presence' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'lastSeen' },
              op: 'GREATER_THAN_OR_EQUAL',
              // Même type que le stockage : timestampValue
              value: { timestampValue: cutoff },
            },
          },
          orderBy: [{ field: { fieldPath: 'lastSeen' }, direction: 'DESCENDING' }],
        },
      }),
    });

    if (!fsRes.ok) {
      const err = await fsRes.text();
      console.error('[Poyne] Presence GET error:', err);
      return NextResponse.json({ error: err }, { status: fsRes.status, headers: CORS });
    }

    const rows: Array<{
      document?: { fields?: Record<string, Record<string, unknown>> };
    }> = await fsRes.json();

    const visitors = rows
      .filter((r) => r.document)
      .map((r) => fromDoc(r.document!));

    return NextResponse.json({ visitors }, { headers: CORS });
  } catch (err) {
    console.error('[Poyne] Presence GET error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500, headers: CORS });
  }
}

// ─── DELETE — visiteur parti ──────────────────────────────────────────────────
// poyne.js envoie { sessionId } dans le body quand l'onglet se ferme / devient caché.
export async function DELETE(
  req: NextRequest,
  { params }: { params: { siteId: string } }
) {
  try {
    const body = await req.json().catch(() => null);
    const sessionId = body?.sessionId;
    if (!sessionId) return NextResponse.json({ ok: true }, { headers: CORS });

    const { siteId } = params;
    const docUrl = `${BASE_URL}/analytics/${encodeURIComponent(siteId)}/presence/${encodeURIComponent(sessionId)}?key=${API_KEY}`;
    await fetch(docUrl, { method: 'DELETE' });

    return NextResponse.json({ ok: true }, { headers: CORS });
  } catch (err) {
    console.error('[Poyne] Presence DELETE error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500, headers: CORS });
  }
}

// ─── OPTIONS ──────────────────────────────────────────────────────────────────
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
