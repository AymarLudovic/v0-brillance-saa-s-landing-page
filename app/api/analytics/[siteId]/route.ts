/**
 * app/api/analytics/[siteId]/route.ts
 * Lit les pageviews depuis Firestore via REST API (pas de SDK).
 * Retourne un tableau de pageviews filtrés par période.
 */

import { NextRequest, NextResponse } from 'next/server';

const FIREBASE_PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'artboxx';
const FIREBASE_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY    || 'AIzaSyDvWAR0JBl8U61rr_nXdU_E5eI6jZgcjbI';

/** Extrait la valeur native d'un champ Firestore REST. */
function fromField(field: Record<string, unknown>): unknown {
  if ('stringValue'    in field) return field.stringValue;
  if ('integerValue'   in field) return Number(field.integerValue);
  if ('doubleValue'    in field) return Number(field.doubleValue);
  if ('booleanValue'   in field) return field.booleanValue;
  if ('timestampValue' in field) return field.timestampValue; // ISO string
  if ('nullValue'      in field) return null;
  return null;
}

/** Convertit un document Firestore REST en objet JS simple. */
function fromDoc(doc: { fields?: Record<string, Record<string, unknown>> }) {
  if (!doc.fields) return {};
  return Object.fromEntries(
    Object.entries(doc.fields).map(([k, v]) => [k, fromField(v)])
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: { siteId: string } }
) {
  const { siteId } = params;
  const { searchParams } = new URL(req.url);
  const days = Math.min(Number(searchParams.get('days') || '30'), 365);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  // ── Firestore runQuery (subcollection pageviews) ──────────────────────────
  const parent =
    `projects/${FIREBASE_PROJECT}/databases/(default)/documents/analytics/${encodeURIComponent(siteId)}`;

  const url = `https://firestore.googleapis.com/v1/${parent}:runQuery?key=${FIREBASE_API_KEY}`;

  const body = {
    structuredQuery: {
      from: [{ collectionId: 'pageviews' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'timestamp' },
          op: 'GREATER_THAN_OR_EQUAL',
          value: { timestampValue: startDate.toISOString() },
        },
      },
      orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'ASCENDING' }],
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[Poyne] Firestore read error:', err);
      return NextResponse.json({ error: err }, { status: res.status });
    }

    const rows: Array<{ document?: { fields?: Record<string, Record<string, unknown>> } }> = await res.json();

    // Firestore retourne un tableau ; chaque item peut être un "no document" result
    const pageviews = rows
      .filter((r) => r.document)
      .map((r) => fromDoc(r.document!));

    return NextResponse.json({ pageviews });
  } catch (err) {
    console.error('[Poyne] Analytics fetch error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
