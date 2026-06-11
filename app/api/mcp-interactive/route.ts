import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────
const ok  = (id: unknown, result: unknown) =>
  NextResponse.json({ jsonrpc: "2.0", id, result });
const err = (id: unknown, code: number, message: string) =>
  NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } });

// ── MCP Apps Extension identifier (SEP-1865) ─────────────────────────────────
const MCP_APPS_EXTENSION = "io.modelcontextprotocol/ui";
const UI_MIME_TYPE = "text/html;profile=mcp-app";

// ── UI Resource URIs ──────────────────────────────────────────────────────────
const UI = {
  barChart:     "ui://interactive/bar-chart.html",
  profileCard:  "ui://interactive/profile-card.html",
  colorPalette: "ui://interactive/color-palette.html",
};

// ── HTML UI Templates (self-contained, vanilla JS) ───────────────────────────
//
// Each HTML page listens for the MCP Apps postMessage protocol:
//   host → iframe: { jsonrpc:"2.0", method:"ui/notifications/tool-input", params:{ structuredContent:{...} } }
//   iframe → host: { jsonrpc:"2.0", method:"ui/ready" }   (signal ready)

function barChartHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0d0d18; font-family: sans-serif; display: flex;
         align-items: center; justify-content: center; min-height: 100vh; padding: 16px; }
  .card { background: linear-gradient(135deg,#1a1830,#0d0d18);
          border-radius: 12px; padding: 24px; width: 100%; max-width: 520px; }
  h2 { color: #F0EFF4; font-size: 15px; margin-bottom: 20px; text-align: center; }
  .chart { display: flex; align-items: flex-end; gap: 12px; height: 180px;
           border-left: 1px solid rgba(255,255,255,.12);
           border-bottom: 1px solid rgba(255,255,255,.12);
           padding: 0 12px 8px 8px; }
  .bar-wrap { display: flex; flex-direction: column; align-items: center; flex: 1; height: 100%; justify-content: flex-end; }
  .bar { width: 100%; border-radius: 4px 4px 0 0; transition: height .4s ease;
         position: relative; min-height: 4px; }
  .bar-val { color: #A78BFA; font-size: 10px; font-weight: 700; margin-bottom: 4px; }
  .bar-label { color: rgba(255,255,255,.5); font-size: 10px; margin-top: 6px; }
  #status { color: rgba(255,255,255,.3); font-size: 12px; text-align: center; margin-top: 16px; }
</style>
</head>
<body>
<div class="card">
  <h2 id="title">Waiting for data…</h2>
  <div class="chart" id="chart"></div>
  <div id="status">MCP App ready</div>
</div>
<script>
  const BAR_COLOR = "#7B61FF";

  function render(data) {
    document.getElementById("title").textContent = data.title || "Bar Chart";
    const labels = (data.labels || "").split(",").map(s => s.trim());
    const values = (data.values || "").split(",").map(s => parseFloat(s.trim()) || 0);
    const max = Math.max(...values, 1);
    const chart = document.getElementById("chart");
    chart.innerHTML = "";
    labels.forEach((label, i) => {
      const val = values[i] ?? 0;
      const pct = (val / max) * 100;
      const color = data.color || BAR_COLOR;
      chart.innerHTML += \`
        <div class="bar-wrap">
          <span class="bar-val">\${val}</span>
          <div class="bar" style="height:\${pct}%;background:\${color}"></div>
          <span class="bar-label">\${label}</span>
        </div>\`;
    });
    document.getElementById("status").textContent = labels.length + " bars rendered";
  }

  // Signal ready to host
  window.parent.postMessage({ jsonrpc:"2.0", method:"ui/ready", params:{} }, "*");

  // Listen for data from host
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg?.method === "ui/notifications/tool-input") {
      render(msg.params?.structuredContent || {});
    }
  });
</script>
</body>
</html>`;
}

function profileCardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0d0d18; font-family: sans-serif; display: flex;
         align-items: center; justify-content: center; min-height: 100vh; padding: 16px; }
  .card { background: linear-gradient(135deg,#1e1b3a,#12111f);
          border: 1px solid rgba(123,97,255,.25); border-radius: 14px;
          padding: 24px; width: 100%; max-width: 380px; }
  .header { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
  .avatar { width: 56px; height: 56px; border-radius: 50%; display: flex;
            align-items: center; justify-content: center;
            font-size: 20px; font-weight: 700; color: #fff; flex-shrink: 0; }
  .name { color: #F0EFF4; font-size: 17px; font-weight: 700; }
  .role { color: rgba(255,255,255,.45); font-size: 12px; margin-top: 2px; }
  .badge { background: rgba(123,97,255,.18); color: #A78BFA;
           font-size: 10px; font-weight: 600; padding: 3px 10px;
           border-radius: 10px; display: inline-block; margin-top: 4px; }
  .divider { height: 1px; background: rgba(255,255,255,.07); margin-bottom: 16px; }
  .stats { display: flex; gap: 0; }
  .stat { flex: 1; text-align: center; }
  .stat-val { color: #F0EFF4; font-size: 20px; font-weight: 800; }
  .stat-label { color: rgba(255,255,255,.4); font-size: 10px; margin-top: 2px; }
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <div class="avatar" id="avatar"></div>
    <div>
      <div class="name" id="name">—</div>
      <div class="role" id="role">—</div>
      <span class="badge">✦ MCP Live</span>
    </div>
  </div>
  <div class="divider"></div>
  <div class="stats" id="stats"></div>
</div>
<script>
  function render(d) {
    const name = d.name || "Unknown";
    const initials = name.split(" ").map(n => n[0] || "").slice(0,2).join("").toUpperCase();
    const color = d.color || "#7B61FF";
    document.getElementById("avatar").style.background = color;
    document.getElementById("avatar").textContent = initials;
    document.getElementById("name").textContent = name;
    document.getElementById("role").textContent = d.role || "";
    const stats = [
      { label: d.stat1_label||"Stat 1", value: d.stat1_value||"—" },
      { label: d.stat2_label||"Stat 2", value: d.stat2_value||"—" },
      { label: d.stat3_label||"Stat 3", value: d.stat3_value||"—" },
    ];
    document.getElementById("stats").innerHTML = stats.map(s =>
      \`<div class="stat"><div class="stat-val">\${s.value}</div><div class="stat-label">\${s.label}</div></div>\`
    ).join("");
  }
  window.parent.postMessage({ jsonrpc:"2.0", method:"ui/ready", params:{} }, "*");
  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg?.method === "ui/notifications/tool-input") render(msg.params?.structuredContent || {});
  });
</script>
</body>
</html>`;
}

function colorPaletteHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #111118; font-family: monospace; padding: 20px; min-height: 100vh; }
  .main { max-width: 460px; margin: 0 auto; }
  .swatch { height: 64px; border-radius: 10px; margin-bottom: 12px; }
  .info { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
  .hex { color: #F0EFF4; font-size: 22px; font-weight: 800; }
  .rgb { color: rgba(255,255,255,.35); font-size: 11px; margin-top: 4px; }
  .comp-wrap { text-align: right; }
  .comp { width: 56px; height: 40px; border-radius: 8px; display: inline-block; }
  .comp-label { color: rgba(255,255,255,.3); font-size: 9px; }
  .shades-label { color: rgba(255,255,255,.3); font-size: 10px; margin-bottom: 8px; }
  .shades { display: flex; gap: 6px; margin-bottom: 16px; }
  .shade { flex: 1; height: 40px; border-radius: 6px; }
  .lum-label { color: rgba(255,255,255,.3); font-size: 10px; margin-bottom: 4px; }
  .lum-bar { height: 6px; background: rgba(255,255,255,.06); border-radius: 3px; overflow: hidden; }
  .lum-fill { height: 100%; border-radius: 3px; }
</style>
</head>
<body>
<div class="main">
  <div class="swatch" id="swatch"></div>
  <div class="info">
    <div><div class="hex" id="hex">—</div><div class="rgb" id="rgb"></div></div>
    <div class="comp-wrap">
      <div class="comp" id="comp"></div>
      <div class="comp-label">complement</div>
    </div>
  </div>
  <div class="shades-label">SHADES</div>
  <div class="shades" id="shades"></div>
  <div class="lum-label" id="lum-label"></div>
  <div class="lum-bar"><div class="lum-fill" id="lum-fill"></div></div>
</div>
<script>
  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return {r,g,b};
  }
  function toHex(r,g,b) {
    return "#"+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,"0")).join("");
  }
  function render(d) {
    let hex = (d.hex||"#7B61FF").trim();
    if (!hex.startsWith("#")) hex = "#"+hex;
    const {r,g,b} = hexToRgb(hex);
    const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
    document.getElementById("swatch").style.background = hex;
    document.getElementById("hex").textContent = hex.toUpperCase();
    if (d.name) document.getElementById("hex").textContent += " — " + d.name;
    document.getElementById("rgb").textContent = \`rgb(\${r}, \${g}, \${b}) · Luminance: \${Math.round(lum*100)}%\`;
    document.getElementById("comp").style.background = toHex(255-r,255-g,255-b);
    // Shades
    const shades = [0.2,0.4,0.6,0.8,1.0,0.8,0.6,0.4].map((o,i) => {
      const sr = r*o + (1-o)*(i<4?255:0), sg = g*o + (1-o)*(i<4?255:0), sb = b*o + (1-o)*(i<4?255:0);
      return toHex(sr,sg,sb);
    });
    document.getElementById("shades").innerHTML = shades.map(c =>
      \`<div class="shade" style="background:\${c}"></div>\`).join("");
    document.getElementById("lum-label").textContent = "Luminance";
    document.getElementById("lum-fill").style.width = Math.round(lum*100)+"%";
    document.getElementById("lum-fill").style.background = hex;
  }
  window.parent.postMessage({ jsonrpc:"2.0", method:"ui/ready", params:{} }, "*");
  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg?.method === "ui/notifications/tool-input") render(msg.params?.structuredContent || {});
  });
</script>
</body>
</html>`;
}

// ── Tools definition (with _meta.ui.resourceUri) ─────────────────────────────
const TOOLS = [
  {
    name: "generate_bar_chart",
    description: "Generates an interactive bar chart from your data.",
    inputSchema: {
      type: "object",
      properties: {
        title:  { type: "string",  description: "Chart title" },
        labels: { type: "string",  description: "Comma-separated labels. Ex: Jan,Feb,Mar,Apr" },
        values: { type: "string",  description: "Comma-separated numbers. Ex: 120,340,280,450" },
        color:  { type: "string",  description: "Hex color for bars. Ex: #7B61FF" },
      },
      required: ["title", "labels", "values"],
    },
    _meta: { ui: { resourceUri: UI.barChart } },
  },
  {
    name: "create_profile_card",
    description: "Creates an interactive profile card with name, role and stats.",
    inputSchema: {
      type: "object",
      properties: {
        name:        { type: "string" },
        role:        { type: "string" },
        stat1_label: { type: "string" },
        stat1_value: { type: "string" },
        stat2_label: { type: "string" },
        stat2_value: { type: "string" },
        stat3_label: { type: "string" },
        stat3_value: { type: "string" },
        color:       { type: "string" },
      },
      required: ["name", "role"],
    },
    _meta: { ui: { resourceUri: UI.profileCard } },
  },
  {
    name: "show_color_palette",
    description: "Shows an interactive color palette with shades, complement, and luminance.",
    inputSchema: {
      type: "object",
      properties: {
        hex:  { type: "string", description: "Hex color code with #. Ex: #7B61FF" },
        name: { type: "string", description: "Color name (optional)" },
      },
      required: ["hex"],
    },
    _meta: { ui: { resourceUri: UI.colorPalette } },
  },
];

// ── Resources map (uri → HTML generator) ─────────────────────────────────────
const RESOURCES: Record<string, () => string> = {
  [UI.barChart]:     barChartHTML,
  [UI.profileCard]:  profileCardHTML,
  [UI.colorPalette]: colorPaletteHTML,
};

// ── Tool execution (returns content + structuredContent + _meta) ──────────────
function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {

    case "generate_bar_chart": {
      const title  = String(args.title  ?? "Chart");
      const labels = String(args.labels ?? "A,B,C");
      const values = String(args.values ?? "1,2,3");
      const color  = String(args.color  ?? "#7B61FF");
      const count  = labels.split(",").length;
      return {
        content: [{ type: "text", text: `📊 Bar chart "${title}" — ${count} bars` }],
        structuredContent: { title, labels, values, color },
        _meta: { ui: { resourceUri: UI.barChart } },
      };
    }

    case "create_profile_card": {
      const name = String(args.name ?? "John Doe");
      const role = String(args.role ?? "Developer");
      return {
        content: [{ type: "text", text: `🪪 Profile card for ${name} — ${role}` }],
        structuredContent: {
          name, role,
          color:       String(args.color       ?? "#7B61FF"),
          stat1_label: String(args.stat1_label ?? "Projects"),
          stat1_value: String(args.stat1_value ?? "—"),
          stat2_label: String(args.stat2_label ?? "Stars"),
          stat2_value: String(args.stat2_value ?? "—"),
          stat3_label: String(args.stat3_label ?? "Followers"),
          stat3_value: String(args.stat3_value ?? "—"),
        },
        _meta: { ui: { resourceUri: UI.profileCard } },
      };
    }

    case "show_color_palette": {
      let hex = String(args.hex ?? "#7B61FF").trim();
      if (!hex.startsWith("#")) hex = "#" + hex;
      if (!/^#[0-9A-Fa-f]{6}$/.test(hex))
        throw new Error(`Invalid hex color: ${hex}. Use format #RRGGBB`);
      const name = String(args.name ?? "");
      return {
        content: [{ type: "text", text: `🎨 Color palette for ${hex.toUpperCase()}${name ? ` — ${name}` : ""}` }],
        structuredContent: { hex, name },
        _meta: { ui: { resourceUri: UI.colorPalette } },
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  let body: { jsonrpc: string; id: unknown; method: string; params?: Record<string, unknown> };

  try {
    body = await req.json();
  } catch {
    return err(0, -32700, "Parse error: invalid JSON");
  }

  const { id, method, params = {} } = body;

  switch (method) {

    // ── Handshake: advertise MCP Apps extension capability ──────────────────
    case "initialize":
      return ok(id, {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools:     { listChanged: false },
          resources: { listChanged: false },
          extensions: {
            [MCP_APPS_EXTENSION]: { version: "1.0.0" },
          },
        },
        serverInfo: { name: "interactive-ui-tools", version: "2.0.0" },
      });

    // ── Tools list: includes _meta.ui.resourceUri on each tool ─────────────
    case "tools/list":
      return ok(id, { tools: TOOLS });

    // ── Tool call: returns content + structuredContent + _meta ──────────────
    case "tools/call": {
      const toolName = String(params.name ?? "");
      const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        return ok(id, callTool(toolName, toolArgs));
      } catch (e: unknown) {
        return err(id, -32000, e instanceof Error ? e.message : String(e));
      }
    }

    // ── Resources list: exposes all ui:// resources ─────────────────────────
    case "resources/list":
      return ok(id, {
        resources: Object.keys(RESOURCES).map(uri => ({
          uri,
          name: uri.split("/").pop()?.replace(".html", "") ?? uri,
          mimeType: UI_MIME_TYPE,
        })),
      });

    // ── Resources read: serves the HTML for a given ui:// URI ───────────────
    case "resources/read": {
      const uri = String(params.uri ?? "");
      const generator = RESOURCES[uri];
      if (!generator)
        return err(id, -32002, `Resource not found: ${uri}`);
      return ok(id, {
        contents: [{
          uri,
          mimeType: UI_MIME_TYPE,
          text: generator(),
        }],
      });
    }

    default:
      return err(id, -32601, `Method not found: ${method}`);
  }
}
