// app/api/export-gdoc/route.ts
// Creates a Google Doc from markdown content and returns the URL
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

// ── Convert simple markdown to Google Docs batchUpdate requests ──────────────
function markdownToGdocRequests(markdown: string): any[] {
  const requests: any[] = [];
  let index = 1; // Google Docs content starts at index 1

  const lines = markdown.split("\n");

  for (const line of lines) {
    const text = line + "\n";

    // Determine paragraph style
    let namedStyleType = "NORMAL_TEXT";
    let cleanText = text;

    if (line.startsWith("# ")) {
      namedStyleType = "HEADING_1";
      cleanText = line.slice(2) + "\n";
    } else if (line.startsWith("## ")) {
      namedStyleType = "HEADING_2";
      cleanText = line.slice(3) + "\n";
    } else if (line.startsWith("### ")) {
      namedStyleType = "HEADING_3";
      cleanText = line.slice(4) + "\n";
    } else if (line.startsWith("#### ")) {
      namedStyleType = "HEADING_4";
      cleanText = line.slice(5) + "\n";
    }

    // Insert text
    requests.push({
      insertText: {
        location: { index },
        text: cleanText,
      },
    });

    // Apply paragraph style for headings
    if (namedStyleType !== "NORMAL_TEXT") {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: index, endIndex: index + cleanText.length },
          paragraphStyle: { namedStyleType },
          fields: "namedStyleType",
        },
      });
    }

    // Bold: **text**
    const boldRegex = /\*\*([^*]+)\*\*/g;
    let boldMatch;
    while ((boldMatch = boldRegex.exec(cleanText)) !== null) {
      const boldStart = index + boldMatch.index;
      const boldEnd = boldStart + boldMatch[0].length;
      // We can't do inline formatting retroactively easily here without tracking offsets
      // For simplicity, we'll leave inline formatting — the text is still readable
    }

    index += cleanText.length;
  }

  return requests;
}

export async function POST(req: NextRequest) {
  try {
    const { title, content, accessToken } = await req.json();

    if (!title || !content) {
      return NextResponse.json({ error: "title and content are required" }, { status: 400 });
    }

    if (!accessToken) {
      // Fallback: return a data URI for download if no token
      const blob = `data:text/plain;charset=utf-8,${encodeURIComponent(`${title}\n\n${content}`)}`;
      return NextResponse.json({
        error: "No Google access token provided. Sign in with Google to export.",
        fallback: blob,
      }, { status: 401 });
    }

    // 1. Create the document
    const createRes = await fetch("https://docs.googleapis.com/v1/documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      return NextResponse.json({ error: `Google Docs create failed: ${err}` }, { status: 502 });
    }

    const doc = await createRes.json();
    const documentId: string = doc.documentId;

    // 2. Insert content via batchUpdate
    const requests = markdownToGdocRequests(content);

    if (requests.length > 0) {
      const updateRes = await fetch(
        `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ requests }),
        }
      );

      if (!updateRes.ok) {
        // Document was created but content insert failed — still return the URL
        console.error("batchUpdate failed:", await updateRes.text());
      }
    }

    const url = `https://docs.google.com/document/d/${documentId}/edit`;
    return NextResponse.json({ url, id: documentId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
