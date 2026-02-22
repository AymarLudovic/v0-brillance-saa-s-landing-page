export type ArtifactType =
  | 'file_create' | 'file_edit' | 'web_search'
  | 'thinking' | 'html_clone' | 'deps';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface Artifact {
  id: string;
  type: ArtifactType;
  status: 'running' | 'done' | 'error';
  path?: string;
  description?: string;
  query?: string;
  sources?: SearchResult[];
  packages?: Record<string, string>;
}

export interface AttachedFile {
  name: string;
  mimeType: string;
  data: string; // base64
}

export interface ChatMessage {
  id: string;
  chatId: string;
  role: 'user' | 'assistant';
  content: string;
  artifacts?: Artifact[];
  attachedFiles?: AttachedFile[];
  timestamp: number;
}

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  sandboxId?: string;
  sandboxUrl?: string;
}

export interface ProjectFile {
  path: string;
  content: string;
  language: string;
}

export type StreamEvent =
  | { type: 'thinking'; content: string }
  | { type: 'search_start'; id: string; query: string }
  | { type: 'search_done'; id: string; results: SearchResult[] }
  | { type: 'file_start'; id: string; path: string; description: string }
  | { type: 'file_done'; id: string; path: string; content: string }
  | { type: 'html_clone_start'; id: string }
  | { type: 'html_clone_done'; id: string; path: string }
  | { type: 'deps_detected'; id: string; packages: Record<string, string> }
  | { type: 'message'; content: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

export function getLanguage(path: string): string {
  const ext = path.split('.').pop() ?? '';
  const map: Record<string, string> = {
    tsx: 'typescript', ts: 'typescript', jsx: 'javascript', js: 'javascript',
    css: 'css', scss: 'scss', html: 'html', json: 'json',
    md: 'markdown', mdx: 'markdown', mjs: 'javascript',
    env: 'plaintext', txt: 'plaintext', sh: 'shell',
  };
  return map[ext] ?? 'plaintext';
}
