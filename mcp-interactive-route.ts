import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ── JSON-RPC helpers ─────────────────────────────────────────────────────────

const ok  = (id: unknown, result: unknown) =>
  NextResponse.json({ jsonrpc: "2.0", id, result });
const err = (id: unknown, code: number, message: string) =>
  NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } });

// ── SVG Generators ───────────────────────────────────────────────────────────

function barChartSVG(
  data: { label: string; value: number }[],
  title: string,
  color = "#7B61FF"
): string {
  const W = 480, H = 280;
  const PAD = { top: 48, right: 20, bottom: 52, left: 44 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const maxVal  = Math.max(...data.map(d => d.value), 1);
  const step    = Math.ceil(maxVal / 4);
  const barW    = (chartW / data.length) * 0.6;
  const gap     = chartW / data.length;

  const yLines = Array.from({ length: 5 }, (_, i) => {
    const val = step * i;
    const y   = PAD.top + chartH - (val / maxVal) * chartH;
    return `
      <line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}"
            stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
      <text x="${PAD.left - 6}" y="${y + 4}" text-anchor="end"
            font-size="9" fill="rgba(255,255,255,0.3)" font-family="monospace">${val}</text>`;
  }).join("");

  const bars = data.map((d, i) => {
    const bH  = (d.value / maxVal) * chartH;
    const x   = PAD.left + gap * i + (gap - barW) / 2;
    const y   = PAD.top + chartH - bH;
    const hex = color;
    return `
      <rect x="${x}" y="${y}" width="${barW}" height="${bH}"
            fill="${hex}" rx="4" opacity="0.9"/>
      <rect x="${x}" y="${y}" width="${barW}" height="6"
            fill="rgba(255,255,255,0.25)" rx="4"/>
      <text x="${x + barW / 2}" y="${PAD.top + chartH + 18}" text-anchor="middle"
            font-size="10" fill="rgba(255,255,255,0.55)" font-family="sans-serif">${d.label}</text>
      <text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle"
            font-size="9" fill="${hex}" font-family="monospace" font-weight="bold">${d.value}</text>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"
      viewBox="0 0 ${W} ${H}" style="background:#141420;border-radius:12px">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1a1830"/>
        <stop offset="100%" stop-color="#0d0d18"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)" rx="12"/>
    <text x="${W / 2}" y="28" text-anchor="middle" font-size="14" font-weight="700"
          fill="#F0EFF4" font-family="sans-serif">${title}</text>
    ${yLines}
    <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + chartH}"
          stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
    <line x1="${PAD.left}" y1="${PAD.top + chartH}" x2="${W - PAD.right}" y2="${PAD.top + chartH}"
          stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
    ${bars}
  </svg>`;
}

function profileCardSVG(
  name: string,
  role: string,
  stats: { label: string; value: string }[],
  avatarColor = "#7B61FF"
): string {
  const W = 360, H = 200;
  const initials = name.split(" ").map(n => n[0] ?? "").slice(0, 2).join("").toUpperCase();

  const statItems = stats.slice(0, 3).map((s, i) => {
    const x = 20 + i * 110;
    return `
      <text x="${x}" y="162" font-size="18" font-weight="800" fill="#F0EFF4"
            font-family="sans-serif">${s.value}</text>
      <text x="${x}" y="178" font-size="10" fill="rgba(255,255,255,0.4)"
            font-family="sans-serif">${s.label}</text>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"
      viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#1e1b3a"/>
        <stop offset="100%" stop-color="#12111f"/>
      </linearGradient>
      <linearGradient id="av" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${avatarColor}"/>
        <stop offset="100%" stop-color="${avatarColor}88"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#card)" rx="14"/>
    <rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="none"
          stroke="rgba(123,97,255,0.25)" stroke-width="1" rx="14"/>
    <!-- Avatar -->
    <circle cx="44" cy="54" r="28" fill="url(#av)"/>
    <text x="44" y="61" text-anchor="middle" font-size="16" font-weight="700"
          fill="white" font-family="sans-serif">${initials}</text>
    <!-- Name & role -->
    <text x="84" y="46" font-size="16" font-weight="700" fill="#F0EFF4"
          font-family="sans-serif">${name}</text>
    <text x="84" y="64" font-size="11" fill="rgba(255,255,255,0.45)"
          font-family="sans-serif">${role}</text>
    <!-- Divider -->
    <line x1="20" y1="96" x2="${W - 20}" y2="96"
          stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
    <!-- Stats -->
    ${statItems}
    <!-- Badge -->
    <rect x="${W - 90}" y="18" width="72" height="22" rx="11"
          fill="rgba(123,97,255,0.18)"/>
    <text x="${W - 54}" y="33" text-anchor="middle" font-size="10" font-weight="600"
          fill="#A78BFA" font-family="sans-serif">✦ MCP Live</text>
  </svg>`;
}

function colorSwatchSVG(hex: string, name: string): string {
  // Parse hex to RGB
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const textColor = luminance > 0.5 ? "#1a1a1a" : "#ffffff";

  // Complementary color
  const compR = 255 - r, compG = 255 - g, compB = 255 - b;
  const comp = `#${compR.toString(16).padStart(2,"0")}${compG.toString(16).padStart(2,"0")}${compB.toString(16).padStart(2,"0")}`;

  // Shades
  const shades = [0.2, 0.4, 0.6, 0.8, 1.0, 0.8, 0.6, 0.4].map((o, i) => {
    const sr = Math.round(r * o + (1 - o) * (i < 4 ? 255 : 0));
    const sg = Math.round(g * o + (1 - o) * (i < 4 ? 255 : 0));
    const sb = Math.round(b * o + (1 - o) * (i < 4 ? 255 : 0));
    const sh = `#${sr.toString(16).padStart(2,"0")}${sg.toString(16).padStart(2,"0")}${sb.toString(16).padStart(2,"0")}`;
    return `<rect x="${20 + i * 52}" y="90" width="44" height="44" rx="6" fill="${sh}"/>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="200" viewBox="0 0 460 200">
    <rect width="460" height="200" fill="#111118" rx="12"/>
    <!-- Main swatch -->
    <rect x="20" y="20" width="200" height="60" rx="10" fill="${hex}"/>
    <text x="230" y="42" font-size="22" font-weight="800" fill="#F0EFF4"
          font-family="monospace">${hex.toUpperCase()}</text>
    <text x="230" y="62" font-size="12" fill="rgba(255,255,255,0.4)"
          font-family="sans-serif">${name || "Custom color"}</text>
    <text x="230" y="78" font-size="11" fill="rgba(255,255,255,0.3)"
          font-family="monospace">rgb(${r}, ${g}, ${b})</text>
    <!-- Complementary -->
    <rect x="350" y="20" width="90" height="60" rx="10" fill="${comp}"/>
    <text x="395" y="96" text-anchor="middle" font-size="9"
          fill="rgba(255,255,255,0.3)" font-family="sans-serif">complement</text>
    <!-- Shades label -->
    <text x="20" y="84" font-size="10" fill="rgba(255,255,255,0.3)"
          font-family="sans-serif">SHADES</text>
    ${shades}
    <!-- Luminance bar -->
    <rect x="20" y="150" width="420" height="6" rx="3" fill="rgba(255,255,255,0.06)"/>
    <rect x="20" y="150" width="${Math.round(luminance * 420)}" height="6" rx="3"
          fill="${hex}"/>
    <text x="20" y="172" font-size="10" fill="rgba(255,255,255,0.3)"
          font-family="sans-serif">Luminance: ${Math.round(luminance * 100)}%</text>
    <text x="240" y="172" font-size="10" fill="rgba(255,255,255,0.3)"
          font-family="sans-serif">Text on this color: 
      <tspan fill="${hex === "#ffffff" ? "#1a1a1a" : textColor === "#ffffff" ? "#aaa" : "#555"}">
        ${textColor === "#ffffff" ? "White ✓" : "Dark ✓"}
      </tspan>
    </text>
  </svg>`;
}

function toBase64(svg: string): string {
  return Buffer.from(svg, "utf-8").toString("base64");
}

// ── Tools definition ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "generate_bar_chart",
    description: "Generates a beautiful bar chart image from your data. Returns a visual SVG chart.",
    inputSchema: {
      type: "object",
      properties: {
        title:  { type: "string",  description: "Chart title" },
        labels: { type: "string",  description: "Comma-separated labels. Ex: Jan,Feb,Mar,Apr" },
        values: { type: "string",  description: "Comma-separated numbers. Ex: 120,340,280,450" },
        color:  { type: "string",  description: "Hex color for bars. Ex: #7B61FF (default violet)" },
      },
      required: ["title", "labels", "values"],
    },
  },
  {
    name: "create_profile_card",
    description: "Creates a visual profile card with name, role and stats. Returns an image.",
    inputSchema: {
      type: "object",
      properties: {
        name:        { type: "string", description: "Full name. Ex: Marie Dupont" },
        role:        { type: "string", description: "Job title. Ex: Senior Developer" },
        stat1_label: { type: "string", description: "First stat label. Ex: Projects" },
        stat1_value: { type: "string", description: "First stat value. Ex: 42" },
        stat2_label: { type: "string", description: "Second stat label. Ex: Stars" },
        stat2_value: { type: "string", description: "Second stat value. Ex: 1.2k" },
        stat3_label: { type: "string", description: "Third stat label. Ex: Followers" },
        stat3_value: { type: "string", description: "Third stat value. Ex: 890" },
        color:       { type: "string", description: "Avatar hex color. Ex: #00D68F" },
      },
      required: ["name", "role"],
    },
  },
  {
    name: "show_color_palette",
    description: "Generates a visual color palette showing shades, complement, RGB and luminance.",
    inputSchema: {
      type: "object",
      properties: {
        hex:  { type: "string", description: "Hex color code with #. Ex: #7B61FF" },
        name: { type: "string", description: "Color name (optional). Ex: Royal Purple" },
      },
      required: ["hex"],
    },
  },
];

// ── Tool execution ────────────────────────────────────────────────────────────

function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {

    case "generate_bar_chart": {
      const title   = String(args.title  ?? "Chart");
      const labels  = String(args.labels ?? "A,B,C").split(",").map(s => s.trim());
      const values  = String(args.values ?? "1,2,3").split(",").map(s => Number(s.trim()));
      const color   = String(args.color  ?? "#7B61FF");
      const data    = labels.map((label, i) => ({ label, value: values[i] ?? 0 }));
      const svg     = barChartSVG(data, title, color);
      const b64     = toBase64(svg);
      return {
        content: [
          { type: "text",  text: `📊 Bar chart "${title}" — ${data.length} bars` },
          { type: "image", data: b64, mimeType: "image/svg+xml" },
        ],
      };
    }

    case "create_profile_card": {
      const name  = String(args.name  ?? "John Doe");
      const role  = String(args.role  ?? "Developer");
      const color = String(args.color ?? "#7B61FF");
      const stats = [
        { label: String(args.stat1_label ?? "Projects"), value: String(args.stat1_value ?? "—") },
        { label: String(args.stat2_label ?? "Stars"),    value: String(args.stat2_value ?? "—") },
        { label: String(args.stat3_label ?? "Followers"),value: String(args.stat3_value ?? "—") },
      ];
      const svg = profileCardSVG(name, role, stats, color);
      const b64 = toBase64(svg);
      return {
        content: [
          { type: "text",  text: `🪪 Profile card for ${name} — ${role}` },
          { type: "image", data: b64, mimeType: "image/svg+xml" },
        ],
      };
    }

    case "show_color_palette": {
      let hex = String(args.hex ?? "#7B61FF").trim();
      if (!hex.startsWith("#")) hex = "#" + hex;
      if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) {
        throw new Error(`Invalid hex color: ${hex}. Use format #RRGGBB`);
      }
      const colorName = String(args.name ?? "");
      const svg = colorSwatchSVG(hex, colorName);
      const b64 = toBase64(svg);
      return {
        content: [
          { type: "text",  text: `🎨 Color palette for ${hex.toUpperCase()}${colorName ? ` — ${colorName}` : ""}` },
          { type: "image", data: b64, mimeType: "image/svg+xml" },
        ],
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
    case "initialize":
      return ok(id, {
        protocolVersion: "2024-11-05",
        capabilities:    { tools: { listChanged: false } },
        serverInfo:      { name: "interactive-ui-tools", version: "1.0.0" },
      });

    case "tools/list":
      return ok(id, { tools: TOOLS });

    case "tools/call": {
      const toolName = String(params.name ?? "");
      const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        return ok(id, callTool(toolName, toolArgs));
      } catch (e: unknown) {
        return err(id, -32000, e instanceof Error ? e.message : String(e));
      }
    }

    default:
      return err(id, -32601, `Method not found: ${method}`);
  }
}
