"use client";
import { useState, useRef } from "react";

type Role = "user" | "assistant";
interface Msg { role: Role; content: string; htmlCode?: string; preview?: string; }

export default function Page() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat"|"preview">("chat");
  const [img, setImg] = useState<{file:File;url:string}|null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const send = async () => {
    const text = input.trim();
    if ((!text && !img) || loading) return;
    const userMsg: Msg = { role:"user", content: text || "Clone cette interface.", preview: img?.url };
    const next = [...msgs, userMsg];
    setMsgs(next); setInput(""); setLoading(true);
    const saved = img; setImg(null);
    const fd = new FormData();
    fd.append("message", userMsg.content);
    fd.append("history", JSON.stringify(msgs.map(m=>({role:m.role,content:m.content}))));
    if (saved) fd.append("image", saved.file);
    try {
      const r = await fetch("/api/chat", { method:"POST", body:fd });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      const a: Msg = { role:"assistant", content:d.content, htmlCode:d.htmlCode };
      setMsgs([...next, a]);
      if (d.htmlCode) { setHtml(d.htmlCode); setTab("preview"); }
    } catch(e:unknown) {
      setMsgs([...next, { role:"assistant", content:`⚠ ${e instanceof Error ? e.message:"Erreur"}` }]);
    } finally { setLoading(false); }
  };

  const pickImg = (f: File) => { setImg({file:f, url:URL.createObjectURL(f)}); };

  const c = {
    page:{ minHeight:"100vh", display:"flex", flexDirection:"column" as const, background:"#0c0c10", color:"#e8e4de", fontFamily:"system-ui,sans-serif" },
    header:{ padding:"12px 16px", borderBottom:"1px solid #1e1e28", display:"flex", alignItems:"center", justifyContent:"space-between", background:"#0c0c10", flexShrink:0 },
    badge:{ fontSize:"0.55rem", background:"rgba(99,102,241,0.15)", border:"1px solid rgba(99,102,241,0.3)", color:"#818cf8", padding:"2px 6px", borderRadius:4 },
    tab:(a:boolean)=>({ padding:"5px 14px", borderRadius:6, border:"none", fontSize:"0.72rem", fontWeight:600 as const, cursor:"pointer", background:a?"rgba(99,102,241,0.2)":"transparent", color:a?"#818cf8":"#404055" }),
    msgs:{ flex:1, overflowY:"auto" as const, padding:"16px", display:"flex", flexDirection:"column" as const, gap:12 },
    bubble:(r:Role)=>({ alignSelf:r==="user"?"flex-end" as const:"flex-start" as const, maxWidth:"85%", background:r==="user"?"rgba(255,255,255,0.04)":"rgba(99,102,241,0.07)", border:`1px solid ${r==="user"?"rgba(255,255,255,0.07)":"rgba(99,102,241,0.15)"}`, borderRadius:r==="user"?"14px 4px 14px 14px":"4px 14px 14px 14px", padding:"10px 13px", fontSize:"0.84rem", lineHeight:1.7, color:"#c0bbb0", whiteSpace:"pre-wrap" as const, wordBreak:"break-word" as const }),
    footer:{ padding:"10px 12px 16px", borderTop:"1px solid #1e1e28", background:"#0c0c10", flexShrink:0 },
    uploadBtn:{ width:42, height:42, borderRadius:10, border:"1px solid rgba(99,102,241,0.25)", background:"rgba(99,102,241,0.1)", color:"#818cf8", fontSize:20, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 },
    textarea:{ flex:1, background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10, padding:"10px 12px", color:"#e8e4de", fontSize:"0.86rem", fontFamily:"system-ui,sans-serif", resize:"none" as const, outline:"none", minHeight:42, maxHeight:120 },
    sendBtn:(on:boolean)=>({ width:42, height:42, borderRadius:10, border:"none", background:on?"linear-gradient(135deg,#6366f1,#8b5cf6)":"rgba(255,255,255,0.04)", color:on?"#fff":"#2a2a3a", fontSize:18, cursor:on?"pointer":"not-allowed", flexShrink:0 }),
    previewBtn:{ alignSelf:"flex-start" as const, marginTop:4, background:"rgba(99,102,241,0.12)", border:"1px solid rgba(99,102,241,0.25)", borderRadius:6, padding:"4px 12px", color:"#818cf8", fontSize:"0.7rem", cursor:"pointer" },
    barBtn:(accent:boolean)=>({ flex:1, padding:"9px", borderRadius:8, border:`1px solid ${accent?"rgba(99,102,241,0.25)":"#1e1e28"}`, background:accent?"rgba(99,102,241,0.1)":"transparent", color:accent?"#818cf8":"#404055", fontSize:"0.75rem", cursor:"pointer" }),
  };

  return (
    <div style={c.page}>
      <div style={c.header}>
        <div style={{ fontWeight:700, fontSize:"0.9rem", display:"flex", alignItems:"center", gap:8 }}>
          UI Cloner <span style={c.badge}>gemini-3-flash-preview</span>
        </div>
        <div style={{ display:"flex", gap:4 }}>
          <button style={c.tab(tab==="chat")} onClick={()=>setTab("chat")}>Chat</button>
          <button style={c.tab(tab==="preview")} onClick={()=>setTab("preview")}>
            Preview {html && <span style={{color:"#22c55e"}}> ●</span>}
          </button>
        </div>
      </div>

      {tab==="chat" ? (
        <>
          <div style={c.msgs}>
            {msgs.length===0 && <div style={{color:"#252535",textAlign:"center",marginTop:48,fontSize:"0.8rem"}}>📎 Upload une image pour cloner une interface</div>}
            {msgs.map((m,i)=>(
              <div key={i} style={{display:"flex",flexDirection:"column",alignItems:m.role==="user"?"flex-end":"flex-start",gap:4}}>
                {m.preview && <img src={m.preview} alt="" style={{height:52,borderRadius:6,border:"1px solid rgba(99,102,241,0.3)",objectFit:"cover"}}/>}
                <div style={c.bubble(m.role)}>{m.htmlCode?"✅ HTML généré — voir Preview":m.content}</div>
                {m.htmlCode && <button style={c.previewBtn} onClick={()=>{setHtml(m.htmlCode!);setTab("preview");}}>Voir le preview →</button>}
              </div>
            ))}
            {loading && <div style={{...c.bubble("assistant"),opacity:0.5}}>Analyse pixel par pixel…</div>}
          </div>

          <div style={c.footer}>
            {img && (
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                <img src={img.url} alt="" style={{height:52,borderRadius:6,border:"1px solid rgba(99,102,241,0.3)"}}/>
                <button onClick={()=>setImg(null)} style={{background:"#ef4444",border:"none",borderRadius:"50%",width:22,height:22,color:"#fff",cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
              </div>
            )}
            <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
              <button style={c.uploadBtn} onClick={()=>fileRef.current?.click()}>📎</button>
              <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f)pickImg(f);e.target.value="";}}/>
              <textarea style={c.textarea} value={input} rows={1} placeholder="Message ou instructions…" onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}/>
              <button style={c.sendBtn(!loading&&!!(input.trim()||img))} onClick={send}>↑</button>
            </div>
          </div>
        </>
      ) : (
        <div style={{flex:1,display:"flex",flexDirection:"column"}}>
          {html
            ? <iframe srcDoc={html} style={{flex:1,border:"none",width:"100%"}} sandbox="allow-scripts allow-same-origin" title="preview"/>
            : <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"#252535",fontSize:"0.8rem"}}>Aucun HTML généré pour l&apos;instant</div>
          }
          <div style={{padding:"8px 12px",background:"#0c0c10",borderTop:"1px solid #1e1e28",display:"flex",gap:8}}>
            <button onClick={()=>setTab("chat")} style={c.barBtn(false)}>← Chat</button>
            {html && <button onClick={()=>navigator.clipboard.writeText(html)} style={c.barBtn(true)}>Copier HTML</button>}
          </div>
        </div>
      )}

      <style>{`*{box-sizing:border-box;margin:0;padding:0}textarea::placeholder{color:#252535}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#1e1e2e;border-radius:2px}`}</style>
    </div>
  );
      }
