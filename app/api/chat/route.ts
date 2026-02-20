import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { messages, useReasoner } = await request.json();

    // Choisir le modèle : reasoner pour raisonnement avancé, chat pour vitesse
    const model = useReasoner ? 'deepseek-reasoner' : 'deepseek-chat';

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: 'Erreur DeepSeek API', details: error },
        { status: response.status }
      );
    }

    const data = await response.json();
    const message = data.choices[0].message.content;

    return NextResponse.json({ message });

  } catch (error) {
    console.error('Erreur:', error);
    return NextResponse.json(
      { error: 'Erreur serveur' },
      { status: 500 }
    );
  }
      }
