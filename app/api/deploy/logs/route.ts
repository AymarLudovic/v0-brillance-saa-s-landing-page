import { NextResponse } from 'next/server';
import { Vercel } from '@vercel/sdk';

export async function POST(req: Request) {
  try {
    const { deploymentId, token } = await req.json();

    if (!deploymentId || !token) {
      return NextResponse.json({ error: 'Missing info' }, { status: 400 });
    }

    // Initialisation du SDK Vercel
    const vercel = new Vercel({
      bearerToken: token,
    });

    // Appel magique du SDK pour récupérer les événements
    // On utilise les paramètres pour avoir l'historique complet
    const events = await vercel.deployments.getDeploymentEvents({
      idOrUrl: deploymentId,
      direction: "forward",
      limit: -1, // -1 pour tout récupérer
      // follow: 1, // On ne met pas follow ici car on fait du polling côté client
    });

    // Le SDK renvoie un itérateur asynchrone ou un tableau selon la config.
    // Ici, on transforme le résultat brut en tableau propre pour le JSON.
    const logs = [];
    
    for await (const event of events) {
        logs.push(event);
    }

    return NextResponse.json({ logs });

  } catch (error: any) {
    console.error("Vercel SDK Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
        }
