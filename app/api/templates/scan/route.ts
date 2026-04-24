// app/api/templates/scan/route.ts
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const IMG_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'];

export async function GET() {
  try {
    const dir = path.join(process.cwd(), 'public', 'templates');

    if (!fs.existsSync(dir)) {
      return NextResponse.json([]);
    }

    const files = fs
      .readdirSync(dir)
      .filter(f => IMG_EXTS.includes(path.extname(f).toLowerCase()))
      .map(f => ({
        id: f.replace(/[^a-zA-Z0-9_-]/g, '_'),
        name: f,
        path: `/templates/${f}`,
      }));

    return NextResponse.json(files);
  } catch (err) {
    console.error('[templates/scan]', err);
    return NextResponse.json([]);
  }
}
