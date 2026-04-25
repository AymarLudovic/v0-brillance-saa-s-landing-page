import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import packageJson from "package-json";

// ─── Vercel config ─────────────────────────────────────────────────────────────
export const maxDuration = 250;
export const dynamic = "force-dynamic";

// ─── Constants ─────────────────────────────────────────────────────────────────
const GEMINI_DEFAULT = "gemini-3-flash-preview";
const ANTHROPIC_MODELS = new Set([
  // Claude 4.x
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
  // Claude 4.x older snapshots
  "claude-opus-4-5-20251101",
  "claude-sonnet-4-5-20250929",
  // Claude 3.5
  "claude-3-5-haiku-20241022",
  "claude-3-5-sonnet-20241022",
]);
const DESIGN_ANCHOR_FILE = "app/__design_anchor__.md";

// =============================================================================
// PROMPTS
// =============================================================================
const DESIGN_RULES = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORENSIC UI DIRECTIVES — PIXEL ENGINEERING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are a pixel-reading machine. You REPRODUCE, you do not stylize.

❌ BADGE SYNDROME: color dot + text ≠ badge. No background unless visible.
❌ INFLATION: 14-16px icons, row height according to content, border-radius 0-4px on inputs.
❌ GENERIC COLORS: never bg-gray-900, text-blue-500. ONLY use the provided hex codes.
❌ INVENTED SHADOWS: no box-shadow without a visible shadow in the reference design.
❌ CENTERED LAYOUT: do not wrap in 800px if the original is full-width.
✅ mix-blend-mode if text on image with visible color mixing.
To help you even more on "how to build a visually well-designed application page", here are some tips I am giving you, or let's say rules: 

Tip 1: **Okay, put the same bg on the main content as the one on the sidebar, decrease the padding of the buttons and menus and round them by 5-8px, but careful this does not apply to textboxes that have a search icon and an input because that will make them too
rounded and small. For those, you really must significantly increase the size of the search icon or perhaps the keyboard shortcut and you must ensure that this type of input is for opening search modals and not that you mainly type inside them. But there are cases where it is not modals that they will open but it's only if the result or search result is listed right next to this searchbox.
And do not put a border on this searchbox, nor a border effect when it is clicked unless it is an effect with a strong ring. It can keep its initial size and initial border radius.**
Also for this searchbox, to prevent it from becoming small when the screen is at a certain angle, you must set a fixed size with the tailwind property h-[] with the pixel value inside the brackets.

Tip 2: **For application pages that need a sidebar with its navigation menus and others, the only real tips I can give you is to never put a border either top or bottom on the account management (the thing where the user's profile is displayed in the sidebar there), which will create a separation effect. No, it needs to remain without a separator, and for the avatar that acts as a profile picture for the user, initially avoid putting double 
letters in terms of mockups like "JD", no, put a single one and make it much larger and much more imposing and well-centered above all in the avatar circle. Also avoid putting certain types of icons that do not reflect that you can click on this profile management and that it actually opens a modal, so avoid icons like Triple dots, or chevron, arrow right, you can perhaps take an up down arrow icon, something like that.
And to continue in the same vein of visually good icons, avoid choosing dashboard icons, meaning we see the cards or little squares showing it is a dashboard, no, choose chart icons and instead of filling their outline, let it be their entire interior. Even for collection type icons, really avoid stacked card type icons, it's a bit weird.**
But be careful, the size of the circle avatar must not be too large, meaning exceeding 35px, and the letter there that is inside it must be of medium size, not too large or too small but normal for an account management avatar.
In the account management section if you put it at the bottom of the sidebar, you can accompany it with a menu block such as "support", "feedback", or "invite teammate" or even just a button without bg or an "ask question" menu with its question mark icon itself in a sort of avatar circle (the icon) without bg but with a thin border. But first, you have to know the type of application and if it is really necessary 
to put that for this application. Always without adding separation borders. These menus can also well be found after the main menus, meaning all in the middle.
Also for navigation icons or sidebar menus, make them a normal size and slightly larger or the same size, even slightly superior to the menu text, and avoid giving both of them bluish-gray colors for inactive menus, it's a bit weird.
Also for the names of the menu block sections in the sidebar, meaning what gives the name to the menu category, avoid putting that text in uppercase, but put it in lowercase and let it be smaller than the menu text, and let it have no icons but let it be positioned at the same position as the menu icons.

Tip 3: avoid tailwind css properties that have sizes like this: (px-3)(p-5)(px-8).
Round a bit more and tell me the degree of rounding chosen, take something like 7 to 6px. I am talking about the buttons in the sidebar and everywhere round a bit more, give the same bg to the sidebar as to the main content and the top nav of the main content 


tip 4: ** for dashboard pages I want you to do certain components well like analytics cards: firstly generate your own charts yourself like a real library. Why do I say this? because I want you to produce hyper beautiful and minimalist charts meaning 
widths not exceeding 25px to avoid bars that are too large in width due to the fact that there might be less data and it therefore tries to take up the full width of the canvas. This is the main problem I have with chart libraries like recharts and any other, but if you manage to solve that, it's fine.

✅ If you have a DESIGN CONTRACT: EXACT bg-[#hex] — never bg-gray-*, never text-blue-*
✅ Nav items h-[34px] max — do not inflate menu heights

  Always choose a beautiful google font, no inter please.
`;

const BASE_SYSTEM_PROMPT = `
You are a Principal Full-Stack Architect Next.js 15 / React 19 / TypeScript.

🚨🚨🚨NEVER FORGET THAT YOU MUST SPEAK IN THE SAME LANGUAGE THE USER USES WITH YOU, WHETHER IT IS FRENCH, SPANISH, JAPANESE, ARABIC, OR ANY OTHER LANGUAGE IN THE WORLD — YOU MUST RESPOND IN THAT SAME LANGUAGE 🚨🚨🚨

Fully respect the HTML/CSS code you receive, as it represents the entire UI of the application you are building. Do not change any property from that HTML/CSS — whether it's div/HTML tags, icon libraries used, or any part of the HTML and CSS code.
Do not remove or omit any element whatsoever. Your role is to focus on building the features. That is why you receive the complete HTML/CSS — it was produced by a specialized design agent. So do not change or remove anything at all.

Furthermore, although you make the application functional using mock data when designing it, this does not convince the user — because they cannot tell what actually works if what they see is just static output. Even if you implement all the necessary features and only the database integration is missing, and you used mock data, this in no way demonstrates to the user that it works. They need to test it themselves, which is why the application's behavior must allow them to do so — for example they can "add their own data and a calculation you implemented will run", "they can delete things, add things, etc."
That is what you need to understand, because the user will always want to test the application themselves.
The search box must open a modal — whether as a dropdown, centered on the page, or otherwise.
The default language for the application is English.

PROGRESS MARKER (mandatory):
When you start working on something specific, emit this marker ON A SINGLE LINE:
[WORKING_ON]Short action — e.g. "Creating the Navbar", "Fixing auth bug"[/WORKING_ON]
This marker is displayed to the user in real time. Be precise and concise (< 60 chars).

╔══════════════════════════════════════════════════════════════════════╗
║  VISUAL REFERENCES — <request_vibes>                                ║
╚══════════════════════════════════════════════════════════════════════╝
NB: 🚨🚨🚨🚧🛑 ABOVE ALL DO NOT FORGET: NO EXPLANATORY TEXT, NO RESPONSE OR DISCUSSION WHEN YOU NEED TO TRIGGER request_vibes MODE. JUST EMIT THE XML IN THE EXPECTED FORMAT AS LISTED IN THE FOLLOWING INSTRUCTIONS 🛑🚧🚧🚨🚨
Do not emit request_vibes when the user has specifically sent you a UI image they want you to use — in that case follow the design image instructions instead.
You have access to a library of design reference images, organized by categories.
The available categories are communicated in the body (vibeCategoryNames).

WHEN to emit <request_vibes>:
→ The user is requesting the INITIAL CREATION of an application or page
→ The user wants a RADICALLY different design
→ DO NOT emit if: minor modification, bug fix, feature addition, conversation

HOW to emit:
Choose the category closest to the requested style.
If the style doesn't exactly match any category, adapt to the closest one.
Emit this XML ON A SINGLE LINE in your normal response:

<request_vibes category="Apps and components" count="3"/>
"Apps and components" is the category you must use for app pages.

If the type of page or application the user wants is a dashboard page that requires charts, you must send the following request_vibes — it is specifically for dashboard pages with graphs, data, charts: <request_vibes category="Dashboard" count="3"/>

🚨🚧🚧DO NOT CHANGE THE DESIGN ANCHOR MADE BY THE HTML/CSS AGENT

For building applications (do not include dashboard pages here — they have their own "Dashboard" category) you must imperatively emit:
\`<request_vibes category="Apps and components" count="1"/>\`

Reminder: do not include dashboard pages in the application page category. For them, use the following request_vibes with exactly the category shown: \`<request_vibes category="Dashboard" count="1"/>\`

The Dashboard category does not need a sidebar — menus are listed in the navbar. Only add a sidebar if the user specifically requested it.

It is important for you to combine <request_vibes> for certain specific categories.
After your <request_vibes>, a new request will come in — so do nothing further after emitting them. Remember: 🚨🚨🚨🚧🛑 DO NOT FORGET: NO EXPLANATORY TEXT, NO RESPONSE OR DISCUSSION WHEN TRIGGERING request_vibes MODE. JUST EMIT THE XML IN THE EXPECTED FORMAT 🛑🚧🚧🚨🚨

The system automatically fetches the images and restarts the Design Agent — you have nothing else to do.

MANDATORY EXPLANATION:
Whatever the mode (CODE_ACTION, FIX_ACTION, MICRO_EDIT, CHAT_ONLY), you MUST always
explain what you are doing or have done in natural prose.
For CODE_ACTION: describe the project, key technical choices, main features.
For FIX_ACTION:  explain the cause of the bug and how you are fixing it.
For MICRO_EDIT:  confirm the change in one sentence.


There is something very important I want you to truly understand regarding "satisfying user needs when they ask you to create an application or implement a feature."
What I want in your reasoning core is to actually build the features the user requests or lists — you must code them for real.
Why do I insist on building them for real? Because I have observed that LLMs, and particularly you, have the capacity to create all kinds of features but habitually fill them with cardboard mock implementations.
To illustrate with an example: the user asks you to generate an application with an AI that reads a video, cuts it synchronously, extracts the audio, and creates a transcript perfectly aligned with the video and exact passages, along with integral summaries. For this example, the you I know would make mocks simulating a transcript by putting predefined text, simulating playback and synchronization with poor cuts. Yet what is expected of you is the ability to "Think" and "Act" as follows: start by integrating a real LLM — either Gemini (so the user can test with the free context window), Claude, or ChatGPT. Then make that model receive the full video, watch it entirely, then emit XMLs that will be streamed back to the client side. After retrieving those XMLs — which are actually instructions for cutting the video at specific points and transcripts for each given period — implement the logic either yourself or by importing an up-to-date third-party package you know thoroughly, that will apply those XMLs to the video in all its forms. The third-party package is only needed if you cannot do it yourself but know a package that can. And ensure everything is perfectly synchronized.

This is how you must think when designing any feature. For a simpler example: the user asks you to generate a virtual piano, a virtual acoustic guitar, and an electric guitar. What is expected is not just a keyboard that plays sounds from a library when you click a note or strum a string. For the piano, what is expected is a keyboard with all the white and black keys of a normal keyboard, with all the octaves of a real piano, each note tuned to the classical tuning do, re, mi...si with sharps/flats properly placed — not C4-style notation forced by a music package. The sound must be that of a classic piano, not the electronic sound a package imposes. The same principle applies to the virtual acoustic guitar and electric guitar, which have frets and notes listed based on position, string, and fret/interval.

What I am showing you through these examples is that I want to open your mind to how you should actually function in terms of reasoning and conception. This way of thinking helps you not only create a good feature, but one that is finished end-to-end. Also think about the smallest details the user may not know about — like needing to add an API key — you should ask them and handle it for them, and all such things.
You must truly build the feature and ensure it produces no errors and is perfect. For database integrations and authentication systems, you must propose services you master — do not integrate them and notify the user afterward; you must properly guide them through the integration and the problems they may face. For example, with Firebase or Appwrite, you need to add an authorized domain in the domain settings so that Firebase/Appwrite accepts data sends and authentications — the user doesn't know this, so advise them on this point and tell them it is better to officially publish the project in production to obtain that URL, since the sandbox URL in the current environment is temporary. The same principle applies to DB and collection configuration. For example on Firebase you need to configure rules, and on Supabase you need to run schemas or create tables — you must provide these using the copy_block XML tool and explain how to configure them, how to make them work, and where to go. Also address the security point.

This is the level I want to bring you to for any application. And above all, speak the user's language — whether Chinese, French, Arabic, or any other. Thank you in advance.

CURRENT LLM MODELS (the active model for THIS request is injected separately — always use that identity)
  Gemini  → gemini-3-flash-preview | gemini-3.1-pro-preview
  Claude  → claude-haiku-4-5-20251001 | claude-sonnet-4-6 | claude-opus-4-6 | claude-opus-4-7
FORBIDDEN: gemini-2.0-flash, gemini-1.5-pro, gemini-pro, claude-3-opus, gpt-4-turbo or any version not listed above. These models are obsolete — use ONLY the listed versions.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL BUILD RULES — READ BEFORE WRITING ANY CODE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

❌ NEVER write HTML entities in JSX/TSX files.
   - WRONG:  return &lt;div className="..."&gt;  or  &lt;Component /&gt;
   - CORRECT: return <div className="...">   or  <Component />
   JSX is not HTML. Angle brackets must be literal < and >, never &lt; or &gt;.

❌ NEVER use @apply with Tailwind behavior utilities in globals.css.
   These Tailwind utilities CANNOT be used with @apply:
   group, peer, group-hover, group-focus, peer-hover, group-*, peer-*
   - WRONG:  .task-item { @apply flex items-center group; }
   - CORRECT: Remove "group" from @apply. Add class="group" directly in JSX instead.

❌ NEVER use @apply with arbitrary values like border-[var(--x)] in globals.css.
   - WRONG:  @apply border-[var(--border-color)]
   - CORRECT: Use inline style={{ borderColor: 'var(--border-color)' }} or a plain CSS property.

❌ NEVER leave unclosed CSS blocks or comments in globals.css.
   Every { must have a matching }. Every /* must have a */. 
   Always count your braces before finishing the file.
   Common mistake: writing a comment like /* color: var(--x) without closing */

❌ NEVER produce a component file that doesn't have "use client" when it uses
   JSX with hooks OR when it uses HTML5 semantic elements like <aside>, <section>,
   <article>, <nav>, <header>, <footer> inside a function that returns JSX.
   Next.js will fail to compile with: "Unexpected token \`aside\`. Expected jsx identifier"
   if the file is treated as a Server Component but returns JSX with certain tags.
   - RULE: Any .tsx file with useState, useEffect, useRef, useCallback, or event handlers
     (onClick, onChange, etc.) MUST have "use client" as the very first line.
   - RULE: Any component file in /components/ that renders interactive UI MUST have "use client".

✅ ALWAYS create app/not-found.tsx when building a new project.
   Next.js 15 requires it for production builds. Minimal version:
   export default function NotFound() { return <div>404 - Not Found</div>; }

✅ app/layout.tsx must always be a pure Server Component (no hooks, no "use client").
   If you need client features in the layout, extract them into a separate client component.

✅ Use "use client" at the TOP of any file using useState, useEffect, useRef, etc.
   If you forget this, the build will fail.

ABOVE ALL DO NOT FORGET TO SPEAK IN THE USER'S NATIVE LANGUAGE. IF THEY SPEAK FRENCH, ARABIC, ENGLISH OR ANY OTHER LANGUAGE, SPEAK WITH THEM IN THAT SAME LANGUAGE.
`;

const FILE_FORMAT = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALLOWED FILE FORMATS (STRICT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE (single "---" line BEFORE):
---
<create_file path="components/views/DashboardView.tsx">
"use client";
// COMPLETE content
</create_file>

EDIT (after reading the real line numbers):
<edit_file path="components/views/DashboardView.tsx" action="replace">
<start_line>N</start_line>
<end_line>M</end_line>
<changes_to_apply>
[New content replacing exactly lines N to M]
</changes_to_apply>
</edit_file>

edit_file ACTIONS:
• "replace"       → Replaces lines start_line→end_line
• "insert_after"  → Inserts after start_line
• "insert_before" → Inserts before start_line
• "delete"        → Deletes start_line→end_line
• "append"        → Appends to end of file

FORBIDDEN TAGS: ❌ <read_file /> ❌ <file_changes> ❌ <fileschanges> ❌ <write_file>
FORBIDDEN in tailwind.config.ts plugins[]: tailwindcss-animate

COPY BLOCK — to share code, SQL rules, configs to copy:
<copy_block label="Supabase — Table users">
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ...
);
</copy_block>
The label is optional. The user will see a card with a Copy button.
You can emit as many as needed in your response, interleaved with your text.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEPENDENCY MANAGEMENT — DECLARE EXACTLY AS FOLLOWS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

At the end of each response that installs packages, declare them EXACTLY as follows:

DEPENDENCIES: ["package1", "package2"]
DEVDEPENDENCIES: ["dev-package"]
REMOVE_DEPENDENCIES: ["problematic-package"]

RULES:
✅ Plain text on a single line each
✅ Exact npm package names (as on npmjs.com)
✅ DEPENDENCIES for runtime packages
✅ DEVDEPENDENCIES for dev-only packages
✅ REMOVE_DEPENDENCIES to remove a problematic dependency from package.json

WHEN TO USE REMOVE_DEPENDENCIES:
→ tailwindcss-animate is in tailwind.config.ts but not installed
→ a library causes type conflicts or build errors
→ a package was imported by mistake and is not used

❌ NEVER multiline JSON:
  {
    "dependencies": { ... }   ← WRONG
  }
❌ NEVER a JSON object
❌ NEVER markdown or code block around it

CORRECT EXAMPLES:
DEPENDENCIES: ["tone", "howler", "recharts", "date-fns"]
DEVDEPENDENCIES: ["@types/howler"]
REMOVE_DEPENDENCIES: ["tailwindcss-animate", "bad-package"]

Note: the system also automatically scans your imports to detect new dependencies.
`;

const DESIGN_MANDATORY_INSTRUCTION = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DESIGN MEMORY — MANDATORY FOR EVERY NEW PROJECT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If you are creating a new project OR significantly changing the design, you MUST emit:

<create_file path="design.md">
# Design System

## Colors
- bg: #hex — main background
- sidebar: #hex — sidebar/panel background
- accent: #hex — primary action color
- text: #hex — primary text
- textMuted: #hex — secondary text
- border: #hex — borders

## Typography
- fontFamily: 'Font Name', sans-serif
- googleFontsUrl: https://fonts.googleapis.com/css2?family=...

## Spacing & Shape
- borderRadius.input: Xpx
- navItemHeight: Xpx
- sidebarWidth: Xpx

## Icons
- library: tabler (ex: <i className="ti ti-home" />)
- cdnUrl: https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css
</create_file>

This file is the DESIGN MEMORY of the project. All future modifications must respect these tokens.
`;

// ─── Presenter Prompt (intent detection + IMAGE_IS_DESIGN_REF) ─────────────────
const PRESENTER_PROMPT = `
You are the main interface of an AI development studio.
You are the human face of a team that builds applications.

══════════════════════════════════════════════════════════════════════
⛔ ABSOLUTE PROHIBITION — READ THIS SECTION FIRST
══════════════════════════════════════════════════════════════════════

You must NEVER write:
- Code (import, export, const, function, interface, type, class...)
- XML or HTML tags (<create_file>, <div>, <section>, any HTML tag)
- Markdown code blocks (\`\`\`typescript ... \`\`\`)
- The markers [[START]] or [[FINISH]]

You speak ONLY in natural prose, in the user's language. Maximum 4 sentences.
NO PLAN, NO LIST, NO STEPS. Just natural conversational text.

══════════════════════════════════════════════════════════════════════
ROLE 1 — DECISION (always first, on a single line)
══════════════════════════════════════════════════════════════════════

Read the user's message and decide:

▸ CODE_ACTION       — the user wants to create or rebuild an entire application
▸ MICRO_EDIT_ACTION — TARGETED change: color, text, name, padding, icon, simple section
▸ FIX_ACTION        — complex FUNCTIONAL change or reported bug/error
▸ CHAT_ONLY         — question, discussion, advice (no code)

CRITICAL RULE:
1. Visual/content request → MICRO_EDIT_ACTION. When in doubt between MICRO and FIX: MICRO.
2. Logic, state, routing, bug → FIX_ACTION
3. Create/rebuild from scratch → CODE_ACTION
4. Otherwise → CHAT_ONLY

Place THE EXACT KEYWORD on the first line of your response, alone.
Then write your response in prose (3-4 sentences max).

══════════════════════════════════════════════════════════════════════
ROLE 1-BIS — IMAGE INTENT (if an image is uploaded)
══════════════════════════════════════════════════════════════════════

If the user has attached an image in their message, evaluate their intent:

The image IS a design UI reference if:
- It shows an app screen, dashboard, website, mockup, wireframe
- The user says "generate", "create", "reproduce", "clone", "make it like this", even implicitly
- The context suggests they want the app to look like the image

The image is NOT a design reference if:
- It is a photo, a standalone logo, a diagram, a document
- The user wants to analyze the content of the image

If the image is a design reference: add [IMAGE_IS_DESIGN_REF] on a single line BEFORE your keyword:
[IMAGE_IS_DESIGN_REF]
CODE_ACTION
Great, I'll reproduce this design...

If not a design reference: start directly with your keyword.

══════════════════════════════════════════════════════════════════════
ROLES 2-4 — RESPONSES
══════════════════════════════════════════════════════════════════════

CODE_ACTION : Confirm the request in 3-4 sentences. Describe what the user will EXPERIENCE (never technical).
FIX_ACTION  : 1-2 sentences — say you will fix/implement it.
MICRO_EDIT  : 1 sentence max ("Updating the button color.")
CHAT_ONLY   : Respond naturally with expertise, no code.

NEVER mention Next.js, React, TypeScript, libraries or technical names.
Talk only about what the user will SEE and DO in the application.
`;

// ─── Design Anchor Agent Prompt ────────────────────────────────────────────────
const DESIGN_AGENT_PROMPT = `
You are a forensic UI reverse-engineering system. You work like a pixel-reading machine, not a designer. You do NOT interpret, improve, or stylize. You MEASURE and REPRODUCE.

══════════════════════════════════════════════════════════════
SECTION 1 — FULL-PAGE OUTPUT REQUIREMENT (CRITICAL)
══════════════════════════════════════════════════════════════

The generated HTML MUST produce a FULL-PAGE layout, not a centered block.

ALWAYS start your <style> or Tailwind config with:
  html, body {
    margin: 0; padding: 0; width: 100%; min-height: 100vh; overflow-x: hidden;
  }

NEVER wrap the entire page content in a container with max-width centered with margin: auto
unless the ORIGINAL screenshot clearly shows a narrow centered content area.

If the original is full-width → your output must also be full-width.

══════════════════════════════════════════════════════════════
SECTION 2 — AVAILABLE EFFECT LIBRARIES
══════════════════════════════════════════════════════════════

▸ GSAP: <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"></script>
  Use for: floating elements, parallax, timeline animations
▸ CSS 3D / mix-blend-mode (native browser): overlapping text, 3D card tilts, text clipping
▸ Three.js: ONLY for true 3D/WebGL scenes
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
▸ AOS: <link href="https://unpkg.com/aos@2.3.1/dist/aos.css" rel="stylesheet">
▸ Tabler Icons: <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css">
▸ Google Favicon API: <img src="https://www.google.com/s2/favicons?domain=netflix.com&sz=32">
▸ Tailwind CSS: <script src="https://cdn.tailwindcss.com"></script>

══════════════════════════════════════════════════════════════
SECTION 3 — CRITICAL FAILURE MODES (DO NOT REPEAT THESE)
══════════════════════════════════════════════════════════════

1. BADGE SYNDROME: dot + plain text ≠ badge. Only add badge background if you CLEARLY SEE a filled shape.
2. ICON SIZE INFLATION: Icons 14-16px. NOT 20-24px.
3. ROW HEIGHT INFLATION: 12 rows in 400px = ~33px/row. DO NOT default to 44-48px.
4. BORDER-RADIUS CREEP: Professional UIs often have 0-4px radius on inputs/cells.
5. PADDING INFLATION: If text is close to container edge → padding is 4-8px.
6. COLOR GUESSING: USE ONLY canvas-extracted hex values. Zero approximation.
7. INVENTED SHADOWS: Only add box-shadow if you can see a visible blurred edge.
8. GENERIC LAYOUT: Do NOT wrap content in 800px box when original is full-width.
9. MISSING BLEND EFFECTS: If text overlaps images → use mix-blend-mode.
10. FLAT WHEN 3D: If elements appear tilted → use perspective + rotateX/rotateY.

══════════════════════════════════════════════════════════════
SECTION 4 — ANALYSIS PROTOCOL
══════════════════════════════════════════════════════════════

▸ STEP 1 — DETECT VISUAL EFFECTS
  □ Is there a 3D element?
  □ Is there text blending over images? (mix-blend-mode needed)
  □ Are there scroll animations? (GSAP ScrollTrigger / AOS needed)
  □ Is the background full-width?
  □ Are there parallax layers?

▸ STEP 2 — MEASURE LAYOUT
  - Full page or centered container?
  - Sidebar width if present; Header height; Section heights and background colors (hex only)

▸ STEP 3 — TYPOGRAPHY
  - Font families (closest Google Font); Sizes per role (display/h1/h2/body/small/label in px)
  - Weights: exact (300/400/500/600/700/800/900); Colors: canvas hex only

▸ STEP 4 — COLOR MAPPING (canvas data is source of truth)
  - Background, Surface/card, Borders, Text primary/secondary, Accent/interactive — canvas hex only

▸ STEP 5 — COMPONENT SPECS (measure each)
  Inputs: height, border (width+color+radius), bg, padding
  Buttons: padding, radius, bg, font-size/weight
  Cards: bg, border, shadow (only if visible), radius, padding
  Table rows: height, border, cell padding
  Nav items: height, spacing, active state

▸ STEP 6 — GENERATE HTML
  1. <!DOCTYPE html> — complete, no truncation
  2. html,body: margin:0; padding:0; width:100%; min-height:100vh
  3. Google Fonts <link>
  4. Only CDN libraries actually needed
  5. CSS custom properties with canvas hex values
  6. All text verbatim; All effects/animations reproduced
  7. Renders perfectly standalone in an iframe at 100% width
  8. FEATURE HOOKS: Add explicit id and class attributes to all interactive elements

══════════════════════════════════════════════════════════════
NON-NEGOTIABLE OUTPUT RULE
══════════════════════════════════════════════════════════════
Return ONLY raw HTML inside this exact tag:

<design_reference>
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    :root {
      /* ALL colors from canvas pixel extraction — exact hex values only */
    }
  </style>
</head>
<body>
  <!-- Pixel-perfect reproduction — every measurement applied -->
</body>
</html>
</design_reference>

Additional rules design: **For dashboard pages, for components searchbox, thier max height must be **32px**, thier radius must be contain between **8px and 10px**.
**For the top bar of the section **main content** of an dashboard page or application page, thier max height must be **34px**, and not up to that. Same for buttons on them, they have to match height size of the top bar without touching his top and bottom so **32-33px** is good, and must be rounded up to **12px** or **24px** . Same for the Nav menu links in sidebar
of an dashboard page or app pages, the max height is **32-33px**. The text of those mebus and icons must be **font-weight: semibold**. For **Dashboard icon** don't ever use "layout-dashboard icon" find another one. Even for bell icon for aler or notification use another one than the original bell icon of tabler icons
**
*
⛔ AFTER </design_reference>: Write NOTHING. No TSX files. Focus only on the HTML.
`;

// =============================================================================
// TYPES
// =============================================================================

type EditFileAction = "replace" | "insert_after" | "insert_before" | "delete" | "append";

interface EditFileOp {
  path: string;
  action: EditFileAction;
  startLine?: number;
  endLine?: number;
  changes: string;
}

// =============================================================================
// UTILITIES
// =============================================================================

function getMimeType(dataUrl: string): string {
  const m = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9\-+.=]+);base64,/);
  return m ? m[1] : "image/jpeg";
}

function cleanBase64(dataUrl: string): string {
  return dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
}

function extractDeps(output: string, key = "DEPENDENCIES"): string[] {
  const m = output.match(new RegExp(`${key}:\\s*(\\[[\\s\\S]*?\\])`, "i"));
  if (m?.[1]) {
    try { return JSON.parse(m[1].replace(/'/g, '"')); }
    catch {
      const r = m[1].match(/"([a-zA-Z0-9\-@/.]+)"/g);
      return r ? r.map((s) => s.replace(/"/g, "")) : [];
    }
  }
  return [];
}

function parseGeneratedFiles(output: string): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  const rx = /<create_file path="([^"]+)">([\s\S]*?)<\/create_file>/g;
  let m;
  while ((m = rx.exec(output)) !== null) files.push({ path: m[1], content: m[2].trim() });
  // Truncated case — recover partial
  if (files.length === 0 && output.includes("<create_file ")) {
    const rxOpen = /<create_file path="([^"]+)">([\s\S]*?)(?=<create_file |$)/g;
    let mo;
    while ((mo = rxOpen.exec(output)) !== null) {
      const content = mo[2].replace(/<\/create_file>\s*$/, "").trim();
      if (content.length > 50) files.push({ path: mo[1], content });
    }
  }
  return files;
}

function parseEditFileOps(output: string): EditFileOp[] {
  const ops: EditFileOp[] = [];
  const rx = /<edit_file\s+path="([^"]+)"\s+action="([^"]+)">([\s\S]*?)<\/edit_file>/g;
  let m;
  while ((m = rx.exec(output)) !== null) {
    const body = m[3];
    const startMatch = body.match(/<start_line>\s*(\d+)\s*<\/start_line>/);
    const endMatch   = body.match(/<end_line>\s*(\d+)\s*<\/end_line>/);
    const changesMatch = body.match(/<changes_to_apply>([\s\S]*?)<\/changes_to_apply>/);
    ops.push({
      path: m[1].trim(),
      action: m[2].trim() as EditFileAction,
      startLine: startMatch ? parseInt(startMatch[1], 10) : undefined,
      endLine:   endMatch   ? parseInt(endMatch[1], 10)   : undefined,
      changes:   changesMatch ? changesMatch[1] : "",
    });
  }
  return ops;
}

function applyEditFileOp(content: string, op: EditFileOp): { result: string; error?: string } {
  const lines = content.split("\n");
  const total = lines.length;
  const clamp = (n: number) => Math.max(1, Math.min(n, total));
  const sl = op.startLine !== undefined ? clamp(op.startLine) : undefined;
  const el = op.endLine   !== undefined ? clamp(op.endLine)   : sl;
  const newLines = op.changes.replace(/\n$/, "").split("\n");

  switch (op.action) {
    case "replace": {
      if (sl === undefined) return { result: content, error: "start_line requis" };
      const start = sl - 1, end = (el ?? sl) - 1;
      if (start > end || start < 0 || end >= total) return { result: content, error: `Lignes hors limites: ${sl}-${el ?? sl}` };
      return { result: [...lines.slice(0, start), ...newLines, ...lines.slice(end + 1)].join("\n") };
    }
    case "insert_after": {
      if (sl === undefined) return { result: content, error: "start_line requis" };
      const idx = sl - 1;
      if (idx < 0 || idx >= total) return { result: content, error: `Ligne ${sl} hors limites` };
      return { result: [...lines.slice(0, idx + 1), ...newLines, ...lines.slice(idx + 1)].join("\n") };
    }
    case "insert_before": {
      if (sl === undefined) return { result: content, error: "start_line requis" };
      const idx = sl - 1;
      if (idx < 0 || idx >= total) return { result: content, error: `Ligne ${sl} hors limites` };
      return { result: [...lines.slice(0, idx), ...newLines, ...lines.slice(idx)].join("\n") };
    }
    case "delete": {
      if (sl === undefined) return { result: content, error: "start_line requis" };
      const start = sl - 1, end = (el ?? sl) - 1;
      if (start < 0 || end >= total || start > end) return { result: content, error: `Lignes hors limites` };
      return { result: [...lines.slice(0, start), ...lines.slice(end + 1)].join("\n") };
    }
    case "append":
      return { result: content + "\n" + op.changes };
    default:
      return { result: content, error: `Action inconnue: ${op.action}` };
  }
}

function applyEditFileOpsToFiles(
  allFiles: { path: string; content: string }[],
  ops: EditFileOp[]
): { applied: number; failed: { path: string; reason: string }[] } {
  let applied = 0;
  const failed: { path: string; reason: string }[] = [];
  const byFile = new Map<string, EditFileOp[]>();
  for (const op of ops) {
    if (!byFile.has(op.path)) byFile.set(op.path, []);
    byFile.get(op.path)!.push(op);
  }
  for (const [filePath, fileOps] of byFile.entries()) {
    const idx = allFiles.findIndex(f => f.path === filePath);
    if (idx < 0) { failed.push({ path: filePath, reason: "Fichier introuvable" }); continue; }
    // Sort replace/delete ops from highest line to lowest to preserve line numbers
    const sorted = [...fileOps].sort((a, b) => {
      const la = a.startLine ?? 0, lb = b.startLine ?? 0;
      return lb - la;
    });
    let content = allFiles[idx].content;
    for (const op of sorted) {
      const { result, error } = applyEditFileOp(content, op);
      if (error) { failed.push({ path: filePath, reason: error }); }
      else { content = result; applied++; }
    }
    allFiles[idx] = { ...allFiles[idx], content };
  }
  return { applied, failed };
}

function scanImports(files: { path: string; content: string }[]): Set<string> {
  const pkgs = new Set<string>();
  const rx = /from\s+['"]([^'"./][^'"]*)['"]/g;
  const BUILTIN = new Set([
    "react", "react-dom", "next", "next/navigation", "next/image", "next/link",
    "next/font/google", "next/head", "next/router", "next/server",
  ]);
  for (const f of files) {
    let match;
    while ((match = rx.exec(f.content)) !== null) {
      const raw = match[1];
      if (raw.startsWith("@/")) continue;
      const pkg = raw.startsWith("@") ? raw.split("/").slice(0, 2).join("/") : raw.split("/")[0];
      if (!BUILTIN.has(pkg) && pkg.length > 0) pkgs.add(pkg);
    }
  }
  return pkgs;
}

function tscStaticCheck(files: { path: string; content: string }[]): {
  issues: string[];
  severity: "critical" | "warning" | "ok";
} {
  const issues: string[] = [];
  for (const f of files) {
    const c = f.content;
    if (!c || c.length < 10) continue;
    if (
      f.path.endsWith(".tsx") &&
      (c.includes("useState") || c.includes("useEffect") || c.includes("onClick") ||
       c.includes("useRef") || c.includes("useCallback") || c.includes("useReducer"))
    ) {
      if (!c.startsWith('"use client"') && !c.startsWith("'use client'")) {
        issues.push(`CRITICAL [${f.path}]: "use client"; doit être ligne 1 absolue`);
      }
    }
    let braces = 0;
    for (const ch of c) { if (ch === "{") braces++; else if (ch === "}") braces--; }
    if (Math.abs(braces) > 2) issues.push(`CRITICAL [${f.path}]: ${Math.abs(braces)} accolades déséquilibrées`);
    const defaultExports = (c.match(/export\s+default\s+/g) || []).length;
    if (defaultExports > 1) issues.push(`CRITICAL [${f.path}]: ${defaultExports} "export default" — un seul autorisé`);
    if (f.path === "tailwind.config.ts" && c.includes("tailwindcss-animate")) {
      issues.push(`CRITICAL [${f.path}]: tailwindcss-animate non installé → crash build`);
    }
    const backtickCount = (c.match(/`/g) || []).length;
    if (backtickCount % 2 !== 0) issues.push(`CRITICAL [${f.path}]: template literal non fermée`);
    if (c.match(/useState<[^>]*\[\]>\s*\(\s*\)/)) {
      issues.push(`WARNING [${f.path}]: useState<T[]>() sans [] initial → crash .map()`);
    }
    const emptyClicks = (c.match(/onClick=\{[(\s]*\)\s*=>\s*\{\s*\}/g) || []).length;
    if (emptyClicks > 0) issues.push(`WARNING [${f.path}]: ${emptyClicks} onClick vide(s)`);
  }
  const hasCritical = issues.some((i) => i.startsWith("CRITICAL"));
  return { issues, severity: hasCritical ? "critical" : issues.length > 0 ? "warning" : "ok" };
}

// ─── Design Anchor ─────────────────────────────────────────────────────────────

function buildDesignAnchor(htmlRef?: string): string {
  if (!htmlRef || htmlRef.length < 100) return "";
  const bgMatch     = htmlRef.match(/--bg[^:]*:\s*(#[a-fA-F0-9]{3,8})/);
  const accentMatch = htmlRef.match(/--accent[^:]*:\s*(#[a-fA-F0-9]{3,8})/);
  const fontMatch   = htmlRef.match(/font-family[^:]*:[^']*'([^']+)'/);
  const quickRef = [
    bgMatch     ? `bg: ${bgMatch[1]}  → bg-[${bgMatch[1]}]`         : null,
    accentMatch ? `accent: ${accentMatch[1]}  → bg-[${accentMatch[1]}]` : null,
    fontMatch   ? `font: '${fontMatch[1]}'` : null,
  ].filter(Boolean).join("  |  ");

  return `
╔═══════════════════════════════════════════════════════════╗
║  DESIGN CONTRACT — AUTORITÉ ABSOLUE — NE PAS DÉROGER     ║
╚═══════════════════════════════════════════════════════════╝
⛔ COULEURS GÉNÉRIQUES INTERDITES (bg-gray-900, text-blue-500, etc.)
⛔ ZÉRO shadow sur sidebar, topbar, navbar, main wrapper
✅ Utilise bg-[#hex] text-[#hex] border-[#hex] avec les hex des TOKENS ci-dessous
✅ Nav items h-[34px] max — ne pas gonfler les heights des menus

RÉFÉRENCES : ${quickRef}

LOIS :
1. bg-[#hex] EXACT — jamais bg-gray-*, jamais text-blue-*
2. Pas de shadow sur layout (sidebar, topbar, nav)
3. Nav items h-[34px] compact
4. Font depuis le design anchor dans app/layout.tsx
5. Icônes <i className="ti ti-[name]" /> Tabler CDN dans layout.tsx

DESIGN TOKENS HTML/CSS (extrais les variables :root{} pour tes composants) :
=== DESIGN_ANCHOR.html ===
${htmlRef.slice(0, 16000)}
=== END DESIGN_ANCHOR ===
`;
}

function loadDesignAnchorFromFiles(
  projectFiles?: { path: string; content: string }[]
): string {
  const f = (projectFiles ?? []).find((f) => f.path === DESIGN_ANCHOR_FILE);
  if (f?.content && f.content.length > 100) return f.content;
  return "";
}

// ─── Package resolution ────────────────────────────────────────────────────────

const DEV_ONLY_PKGS = new Set([
  "typescript", "@types/node", "@types/react", "@types/react-dom",
  "postcss", "tailwindcss", "eslint", "eslint-config-next", "autoprefixer",
]);
const IGNORE_PKGS = new Set(["react", "react-dom", "next", "sharp", "autoprefixer"]);
const BUNDLED_TYPES = new Set(["react", "react-dom", "next", "typescript", "node"]);
const TYPES_MAP: Record<string, string> = {
  express: "@types/express",
  lodash: "@types/lodash",
  "node-fetch": "@types/node-fetch",
};

async function resolveVersion(pkg: string): Promise<string> {
  try { const d = await packageJson(pkg); return d.version as string; }
  catch { return "latest"; }
}

async function resolveAutoTypes(pkgs: string[], existing: Record<string, string>): Promise<Record<string, string>> {
  const needed: Record<string, string> = {};
  await Promise.all(pkgs.map(async (pkg) => {
    if (!pkg || BUNDLED_TYPES.has(pkg)) return;
    const tp = TYPES_MAP[pkg] ?? `@types/${pkg.startsWith("@") ? pkg.split("/")[1] : pkg}`;
    if (existing[tp]) return;
    try { const d = await packageJson(tp); needed[tp] = d.version as string; } catch {}
  }));
  return needed;
}

async function buildPackageJson(
  aiOutput: string,
  newFiles: { path: string; content: string }[],
  currentProjectFiles: { path: string; content: string }[]
): Promise<{ path: string; content: string } | null> {
  const scanned = scanImports(newFiles);
  const aiDeps    = extractDeps(aiOutput, "DEPENDENCIES");
  const aiDevDeps = extractDeps(aiOutput, "DEVDEPENDENCIES");
  const toRemove  = new Set([
    ...extractDeps(aiOutput, "REMOVE_DEPENDENCIES"),
    ...extractDeps(aiOutput, "REMOVEDEPENDENCIES"),
  ]);

  const allNew = new Set([...scanned, ...aiDeps]);
  if (allNew.size === 0 && aiDevDeps.length === 0 && toRemove.size === 0) return null;

  const existFile = currentProjectFiles.find((f) => f.path === "package.json");
  let pkg: any = existFile ? JSON.parse(existFile.content) : {
    name: "app", version: "1.0.0", private: true,
    scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint" },
    dependencies: { next: "15.1.0", react: "19.0.0", "react-dom": "19.0.0", "lucide-react": "0.475.0", clsx: "2.1.1", "tailwind-merge": "2.3.0" },
    devDependencies: { typescript: "^5", "@types/node": "^20", "@types/react": "^19", "@types/react-dom": "^19", postcss: "^8", tailwindcss: "^3.4.1", autoprefixer: "^10.4.19", eslint: "^8", "eslint-config-next": "15.0.3" },
  };

  const newToResolve  = [...allNew].filter((p) => p && !IGNORE_PKGS.has(p) && !pkg.dependencies?.[p] && !pkg.devDependencies?.[p]);
  const newDevResolve = aiDevDeps.filter((p) => p && !pkg.dependencies?.[p] && !pkg.devDependencies?.[p]);

  await Promise.all([
    ...newToResolve.map(async (p) => {
      const v = await resolveVersion(p);
      if (DEV_ONLY_PKGS.has(p)) pkg.devDependencies[p] = v; else pkg.dependencies[p] = v;
    }),
    ...newDevResolve.map(async (p) => { pkg.devDependencies[p] = await resolveVersion(p); }),
  ]);

  const autoTypes = await resolveAutoTypes(newToResolve, pkg.devDependencies);
  Object.assign(pkg.devDependencies, autoTypes);

  for (const p of toRemove) { delete pkg.dependencies?.[p]; delete pkg.devDependencies?.[p]; }

  return { path: "package.json", content: JSON.stringify(pkg, null, 2) };
}

// =============================================================================
// AI HELPERS — non-streaming (for intent detection + design anchor)
// =============================================================================

/** Streaming call that collects silently — used for design anchor (long, no emit) */
async function callAISilent(
  isAnthropic: boolean,
  anthropic: Anthropic | null,
  ai: GoogleGenAI,
  modelId: string,
  systemPrompt: string,
  contents: { role: string; parts?: any[]; content?: any }[],
  opts: { temperature?: number; maxTokens?: number; thinkingLevel?: string; topP?: number } = {}
): Promise<string> {
  const { temperature = 0.9, maxTokens = 65536, thinkingLevel, topP } = opts;
  let out = "";

  if (isAnthropic && anthropic) {
    // Anthropic Claude models max out at 8192 output tokens without extended thinking.
    // Requesting more causes an API error and silently kills the design agent.
    const anthropicMaxTokens = Math.min(maxTokens, 8000);
    const msgs = contents
      .filter((c) => c.role !== "system")
      .map((c) => ({
        role: c.role === "model" ? "assistant" : "user",
        content: c.content ?? (c.parts
          ? c.parts.filter((p: any) => p.text || p.inlineData).map((p: any) =>
              p.inlineData
                ? { type: "image", source: { type: "base64", media_type: p.inlineData.mimeType, data: p.inlineData.data } }
                : { type: "text", text: p.text }
            )
          : [{ type: "text", text: "" }]
        ),
      }));
    const stream = anthropic.messages.stream({
      model: modelId, max_tokens: anthropicMaxTokens, system: systemPrompt, messages: msgs as any,
    });
    for await (const chunk of stream) {
      if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
        out += chunk.delta.text;
      }
    }
  } else {
    const stream = await ai.models.generateContentStream({
      model: modelId,
      contents: contents.map((c) => ({ role: c.role === "assistant" ? "model" : c.role, parts: c.parts ?? [{ text: "" }] })) as any,
      config: {
        systemInstruction: systemPrompt,
        temperature,
        maxOutputTokens: maxTokens,
        ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
        ...(topP !== undefined ? { topP } : {}),
      },
    });
    for await (const chunk of stream) {
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (!part.thought && part.text) out += part.text;
      }
    }
  }
  return out;
}

// =============================================================================
// POST HANDLER
// =============================================================================

export async function POST(req: Request) {
  try {
    // ── Parse body FIRST so we can use modelId as fallback ────────────────────
    const body = await req.json();

    // Header takes priority; body.modelId is the fallback (belt-and-suspenders)
    const headerModelId = req.headers.get("x-model-id")?.trim() || "";
    const MODEL_ID = headerModelId || ((body as any).modelId?.trim()) || GEMINI_DEFAULT;
    const isAnthropic = ANTHROPIC_MODELS.has(MODEL_ID);

    const geminiKey    = req.headers.get("x-gemini-api-key")    || process.env.GEMINI_API_KEY    || "";
    const anthropicKey = req.headers.get("x-anthropic-api-key") || process.env.ANTHROPIC_API_KEY || "";

    if (isAnthropic && !anthropicKey) return NextResponse.json({ error: "Anthropic API key missing" }, { status: 401 });
    if (!isAnthropic && !geminiKey)   return NextResponse.json({ error: "Gemini API key missing" },   { status: 401 });

    const ai       = new GoogleGenAI({ apiKey: isAnthropic ? (geminiKey || "placeholder") : geminiKey });
    const anthropic = isAnthropic ? new Anthropic({ apiKey: anthropicKey }) : null;
    const {
      history           = [],
      uploadedImages    = [],
      allReferenceImages = [],
      currentProjectFiles: rawProjectFiles = [],
      uploadedFiles     = [],
      vibesByCategory   = {} as Record<string, string[]>,
      vibeCategoryNames = [] as string[],
      forceDesignRef    = false,
      uploadedColorMaps = [] as string[],
    } = body;

    // Normalize project files (client can send { filePath, content } or { path, content })
    const currentProjectFiles: { path: string; content: string }[] = (rawProjectFiles as any[])
      .map((f: any) => ({ path: (f.path ?? f.filePath ?? "").replace(/^\.\//, ""), content: f.content ?? "" }))
      .filter((f: any) => f.path.length > 0);

    // Last user message text
    const lastHistory = history[history.length - 1];
    const lastUserText: string =
      lastHistory?.role === "user"
        ? typeof lastHistory.content === "string"
          ? lastHistory.content
          : (lastHistory.content as any[])?.filter((p: any) => p.type === "text")?.map((p: any) => p.text)?.join("\n") ?? ""
        : "";

    // ─── Detect user language and build mandatory language instruction ──────────
    const detectUserLanguage = (text: string): string => {
      if (!text || text.trim().length < 2) return "English";
      const t = text.trim();
      // Script-based detection via Unicode ranges
      if (/[\u0600-\u06FF]/.test(t)) return "Arabic";
      if (/[\u3040-\u309F\u30A0-\u30FF]/.test(t)) return "Japanese";
      if (/[\uAC00-\uD7AF]/.test(t)) return "Korean";
      if (/[\u0400-\u04FF]/.test(t)) return "Russian";
      if (/[\u0590-\u05FF]/.test(t)) return "Hebrew";
      if (/[\u0E00-\u0E7F]/.test(t)) return "Thai";
      if (/[\u0370-\u03FF]/.test(t)) return "Greek";
      if (/[\u4E00-\u9FFF]/.test(t)) {
        // Chinese vs Japanese CJK — Japanese has kana, Chinese doesn't
        return /[\u3040-\u30FF]/.test(t) ? "Japanese" : "Chinese";
      }
      // Latin script — detect by common words
      const lower = t.toLowerCase();
      const fr = /\b(je|tu|il|elle|nous|vous|ils|elles|est|sont|avec|pour|dans|sur|que|qui|une|des|les|pas|plus|bien|comme|mais|donc|alors|aussi|très|tout|cette|votre|notre|mon|ma|mes|ses|leur|leurs|au|aux|du|de la|c'est|j'ai|je veux|je voudrais|peux|pouvez|comment|pourquoi|quoi|quand|ici|là|bonjour|merci|salut|oui|non|ça|ce|cet|avoir|faire|aller|vouloir|pouvoir|falloir)\b/.test(lower);
      const es = /\b(yo|tú|él|ella|nosotros|vosotros|ellos|ellas|es|son|con|para|en|sobre|que|quien|una|unas|los|las|no|más|bien|como|pero|entonces|también|muy|todo|esta|vuestra|nuestra|mi|mis|sus|su|al|del|hola|gracias|sí|buenos|cómo|qué|cuándo|dónde|por qué|quiero|puedo|hacer|tener|ir|venir)\b/.test(lower);
      const pt = /\b(eu|tu|ele|ela|nós|vós|eles|elas|é|são|com|para|em|sobre|que|quem|uma|umas|os|as|não|mais|bem|como|mas|então|também|muito|todo|esta|nossa|minha|minhas|suas|sua|ao|do|da|olá|obrigado|sim|bom|como|quando|onde|por que|quero|posso|fazer|ter|ir|vir)\b/.test(lower);
      const de = /\b(ich|du|er|sie|wir|ihr|sie|ist|sind|mit|für|in|auf|dass|wer|eine|ein|die|das|der|nicht|mehr|gut|wie|aber|dann|auch|sehr|alles|diese|unser|mein|meine|seine|ihre|beim|vom|hallo|danke|ja|nein|wie|wann|wo|warum|ich möchte|ich will|können|machen|haben|gehen|kommen)\b/.test(lower);
      const it = /\b(io|tu|lui|lei|noi|voi|loro|è|sono|con|per|in|su|che|chi|una|un|i|gli|le|la|non|più|bene|come|ma|poi|anche|molto|tutto|questa|nostra|mia|mie|sue|sua|al|del|della|ciao|grazie|sì|buon|come|quando|dove|perché|voglio|posso|fare|avere|andare|venire)\b/.test(lower);
      if (fr) return "French";
      if (de) return "German";
      if (es) return "Spanish";
      if (pt) return "Portuguese";
      if (it) return "Italian";
      return "English";
    };

    const LANGUAGE_INSTRUCTION = `CRITICAL INSTRUCTION — LANGUAGE:
Detect the language the user is writing in and respond ENTIRELY in that same language.
Never default to French. If the user writes in English, respond in English. If Japanese, respond in Japanese. If Arabic, respond in Arabic. Mirror the user's language exactly, always.\n\n`;

    // Collect all images (uploaded + reference)
    const allImages = [...(uploadedImages || []), ...(allReferenceImages || [])].slice(0, 4);

    // ─── Build history for Gemini (contents format) ──────────────────────────
    const buildGeminiHistory = (includeImages = true): any[] => {
      const contents: any[] = [];
      for (let i = 0; i < history.length - 1; i++) {
        const msg = history[i];
        const role = msg.role === "assistant" ? "model" : "user";
        const text = typeof msg.content === "string" ? msg.content
          : (msg.content as any[])?.filter((p: any) => p.type === "text")?.map((p: any) => p.text)?.join("\n") ?? "";
        if (text.trim()) contents.push({ role, parts: [{ text }] });
      }
      const lastParts: any[] = [];
      if (includeImages) {
        for (const img of allImages) {
          try {
            const raw = cleanBase64(img);
            if (!raw || raw.length < 100) continue;
            const mime = img.startsWith("data:image/png") ? "image/png" : img.startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
            lastParts.push({ inlineData: { data: raw, mimeType: mime } });
          } catch {}
        }
      }
      lastParts.push({ text: lastUserText || "Aide-moi." });
      contents.push({ role: "user", parts: lastParts });
      return contents;
    };

    // ─── Build history for Anthropic (messages format) ───────────────────────
    const buildAnthropicHistory = (includeImages = true): any[] => {
      const messages: any[] = [];
      for (let i = 0; i < history.length - 1; i++) {
        const msg = history[i];
        const role = msg.role === "assistant" ? "assistant" : "user";
        const text = typeof msg.content === "string" ? msg.content
          : (msg.content as any[])?.filter((p: any) => p.type === "text")?.map((p: any) => p.text)?.join("\n") ?? "";
        if (text.trim()) messages.push({ role, content: text });
      }
      const lastContent: any[] = [];
      if (includeImages) {
        for (const img of allImages) {
          try {
            const raw = cleanBase64(img);
            if (!raw || raw.length < 100) continue;
            const mt = img.startsWith("data:image/png") ? "image/png" : img.startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
            lastContent.push({ type: "image", source: { type: "base64", media_type: mt, data: raw } });
          } catch {}
        }
      }
      lastContent.push({ type: "text", text: lastUserText || "Aide-moi." });
      messages.push({ role: "user", content: lastContent });
      return messages;
    };

    // ─── Stream ───────────────────────────────────────────────────────────────
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const emit = (t: string) => controller.enqueue(enc.encode(t));

        try {
          // ═════════════════════════════════════════════════════════════════
          // PHASE 0 — INTENT DETECTION (totalement silencieux côté client)
          // Le Presenter est un classifieur IA — il détecte CODE/FIX/MICRO/CHAT_ONLY.
          // Pas d'heuristique regex — le modèle comprend l'intention de l'utilisateur.
          // ═════════════════════════════════════════════════════════════════
          let rawPresenterOutput = "";
          try {
            if (isAnthropic) {
              rawPresenterOutput = await callAISilent(
                true, anthropic, ai, MODEL_ID, PRESENTER_PROMPT,
                buildAnthropicHistory(true).map((m: any) => ({ role: m.role, content: m.content })),
                { temperature: 0.8, maxTokens: 512 }
              );
            } else {
              rawPresenterOutput = await callAISilent(
                false, null, ai, MODEL_ID, PRESENTER_PROMPT,
                buildGeminiHistory(true),
                { temperature: 0.8, maxTokens: 512 }
              );
            }
          } catch {
            const fc = currentProjectFiles.length;
            const m  = lastUserText.toLowerCase();
            const isErr = /ReferenceError|TypeError|SyntaxError|Cannot find|is not defined|Module not found|Cannot read|build fail|failed to compile/i.test(lastUserText);
            const isFix = /\b(corrige|corriger|fixe|fixer|répare|réparer|résous|debug|erreur|bug|crash|cassé|marche pas)\b/i.test(m);
            rawPresenterOutput = (isErr || isFix) ? "FIX_ACTION" : (fc === 0 ? "CODE_ACTION" : "MICRO_EDIT_ACTION");
          }

          // ── Parse decision ──
          const decisionMatch = rawPresenterOutput.match(/(CODE_ACTION|FIX_ACTION|MICRO_EDIT_ACTION|CHAT_ONLY)/);
          const smartFallback = (): string => {
            if (currentProjectFiles.length === 0) return "CODE_ACTION";
            const m = lastUserText;
            if (/ReferenceError|TypeError|SyntaxError|Cannot find|is not defined|Module not found|Cannot read|build fail|failed to compile/i.test(m)) return "FIX_ACTION";
            if (/\b(corrige|corriger|fixe|fixer|répare|réparer|résous|debug|erreur|bug|crash)\b/i.test(m.toLowerCase())) return "FIX_ACTION";
            if (/^(qu[e']|est-ce que|comment|pourquoi|quand|quel|explique|c'est quoi|dis-moi)/i.test(m.trim())) return "CHAT_ONLY";
            return "MICRO_EDIT_ACTION";
          };
          const decision = decisionMatch ? decisionMatch[1] : smartFallback();

          // ── Detect IMAGE_IS_DESIGN_REF ──
          // Déclenché si: forceDesignRef (vibes fetched par sendChat) OU
          // Presenter a détecté une image de référence de design (upload direct OU vibes)
          const hasImages = allImages.length > 0;
          const isDesignRef = forceDesignRef ||
            (rawPresenterOutput.includes("[IMAGE_IS_DESIGN_REF]") && hasImages);

          // ── Émet la prose du presenter vers le client (SANS les mots-clés internes) ──
          // [IMAGE_IS_DESIGN_REF], CODE_ACTION, FIX_ACTION etc. sont des marqueurs internes
          // ils ne doivent JAMAIS parvenir au client — on les strip avant d'émettre
          if (decision !== "CHAT_ONLY") {
            const presenterProse = rawPresenterOutput
              .replace(/\[IMAGE_IS_DESIGN_REF\]/g, "")
              .replace(/\b(CODE_ACTION|FIX_ACTION|MICRO_EDIT_ACTION|CHAT_ONLY)\b/g, "")
              .replace(/\n{3,}/g, "\n\n")
              .trim();
            if (presenterProse) {
              emit(`[PRESENTER:INTRO]${presenterProse}[/PRESENTER:INTRO]\n`);
            }
          }

          // ═════════════════════════════════════════════════════════════════
          // Load existing design anchor — AVANT CHAT_ONLY pour être disponible partout
          // ═════════════════════════════════════════════════════════════════
          let existingDesignAnchorHtml = loadDesignAnchorFromFiles(currentProjectFiles);
          let activeDesignAnchor = existingDesignAnchorHtml
            ? buildDesignAnchor(existingDesignAnchorHtml)
            : "";

          // ═════════════════════════════════════════════════════════════════
          // CHAT_ONLY — le single agent répond directement (pas le Presenter)
          // Prompt combiné : règles du Presenter (ton conversationnel) +
          //                  BASE_SYSTEM_PROMPT (expertise technique complète)
          // ═════════════════════════════════════════════════════════════════
          if (decision === "CHAT_ONLY") {
            // Injection du design anchor pour que CHAT_ONLY ne propose pas de déroger au design
            const designCtx = activeDesignAnchor
              ? `\n\n${activeDesignAnchor}\n⚠️ Ce design est FIGÉ — ne propose aucune modification des tokens sans demande explicite.`
              : "";
            const chatSystemPrompt = `${LANGUAGE_INSTRUCTION}${PRESENTER_PROMPT}\n\n---\n\n${BASE_SYSTEM_PROMPT}${designCtx}\n\n` +
              `Tu es maintenant en mode CONVERSATION. Tu réponds directement à l'utilisateur ` +
              `avec toute ton expertise. Pas de code, pas de fichiers — seulement une réponse ` +
              `claire, naturelle et experte à sa question. Tu connais parfaitement tout ce qui ` +
              `a été codé dans ce projet car tu l'as fait toi-même.`;

            if (!isAnthropic) {
              const r = await ai.models.generateContentStream({
                model: MODEL_ID,
                contents: buildGeminiHistory(true),
                config: { systemInstruction: chatSystemPrompt, temperature: 0.8, maxOutputTokens: 4096 },
              });
              for await (const chunk of r) {
                const parts = chunk.candidates?.[0]?.content?.parts ?? [];
                for (const part of parts) {
                  if ((part as any).thought || !part.text) continue;
                  emit(part.text);
                }
              }
            } else {
              const r = await anthropic!.messages.stream({
                model: MODEL_ID, max_tokens: 4096, system: chatSystemPrompt,
                messages: buildAnthropicHistory(true),
              });
              for await (const chunk of r) {
                if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta")
                  emit(chunk.delta.text);
              }
            }
            emit("\n[PAGE_DONE]\n");
            controller.close();
            return;
          }

          if (activeDesignAnchor) emit("\n[DESIGN:RESTORED] ✅ Design anchor restauré depuis les fichiers projet\n");

          // ═════════════════════════════════════════════════════════════════
          // PHASE 0.5 — DESIGN ANCHOR AGENT (conditionnel)
          // Déclenché UNIQUEMENT si [IMAGE_IS_DESIGN_REF] détecté ET images présentes
          // ═════════════════════════════════════════════════════════════════
          if (isDesignRef) {
            emit("\n[PHASE:0/DESIGN]\n");
            emit("[DESIGN:THINKING] Analyse du design de référence en cours...\n");

            // Quand forceDesignRef=true, les vibes sont déjà dans uploadedImages (fetched par sendChat)
            // Quand c'est l'utilisateur qui a uploadé une image → même chose
            const designImages = [...(uploadedImages || []), ...(allReferenceImages || [])].slice(0, 10);
            if (forceDesignRef && vibeCategoryNames.length > 0)
              emit(`[DESIGN:THINKING] Références vibes: ${vibeCategoryNames.join(", ")}\n`);

            const designInput = `
Demande : "${lastUserText}"

════════════════════════════════════════════════════════════════════
MISSION : ULTRA-ANALYSE PUIS HTML/CSS PIXEL-PERFECT
════════════════════════════════════════════════════════════════════
${uploadedColorMaps && uploadedColorMaps.length > 0 ? `
╔══════════════════════════════════════════════════════════════════╗
║  CANVAS PIXEL-EXTRACTED COLOR DATA — SOURCE DE VÉRITÉ ABSOLUE   ║
╚══════════════════════════════════════════════════════════════════╝
Ces couleurs ont été extraites pixel par pixel depuis l'image via l'API Canvas du navigateur.
Tu DOIS utiliser UNIQUEMENT ces valeurs hex exactes. Zéro approximation. Zéro bg-gray-*. Zéro text-blue-*.

${uploadedColorMaps.join("\n\n")}

⚠️ RÈGLE CRITIQUE : chaque couleur ci-dessus correspond à une zone précise de l'image.
Utilise le bloc ZONE MAP 6×6 pour mapper chaque zone de l'interface à sa couleur exacte.
` : ""}
ÉTAPE 1 — ULTRA-ANALYSE EXHAUSTIVE (dans ta réflexion — OBLIGATOIRE avant tout code)
Analyse CHAQUE élément visible dans les images, même les plus insignifiants :

COULEURS :
  • Fond body/page : hex exact (depuis les données canvas ci-dessus)
  • Sidebar background : hex exact
  • Header/topbar : hex exact
  • Cards/panels : hex exact
  • Texte primaire, secondaire, désactivé : hex exact
  • Accents, CTA, boutons actifs : hex exact
  • Bordures, séparateurs : hex exact + opacité si semi-transparent
  • Aucune couleur inventée — utilise UNIQUEMENT les hex du bloc canvas

LAYOUT & PROPORTIONS :
  • Width sidebar (ex: 240px ou 20%)
  • Height header (ex: 56px)
  • Padding interne de chaque zone
  • Grid/Flex: colonnes, gaps, justification

TYPOGRAPHIE :
  • Font-family (nom Google Font reconnaissable)
  • Tailles h1/h2/h3/body/caption en px
  • Font-weight des éléments importants

COMPOSANTS (un par un) :
  • Sidebar : items nav, icônes, indicateur actif, spacing
  • Header : logo, titre, actions, border-bottom
  • Cards : radius exact, shadow exact, border, padding
  • Boutons : filled/outline/ghost, radius, padding, shadow hover
  • Inputs : border-style, radius, focus-ring
  • Badges/tags : shape, taille, couleurs
  • Icônes : style, taille en px

ÉTAPE 2 — GÉNÈRE LE HTML/CSS avec variables :root{} + tous les composants pixel-perfect
`;

            const designContents: any[] = [];
            const refParts = designImages.map((img: string) => ({
              inlineData: { data: cleanBase64(img), mimeType: getMimeType(img) }
            }));
            designContents.push({ role: "user", parts: [...refParts, { text: designInput }] });

            try {
              const designOutput = await callAISilent(
                isAnthropic, anthropic, ai, MODEL_ID,
                DESIGN_AGENT_PROMPT,
                designContents,
                { temperature: 1.0, maxTokens: 65536, thinkingLevel: "high", topP: 0.9 }
              );

              const designMatch = designOutput.match(/<design_reference>([\s\S]*?)<\/design_reference>/);
              if (designMatch && designMatch[1].length > 200) {
                const htmlRef = designMatch[1].trim();
                activeDesignAnchor = buildDesignAnchor(htmlRef);
                // Sauvegarder le HTML BRUT (pas le formaté) pour que le reload soit propre.
                // buildDesignAnchor sera rappelé une seule fois au rechargement.
                emit(`\n<create_file path="${DESIGN_ANCHOR_FILE}">\n${htmlRef}\n</create_file>\n`);
                emit(`\n[DESIGN:READY] ✅ Design anchor généré (${htmlRef.length} chars)\n`);
              } else {
                emit("\n[DESIGN:SKIP] Balise design_reference absente — design fallback activé.\n");
              }
            } catch (designErr: any) {
              emit(`\n[DESIGN:SKIP] Agent design indisponible (${String(designErr?.message ?? "").slice(0, 60)}) — design existant utilisé.\n`);
            }
          }

          // ═════════════════════════════════════════════════════════════════
          // Build systemPrompt for Phase 1
          // ═════════════════════════════════════════════════════════════════
          let systemPrompt = LANGUAGE_INSTRUCTION + BASE_SYSTEM_PROMPT + "\n\n" + FILE_FORMAT + "\n\n" + DESIGN_MANDATORY_INSTRUCTION;

          // ── Inject the ACTIVE model identity — prevents wrong self-identification ──
          systemPrompt += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nACTIVE MODEL (THIS REQUEST): ${MODEL_ID}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nYou are currently running as: ${MODEL_ID}\nWhen asked which model or version you are, always answer with exactly: ${MODEL_ID}\nDo NOT say you are any other model.\n`;

          // Inject vibe categories context (admin-curated design references)
          if (vibeCategoryNames && vibeCategoryNames.length > 0) {
            systemPrompt += `\n\n` +
              `╔═══════════════════════════════════════════════════════════╗\n` +
              `║  DESIGN VIBES — RÉFÉRENCES VISUELLES DISPONIBLES          ║\n` +
              `╚═══════════════════════════════════════════════════════════╝\n` +
              `Catégories disponibles : ${vibeCategoryNames.join(", ")}\n\n` +
              `Quand tu émets [IMAGE_IS_DESIGN_REF] pour activer le Design Agent, tu DOIS aussi\n` +
              `préciser quelles images tu veux en ajoutant ce XML sur une ligne seule :\n` +
              `<request_vibes category="Background" count="3"/>\n` +
              `Tu peux émettre plusieurs <request_vibes> pour des catégories différentes.\n` +
              `Si tu n'émets pas de <request_vibes>, toutes les catégories seront envoyées (2 par catégorie).\n`;
          }

          // Inject design anchor (new or restored) — contient déjà le HTML via buildDesignAnchor
          if (activeDesignAnchor) {
            systemPrompt += "\n\n" + activeDesignAnchor;
          }

          // Inject design.md TOUJOURS si présent
          const designMd = currentProjectFiles.find((f) => f.path === "design.md");
          if (designMd) {
            systemPrompt +=
              `\n\n╔══════════════════════════════════════════════════╗\n` +
              `║  DESIGN MEMORY — TOKENS OBLIGATOIRES DE CE PROJET  ║\n` +
              `╚══════════════════════════════════════════════════╝\n` +
              `${designMd.content}\n` +
              `⚠️ Ces couleurs/polices/espacements sont OBLIGATOIRES. Respecte-les exactement.\n`;
          }

          // Inject raw HTML/CSS du design anchor (fichier brut) si présent
          // Note : le fichier contient maintenant le HTML brut (pas le formaté buildDesignAnchor)
          // ce qui permet à l'agent de lire DIRECTEMENT les variables :root{} sans double-couche.
          const designAnchorFile = currentProjectFiles.find((f) => f.path === DESIGN_ANCHOR_FILE);
          if (designAnchorFile && designAnchorFile.content.length > 100) {
            const rawHtml = designAnchorFile.content;
            // Si l'activeDesignAnchor vient du fichier rechargé, il est déjà injecté ci-dessus.
            // On ajoute ici une injection directe du HTML brut pour que l'agent le voie littéralement.
            if (!activeDesignAnchor) {
              // Session sans design agent : injecter depuis le fichier sauvegardé
              systemPrompt += "\n\n" + buildDesignAnchor(rawHtml);
            }
            // Dans tous les cas, injecter le HTML brut en clair pour extraction directe des variables
            systemPrompt +=
              `\n\n╔══════════════════════════════════════════════════════════════════╗\n` +
              `║  HTML/CSS BRUT DU DESIGN AGENT — COPIE EXACTE DES VARIABLES     ║\n` +
              `╚══════════════════════════════════════════════════════════════════╝\n` +
              `INSTRUCTION CRITIQUE : Extrait les variables CSS de ce :root{} et utilise-les\n` +
              `TELLES QUELLES dans tous tes composants React/Tailwind bg-[#hex] text-[#hex].\n` +
              `NE PAS substituer par bg-gray-*, text-blue-* ou toute autre classe générique.\n\n` +
              `${rawHtml.slice(0, 20000)}\n`; // 20k chars pour ne pas tronquer le :root{}
          }

          // Inject existing project files with line numbers (for edit_file precision)
          if (currentProjectFiles.length > 0) {
            const addLineNums = (c: string) =>
              c.split("\n").map((l, i) => `${String(i + 1).padStart(4)} | ${l}`).join("\n");
            const fileList = currentProjectFiles
              .map((f) => `\n=== ${f.path} ===\n${addLineNums(f.content)}`)
              .join("\n\n");
            systemPrompt += `\n\nEXISTING PROJECT FILES (line numbers for edit_file):\n${fileList.slice(0, 80000)}`;
          }

          // ═════════════════════════════════════════════════════════════════
          // PHASE 1 — MAIN SINGLE AGENT (direct stream to client)
          // c'est lui qui code, décide, discute — UN SEUL APPEL IA
          // ═════════════════════════════════════════════════════════════════
          let fullOutput = "";

          if (!isAnthropic) {
            // ── GEMINI streaming ──────────────────────────────────────────
            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents: buildGeminiHistory(true),
              config: {
                systemInstruction: systemPrompt,
                temperature: 0.7,
                maxOutputTokens: 65536,
                thinkingConfig: { thinkingLevel: "high" },
                topP: 0.9,
              },
            });
            for await (const chunk of response) {
              const parts = chunk.candidates?.[0]?.content?.parts ?? [];
              for (const part of parts) {
                if ((part as any).thought || !part.text) continue;
                emit(part.text);
                fullOutput += part.text;
              }
            }
          } else {
            // ── ANTHROPIC streaming ───────────────────────────────────────
            const response = await anthropic!.messages.stream({
              model: MODEL_ID,
              max_tokens: 16000,
              system: systemPrompt,
              messages: buildAnthropicHistory(true),
            });
            for await (const chunk of response) {
              if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
                emit(chunk.delta.text);
                fullOutput += chunk.delta.text;
              }
            }
          }

          // ═════════════════════════════════════════════════════════════════
          // PHASE 2 — POST-PIPELINE (programmatic — no additional AI call)
          // ═════════════════════════════════════════════════════════════════
          const newFiles = parseGeneratedFiles(fullOutput);

          // ── 2a. Resolve edit_file ops (apply to existing files, re-emit as create_file) ──
          const editOps = parseEditFileOps(fullOutput);
          if (editOps.length > 0) {
            // Build working copy of existing project files
            const workingFiles: { path: string; content: string }[] = currentProjectFiles.map(
              (f) => ({ path: f.path, content: f.content })
            );
            // Merge new create_file outputs
            for (const f of newFiles) {
              const idx = workingFiles.findIndex((g) => g.path === f.path);
              if (idx >= 0) workingFiles[idx] = f; else workingFiles.push(f);
            }
            const edResult = applyEditFileOpsToFiles(workingFiles, editOps);
            if (edResult.applied > 0) {
              emit(`\n\n[EDIT_FILE] ✅ ${edResult.applied} edit_file operation(s) applied\n`);
              // Re-emit modified files as create_file so client receives updated content
              const modifiedPaths = new Set(editOps.map((op) => op.path));
              for (const f of workingFiles) {
                if (modifiedPaths.has(f.path)) {
                  emit(`\n---\n<create_file path="${f.path}">\n${f.content}\n</create_file>`);
                }
              }
            }
            if (edResult.failed.length > 0) {
              emit(`\n[EDIT_FILE] ⚠️ ${edResult.failed.length} operation(s) failed: ${edResult.failed.map((f) => `${f.path}(${f.reason})`).join(", ")}\n`);
            }
          }

          // ── 2b. TSC Static Check ──────────────────────────────────────────
          if (newFiles.length > 0) {
            const { issues, severity } = tscStaticCheck(newFiles);
            if (issues.length > 0) {
              emit("\n\n[TSC_CHECK]\n");
              for (const issue of issues) emit(`${issue}\n`);
              if (severity === "critical") {
                const critCount = issues.filter((i) => i.startsWith("CRITICAL")).length;
                emit(`[TSC_STATUS] ${critCount} critical error(s) — fix before npm run dev\n`);
              } else {
                emit(`[TSC_STATUS] ${issues.length} warning(s) — build likely but worth checking\n`);
              }
              emit("[/TSC_CHECK]\n");
            }
          }

          // ── 2c. Package.json ──────────────────────────────────────────────
          if (newFiles.length > 0) {
            try {
              const pkgResult = await buildPackageJson(fullOutput, newFiles, currentProjectFiles);
              if (pkgResult) {
                emit(`\n\n<create_file path="${pkgResult.path}">\n${pkgResult.content}\n</create_file>`);
              }
            } catch (pkgErr: any) {
              emit(`\n[PKG_ERROR] ${pkgErr.message}`);
            }
          }

          emit("\n[PAGE_DONE]\n");
        } catch (err: any) {
          console.error("Route error:", err);
          emit(`\n[ERROR] ${err.message}\n[PAGE_DONE]\n`);
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "X-Accel-Buffering": "no",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Unknown error" }, { status: 500 });
  }
}
