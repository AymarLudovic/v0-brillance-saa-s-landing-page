"use client";

import { useState, useRef, useEffect } from "react";
import Script from "next/script";

// Types pour la structure
type DetectedElement = {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
};

type ChatMessage = {
  role: "user" | "model";
  text: string;
  isCode?: boolean;
};

export default function VibeCodingPlatform() {
  // --- STATES SCANNER ---
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isOpenCvReady, setIsOpenCvReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [elements, setElements] = useState<DetectedElement[]>([]);
  
  // --- STATES GEMINI & CHAT ---
  const [apiKey, setApiKey] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [promptInput, setPromptInput] = useState("");

  // --- STATES SANDBOX ---
  const [sandboxId, setSandboxId] = useState<string | null>(null);
  const [sandboxStatus, setSandboxStatus] = useState<string>("Inactif");
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState<string>("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ----------------------------------------------------------------------
  // 1. MOTEUR OPENCV (V6 - LE FIABLE)
  // ----------------------------------------------------------------------

  const rgbToHex = (r: number, g: number, b: number) => 
    "#" + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join("");

  const extractColor = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
    const cx = x + Math.floor(w / 2);
    const cy = y + Math.floor(h / 2);
    if (cx < 0 || cy < 0) return "#FFFFFF";
    const p = ctx.getImageData(cx, cy, 1, 1).data;
    return rgbToHex(p[0], p[1], p[2]);
  };

  const onOpenCvLoaded = () => {
    // @ts-ignore
    cv['onRuntimeInitialized'] = () => setIsOpenCvReady(true);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setImageSrc(event.target?.result as string);
      setElements([]);
      setTimeout(() => {
          const img = new Image();
          img.onload = () => drawOriginalImage(img);
          img.src = event.target?.result as string;
      }, 100);
    };
    reader.readAsDataURL(file);
  };

  const drawOriginalImage = (img: HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
  };

  const runDetection = () => {
    if (!isOpenCvReady || !canvasRef.current || !imageSrc) return;
    setIsProcessing(true);
    setElements([]);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const virtualCanvas = document.createElement('canvas');
    virtualCanvas.width = canvas.width;
    virtualCanvas.height = canvas.height;
    const virtualCtx = virtualCanvas.getContext('2d');
    if (!virtualCtx) return;

    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      virtualCtx.drawImage(img, 0, 0);

      try {
        // @ts-ignore
        let src = cv.imread(canvas);
        // @ts-ignore
        let gray = new cv.Mat();
        // @ts-ignore
        let blurred = new cv.Mat();
        // @ts-ignore
        let binary = new cv.Mat();

        // @ts-ignore
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
        // @ts-ignore
        cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0);
        // @ts-ignore
        cv.adaptiveThreshold(blurred, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

        // @ts-ignore
        let kernel = cv.Mat.ones(2, 2, cv.CV_8U); 
        // @ts-ignore
        cv.dilate(binary, binary, kernel, new cv.Point(-1, -1), 1);

        // @ts-ignore
        let contours = new cv.MatVector();
        // @ts-ignore
        let hierarchy = new cv.Mat();
        // @ts-ignore
        cv.findContours(binary, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

        const detectedItems: DetectedElement[] = [];
        ctx.strokeStyle = "#FF0000"; 
        ctx.lineWidth = 2;

        // @ts-ignore
        for (let i = 0; i < contours.size(); ++i) {
            let contour = contours.get(i);
            // @ts-ignore
            let perimeter = cv.arcLength(contour, true);
            // @ts-ignore
            let approx = new cv.Mat();
            // @ts-ignore
            cv.approxPolyDP(contour, approx, 0.01 * perimeter, true);

            // @ts-ignore
            let rect = cv.boundingRect(approx);
            let area = rect.width * rect.height;
            let canvasArea = canvas.width * canvas.height;

            if (area > 50 && area < (canvasArea * 0.99)) {
                const color = extractColor(virtualCtx, rect.x, rect.y, rect.width, rect.height);
                detectedItems.push({
                    id: i,
                    x: rect.x, y: rect.y, w: rect.width, h: rect.height,
                    color: color
                });
                ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
            }
            approx.delete();
        }

        detectedItems.sort((a, b) => a.y - b.y);
        setElements(detectedItems);

        src.delete(); gray.delete(); blurred.delete(); binary.delete();
        kernel.delete(); contours.delete(); hierarchy.delete();

      } catch (err) {
        console.error(err);
      } finally {
        setIsProcessing(false);
      }
    };
  };

  // ----------------------------------------------------------------------
  // 2. IA GEMINI (DIRECT GOOGLE API)
  // ----------------------------------------------------------------------

  const sendToGemini = async (customPrompt?: string, attachContext: boolean = false) => {
    if (!apiKey) {
        alert("Entre ta clé API Gemini (Google AI Studio) en bas à droite.");
        return;
    }

    setIsLoadingAI(true);
    let promptText = customPrompt || promptInput;
    
    // Si c'est un transfert d'analyse, on prépare le contexte
    if (attachContext && elements.length > 0) {
        const jsonContext = JSON.stringify(elements.map(e => ({
            type: "ui_block",
            position: { x: e.x, y: e.y },
            size: { width: e.w, height: e.h },
            detected_color: e.color
        })), null, 2);

        promptText = `
        ROLE: Tu es un Expert Développeur Next.js 15 & React.
        TACHE: Recréer cette interface UI à partir de l'image et des données JSON fournies.
        
        CONTRAINTES STRICTES:
        1. Utilise Next.js 15 (App Router).
        2. Utilise TypeScript.
        3. INTERDIT d'utiliser Tailwind CSS. Utilise des styles inline (style={{...}}) ou Styled-components pour la simplicité du fichier unique.
        4. Le code doit être RESPONSIVE. Utilise les positions JSON comme guide relatif (header en haut, sidebar à gauche), mais implémente-le avec Flexbox/Grid.
        5. Utilise les couleurs détectées dans le JSON.
        6. Si tu vois des icônes, utilise "lucide-react" ou des placeholders SVG.
        
        DONNÉES ANALYSÉES (JSON):
        ${jsonContext}

        INSTRUCTION UTILISATEUR:
        ${promptText}
        `;
    }

    const newMsg: ChatMessage = { role: "user", text: promptText };
    setChatMessages(prev => [...prev, newMsg]);
    setPromptInput("");

    try {
        // Préparation du payload Gemini
        const contentsParts = [{ text: promptText }];
        
        // Ajout de l'image si nécessaire
        if (attachContext && imageSrc) {
            const base64Image = imageSrc.split(",")[1];
            // @ts-ignore
            contentsParts.push({
                inlineData: {
                    mimeType: "image/png",
                    data: base64Image
                }
            });
        }

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=AIzaSyAUTVo3z54UWpX-So7hA284OWXEezNW5WA`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: contentsParts }]
            })
        });

        const data = await response.json();
        const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "Erreur: Pas de réponse de l'IA";

        setChatMessages(prev => [...prev, { role: "model", text: aiResponse, isCode: aiResponse.includes("```") }]);

    } catch (error) {
        console.error("Gemini Error:", error);
        setChatMessages(prev => [...prev, { role: "model", text: "Erreur de connexion à Gemini." }]);
    } finally {
        setIsLoadingAI(false);
    }
  };

  // ----------------------------------------------------------------------
  // 3. SANDBOX CONTROL (E2B via /api/sandbox)
  // ----------------------------------------------------------------------

  const callSandboxApi = async (action: string, payload: any = {}) => {
    setSandboxStatus(`Action: ${action}...`);
    try {
        const res = await fetch("/api/sandbox", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, sandboxId, ...payload })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Erreur API");
        
        // Mise à jour des logs si dispo
        if (data.stdout) setLogs(prev => prev + "\n" + data.stdout);
        if (data.stderr) setLogs(prev => prev + "\n[ERR] " + data.stderr);

        return data;
    } catch (e: any) {
        setSandboxStatus(`Erreur: ${e.message}`);
        console.error(e);
        return null;
    }
  };

  const handleCreateSandbox = async () => {
    const data = await callSandboxApi("create");
    if (data?.sandboxId) {
        setSandboxId(data.sandboxId);
        setSandboxStatus("Sandbox Prête (Next.js 15)");
    }
  };

  const handleDeployCode = async () => {
    if (!sandboxId) {
        alert("Crée d'abord une Sandbox !");
        return;
    }

    // 1. Trouver le dernier bloc de code dans le chat
    const lastCodeMsg = [...chatMessages].reverse().find(m => m.role === "model" && m.text.includes("```"));
    if (!lastCodeMsg) {
        alert("L'IA n'a pas encore généré de code !");
        return;
    }

    // Extraction basique du code (on suppose que c'est le fichier page.tsx)
    const codeMatch = lastCodeMsg.text.match(/```(?:typescript|tsx|javascript|js)?([\s\S]*?)```/);
    const codeContent = codeMatch ? codeMatch[1] : "";

    if (!codeContent) {
        alert("Code introuvable dans la réponse.");
        return;
    }

    setSandboxStatus("Écriture du fichier page.tsx...");
    
    // 2. Écrire le fichier
    await callSandboxApi("addFile", { 
        filePath: "app/page.tsx",
        content: codeContent
    });

    // 3. Build (Optionnel si on est en dev, mais mieux pour vérifier les erreurs)
    // setSandboxStatus("Build en cours...");
    // await callSandboxApi("build");

    // 4. Start
    setSandboxStatus("Démarrage du serveur...");
    const startData = await callSandboxApi("start");
    
    if (startData?.success && startData?.url) {
        setSandboxUrl(startData.url);
        setSandboxStatus("Serveur en ligne !");
    }
  };

  // Scroll auto du chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  return (
    <div className="h-screen flex flex-col bg-neutral-900 text-white font-sans overflow-hidden">
      <Script src="https://docs.opencv.org/4.8.0/opencv.js" onLoad={onOpenCvLoaded} />

      {/* HEADER */}
      <header className="h-14 border-b border-neutral-700 flex items-center justify-between px-6 bg-neutral-800 shrink-0">
        <div className="flex items-center gap-2">
            <h1 className="font-bold text-lg tracking-tight text-white">Vibe Coding <span className="text-red-500">Studio</span></h1>
            <span className="text-xs bg-neutral-700 px-2 py-0.5 rounded text-neutral-300">Next.js 15 Engine</span>
        </div>
        <div className="flex gap-3 items-center">
             <input 
                type="password" 
                placeholder="Clé API Gemini" 
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="bg-neutral-900 border border-neutral-600 rounded px-3 py-1 text-sm w-48 focus:border-red-500 outline-none"
             />
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* COLONNE 1 : ANALYSEUR VISUEL */}
        <div className="w-1/3 border-r border-neutral-700 flex flex-col bg-neutral-900">
            <div className="p-4 border-b border-neutral-700 flex justify-between items-center bg-neutral-800">
                <h2 className="font-bold text-sm">1. Scan UI</h2>
                <div className="flex gap-2">
                    <input type="file" onChange={handleImageUpload} className="hidden" id="fileUp"/>
                    <label htmlFor="fileUp" className="cursor-pointer bg-neutral-700 hover:bg-neutral-600 px-3 py-1 rounded text-xs">Upload</label>
                    <button onClick={runDetection} disabled={!imageSrc} className="bg-red-600 hover:bg-red-700 px-3 py-1 rounded text-xs font-bold">Scanner</button>
                </div>
            </div>
            
            <div className="flex-1 overflow-auto relative bg-black flex items-center justify-center p-4">
                <canvas ref={canvasRef} className="max-w-full shadow-2xl border border-neutral-800" />
                {!imageSrc && <p className="text-neutral-600">En attente d'image...</p>}
            </div>

            <div className="h-40 border-t border-neutral-700 bg-neutral-800 p-2 overflow-y-auto">
                <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-bold text-neutral-400">ÉLÉMENTS DÉTECTÉS ({elements.length})</span>
                    <button 
                        onClick={() => sendToGemini("Génère le code Next.js pour cette UI", true)}
                        disabled={elements.length === 0}
                        className="bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded text-xs flex items-center gap-1"
                    >
                        <span>Transférer au Chat</span>
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                    </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    {elements.map((el, i) => (
                        <div key={i} className="flex items-center gap-2 bg-neutral-700/50 p-1.5 rounded text-xs">
                            <div className="w-3 h-3 rounded-full" style={{backgroundColor: el.color}}></div>
                            <span className="font-mono text-neutral-400">{el.w}x{el.h}</span>
                            <span className="ml-auto font-mono text-neutral-500">{el.color}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>

        {/* COLONNE 2 : CHAT GEMINI */}
        <div className="w-1/3 border-r border-neutral-700 flex flex-col bg-neutral-800">
            <div className="p-3 border-b border-neutral-700 font-bold text-sm bg-neutral-800 flex justify-between">
                <span>2. AI Architect (Gemini)</span>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-neutral-900/50">
                {chatMessages.length === 0 && (
                    <div className="text-center text-neutral-500 mt-20 text-sm">
                        Scanne une image et clique sur "Transférer au Chat" pour commencer.
                    </div>
                )}
                {chatMessages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[90%] rounded-lg p-3 text-sm whitespace-pre-wrap ${
                            msg.role === "user" ? "bg-blue-900 text-blue-100" : "bg-neutral-700 text-neutral-200 border border-neutral-600"
                        }`}>
                            {msg.role === "model" && <span className="text-xs text-orange-400 font-bold block mb-1">GEMINI</span>}
                            {msg.text}
                        </div>
                    </div>
                ))}
                {isLoadingAI && <div className="text-neutral-500 text-xs animate-pulse">Gemini est en train de coder...</div>}
                <div ref={chatEndRef} />
            </div>

            <div className="p-3 bg-neutral-800 border-t border-neutral-700">
                <div className="flex gap-2">
                    <textarea 
                        value={promptInput}
                        onChange={(e) => setPromptInput(e.target.value)}
                        placeholder="Instructions pour l'IA..."
                        className="w-full bg-neutral-900 border border-neutral-600 rounded p-2 text-sm focus:border-blue-500 outline-none resize-none h-20"
                    />
                    <button 
                        onClick={() => sendToGemini()}
                        disabled={isLoadingAI || !apiKey}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 rounded font-bold disabled:opacity-50"
                    >
                        Envoyer
                    </button>
                </div>
            </div>
        </div>

        {/* COLONNE 3 : SANDBOX & PREVIEW */}
        <div className="w-1/3 flex flex-col bg-neutral-950">
             <div className="p-3 border-b border-neutral-800 flex justify-between items-center bg-neutral-900">
                <h2 className="font-bold text-sm text-green-400">3. Sandbox (Next.js 15)</h2>
                <div className="text-xs font-mono text-neutral-500">{sandboxId ? sandboxId.substring(0,8)+"..." : "No Sandbox"}</div>
            </div>

            {/* CONTROLS */}
            <div className="grid grid-cols-2 gap-2 p-4 border-b border-neutral-800 bg-neutral-900">
                <button 
                    onClick={handleCreateSandbox}
                    className="bg-neutral-700 hover:bg-neutral-600 p-2 rounded text-xs font-bold border border-neutral-600"
                >
                    1. Init Sandbox
                </button>
                <button 
                    onClick={handleDeployCode}
                    className="bg-green-700 hover:bg-green-600 text-white p-2 rounded text-xs font-bold border border-green-500"
                >
                    2. Push & Start
                </button>
            </div>

            {/* STATUS & LOGS */}
            <div className="p-2 bg-black text-xs font-mono text-green-500 border-b border-neutral-800 h-24 overflow-y-auto">
                <div>Status: {sandboxStatus}</div>
                <div className="opacity-70 whitespace-pre-wrap">{logs}</div>
            </div>

            {/* PREVIEW IFRAME */}
            <div className="flex-1 bg-white relative">
                {sandboxUrl ? (
                    <iframe 
                        src={sandboxUrl} 
                        className="w-full h-full border-none"
                        title="App Preview"
                    />
                ) : (
             <div className="flex items-center justify-center h-full text-neutral-400 text-sm bg-neutral-100">
                        <div className="text-center">
                            <p>L'aperçu de l'application s'affichera ici.</p>
                            <p className="text-xs mt-2 opacity-60">En attente de démarrage...</p>
                        </div>
                    </div>
                )}
            </div>
        </div>

      </div>
    </div>
  );
                  }
