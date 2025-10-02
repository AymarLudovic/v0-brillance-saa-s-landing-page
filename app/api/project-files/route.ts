// app/api/project-files/route.ts
import { NextResponse } from "next/server";

const DEFAULT_CHUNK_SIZE = 4000;

export async function POST(req: Request) {
  try {
    const { action, filePath, files, chunkSize } = await req.json() as {
      action: "list" | "get" | "chunks";
      filePath?: string;
      files: { filePath: string; content: string }[];
      chunkSize?: number;
    };

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    // 1. LIST FILES
    if (action === "list") {
      const summary = files.map((f) => ({
        filePath: f.filePath,
        length: f.content.length,
        approxLines: f.content.split("\n").length,
      }));
      return NextResponse.json({ files: summary });
    }

    // 2. GET SINGLE FILE
    if (action === "get") {
      if (!filePath) return NextResponse.json({ error: "Missing filePath" }, { status: 400 });
      const file = files.find((f) => f.filePath === filePath);
      if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });
      return NextResponse.json({ filePath: file.filePath, content: file.content });
    }

    // 3. GET CHUNKS
    if (action === "chunks") {
      if (!filePath) return NextResponse.json({ error: "Missing filePath" }, { status: 400 });
      const file = files.find((f) => f.filePath === filePath);
      if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

      const size = chunkSize || DEFAULT_CHUNK_SIZE;
      const chunks: { chunkIndex: number; text: string }[] = [];
      for (let i = 0; i < file.content.length; i += size) {
        chunks.push({
          chunkIndex: i / size,
          text: file.content.substring(i, i + size),
        });
      }
      return NextResponse.json({ filePath: file.filePath, chunks });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
  }
    
