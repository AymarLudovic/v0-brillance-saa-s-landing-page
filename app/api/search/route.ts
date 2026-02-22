import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json();
    if (!query) return NextResponse.json({ error: 'query required' }, { status: 400 });

    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: true,
        include_raw_content: false,
      }),
    });

    if (!res.ok) throw new Error(`Tavily ${res.status}`);
    const data = await res.json();

    const results = (data.results ?? []).map((r: {
      title: string; url: string; content: string;
    }) => ({
      title: r.title,
      url: r.url,
      snippet: r.content?.slice(0, 280) ?? '',
    }));

    return NextResponse.json({ results, answer: data.answer ?? null });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Search failed' },
      { status: 500 }
    );
  }
        }
