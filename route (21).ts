import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const IMAGE_EXTS = new Set([".jpg",".jpeg",".png",".webp",".svg",".gif",".avif",".bmp",".ico"]);

interface ImageEntry {
  id: string;    // slug derived from relative path, e.g. "images-hero-bg-jpg"
  name: string;  // filename, e.g. "hero-bg.jpg"
  path: string;  // public URL path, e.g. "/images/hero-bg.jpg"
}

function scanDir(dir: string, base: string, results: ImageEntry[]) {
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { return; }

  for (const entry of entries) {
    // Skip hidden files and node_modules
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      scanDir(full, path.join(base, entry), results);
    } else {
      const ext = path.extname(entry).toLowerCase();
      if (IMAGE_EXTS.has(ext)) {
        const urlPath = "/" + path.join(base, entry).replace(/\\/g, "/");
        const id = urlPath.replace(/^\//, "").replace(/[^a-zA-Z0-9]/g, "-");
        results.push({ id, name: entry, path: urlPath });
      }
    }
  }
}

export async function GET() {
  const publicDir = path.join(process.cwd(), "public");
  const images: ImageEntry[] = [];
  scanDir(publicDir, "", images);
  // Sort by path for stable order
  images.sort((a, b) => a.path.localeCompare(b.path));
  return NextResponse.json(images);
}
