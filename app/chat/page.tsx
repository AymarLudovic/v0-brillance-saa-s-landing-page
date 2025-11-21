"use client"

import React from "react"
import  { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import CodeMirror from "@uiw/react-codemirror"
import { javascript } from "@codemirror/lang-javascript"
import { xcodeLight } from "@uiw/codemirror-theme-xcode"
import { EditorView } from "@codemirror/view"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { tags } from "@lezer/highlight" 
// En haut de gamme de produits de votre fichier de composant (par exemple, components/Chat.tsx)
import ApiKeyModal from '@/components/ApiKeyModal'
import { 
    getHistory, 
    updateHistory, 
    replaceLastHistoryMessage 
} from '@/utils/history'; // Ajustez le chemin si nécessaire
import VercelDeployModal from '@/components/VercelDeployModal';

// Imports à ajouter dans votre liste d'imports existante
import { IndexedChunk, indexFileContent, updateProjectEmbeddings } from '@/lib/rag-utils';

// Assurez-vous que useCallback est dans les imports React (e.g., import { useState, useRef, useEffect, useMemo, useCallback } from "react")


// REMPLACER CodeMirror par Monaco Editor
import Editor, { OnChange, OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor'; // Pour les types
// NOTE : Vous n'avez plus besoin d'importer javascript, xcodeLight, EditorView, etc.
// ... autres imports Lucide et autres




import {
  Copy,
  Zap,
  Github,
  ChevronsUpDown,
  HardDrive,
  ArrowRight,
  RefreshCw,
  Code,
  Eye,
  ExternalLink,
  Image,
  Plus,
  Save,
  AtSign,
  ArrowUp,
  X,
  Sidebar,
  ChevronRight,
  Monitor,
  Check,
  Download,
  Loader,
  LogOut,
  Trash2
} from "lucide-react"


import GitHubDeployModal from '@/components/GitHubDeployModal';

// --- INTERFACES ET TYPES (SIMPLIFIÉS) ---
interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
  error?: string
}






// Interfaces fournies par l'utilisateur (utilisées ici pour le contexte)
interface Message {
  role: "user" | "assistant" | "system"
  content: string 
  images?: string[]
  externalFiles?: { fileName: string; base64Content: string }[] 
  mentionedFiles?: string[] 
  artifactData?: { 
    type: 'files' | 'url' | 'fileChanges' | null
    rawJson: string
    parsedList: any[] // Changement pour refléter le type { path, type }
  }
}

interface ProjectFile { filePath: string; content: string }
interface Project {
  id: string
  name: string
  createdAt: string
  files: ProjectFile[]
  messages: Message[]
}

// --- NOUVELLE STRUCTURE POUR LE STREAMING ---

interface FileArtifact {
  filePath: string;
  type: 'create' | 'changes'; // 'create' pour <create_file>, 'changes' pour <file_changes>
  content: string; // Contient soit le code complet, soit le JSON des changements
}

/**
 * Extrait les balises de création/modification de fichiers (<create_file> et <file_changes>)
 * d'une chaîne de texte streamée.
 */
const extractFileArtifacts = (content: string): FileArtifact[] => {
  const artifacts: FileArtifact[] = [];

  // 1. Extraction des balises <create_file>
  const createRegex = /<create_file\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/create_file>/g;
  let createMatch;
  while ((createMatch = createRegex.exec(content)) !== null) {
    artifacts.push({
      filePath: createMatch[1].trim(),
      type: 'create',
      content: createMatch[2].trim(), // Contient le code du fichier
    });
  }

  // 2. Extraction des balises <file_changes>
  const changesRegex = /<file_changes\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/file_changes>/g;
  let changesMatch;
  while ((changesMatch = changesRegex.exec(content)) !== null) {
    artifacts.push({
      filePath: changesMatch[1].trim(),
      type: 'changes',
      content: changesMatch[2].trim(), // Contient le JSON des modifications
    });
  }

  return artifacts;
};

/**
 * Met à jour l'arbre des fichiers du projet si de nouveaux chemins de fichiers sont détectés
 * pendant le streaming.
 */
const addFilesIfNew = (
  artifactPaths: { path: string, type: 'create' | 'changes' }[],
  currentFiles: ProjectFile[],
  currentActiveFile: string,
  setActiveFile: (path: string) => void,
  setCurrentProject: (update: (prev: Project | null) => Project | null) => void,
) => {
  let filesChanged = false;
  const updatedFiles = [...currentFiles];
  let newActiveFile = "";

  artifactPaths.forEach(artifact => {
    // Ajoute le fichier seulement s'il n'existe pas déjà
    if (!currentFiles.some(f => f.filePath === artifact.path)) {
      // Ajout du fichier avec contenu vide initial
      updatedFiles.push({ filePath: artifact.path, content: "" });
      filesChanged = true;
      // Met le premier nouveau fichier en actif si aucun n'est actif
      if (!newActiveFile && !currentActiveFile) newActiveFile = artifact.path;
    }
  });

  if (filesChanged) {
    setCurrentProject(prevProject => {
      if (!prevProject) return prevProject;
      return { ...prevProject, files: updatedFiles };
    });
    if (newActiveFile) {
      setActiveFile(newActiveFile);
    }
  }
};
  
// Définition de l'interface pour un Nœud dans l'arborescence de fichiers


// --- NOUVELLES INTERFACES POUR L'ARBORESCENCE DE FICHIERS ---
interface FileTreeNode {
  name: string // Nom du dossier ou du fichier (ex: 'app' ou 'page.tsx')
  path: string // Chemin complet (pour l'action de clic)
  type: 'directory' | 'file'
  children?: FileTree // Présent uniquement si 'type' est 'directory'
  index?: number // Index dans le tableau 'files' original (pour savoir quel fichier éditer)
}

// Le type FileTree sera un Map pour des recherches rapides
type FileTree = Map<string, FileTreeNode>


// --- FONCTION DE CONSTRUCTION DE L'ARBORESCENCE (LOGIQUE PURE) ---

 // Assurez-vous d'avoir cet import si vous utilisez <React.Fragment>

// --- NOUVEAU COMPOSANT FILE BREADCRUMB ---

interface FileBreadcrumbProps {
  filePath: string;
}

// 🆕 NOUVELLES INTERFACES
interface ConsoleLog {
  type: 'STDOUT' | 'STDERR' | 'INFO' | 'ERROR';
  content: string;
  timestamp: number;
}

interface ConsolePanelProps {
  sandboxId: string | undefined;
}






// Ces codes sont temporaires. Vous les remplacerez par vos propres SVGs.
// Types nécessaires pour la base de données
type DatabaseProvider = 'appwrite' | 'firebase' | 'supabase' | null;

interface DatabaseConfig {
  provider: DatabaseProvider;
  credentials: {
    [key: string]: string;
  };
}

// Icônes SVG (temporaires)
const IconAppwrite = () => (
    <svg class="max-w-full" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 112 98"
  fill="none">
  <path
    d="M111.1 73.4729V97.9638H48.8706C30.7406 97.9638 14.9105 88.114 6.44112 73.4729C5.2099 71.3444 4.13229 69.1113 3.22835 66.7935C1.45387 62.2516 0.338421 57.3779 0 52.2926V45.6712C0.0734729 44.5379 0.189248 43.4135 0.340647 42.3025C0.650124 40.0227 1.11768 37.7918 1.73218 35.6232C7.54544 15.0641 26.448 0 48.8706 0C71.2932 0 90.1935 15.0641 96.0068 35.6232H69.3985C65.0302 28.9216 57.4692 24.491 48.8706 24.491C40.272 24.491 32.711 28.9216 28.3427 35.6232C27.0113 37.6604 25.9782 39.9069 25.3014 42.3025C24.7002 44.4266 24.3796 46.6664 24.3796 48.9819C24.3796 56.0019 27.3319 62.3295 32.0653 66.7935C36.4515 70.9369 42.3649 73.4729 48.8706 73.4729H111.1Z"
    fill="#FD366E" />
  <path
    d="M111.1 42.3027V66.7937H65.6759C70.4094 62.3297 73.3616 56.0021 73.3616 48.9821C73.3616 46.6666 73.041 44.4268 72.4399 42.3027H111.1Z"
    fill="#FD366E" />
</svg>
);
const IconFirebase = () => (
    <svg width="20" height="20" viewBox="0 0 600 600" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M213.918 560.499C237.166 569.856 262.387 575.408 288.87 576.333C324.71 577.585 358.792 570.175 389.261 556.099C352.724 541.744 319.634 520.751 291.392 494.651C273.086 523.961 246.01 547.113 213.918 560.499Z" fill="#FF9100"/>
<path d="M291.389 494.66C226.923 435.038 187.815 348.743 191.12 254.092C191.228 251.019 191.39 247.947 191.58 244.876C180.034 241.89 167.98 240.068 155.576 239.635C137.821 239.015 120.626 241.217 104.393 245.788C87.1838 275.933 76.7989 310.521 75.5051 347.569C72.1663 443.18 130.027 526.723 213.914 560.508C246.007 547.121 273.082 523.998 291.389 494.66Z" fill="#FFC400"/>
<path d="M291.39 494.657C306.378 470.671 315.465 442.551 316.523 412.254C319.306 332.559 265.731 264.003 191.581 244.873C191.391 247.944 191.229 251.016 191.121 254.089C187.816 348.74 226.924 435.035 291.39 494.657Z" fill="#FF9100"/>
<path d="M308.231 20.8584C266 54.6908 232.652 99.302 212.475 150.693C200.924 180.129 193.665 211.748 191.546 244.893C265.696 264.023 319.272 332.579 316.489 412.273C315.431 442.57 306.317 470.663 291.355 494.677C319.595 520.804 352.686 541.77 389.223 556.124C462.56 522.224 514.593 449.278 517.606 362.997C519.558 307.096 498.08 257.273 467.731 215.219C435.68 170.742 308.231 20.8584 308.231 20.8584Z" fill="#DD2C00"/>
</svg>
);
const IconSupabase = () => (
    <svg width="21" height="21" viewBox="0 0 109 113" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z" fill="url(#paint0_linear)"/>
<path d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z" fill="url(#paint1_linear)" fill-opacity="0.2"/>
<path d="M45.317 2.07103C48.1765 -1.53037 53.9745 0.442937 54.0434 5.041L54.4849 72.2922H9.83113C1.64038 72.2922 -2.92775 62.8321 2.1655 56.4175L45.317 2.07103Z" fill="#3ECF8E"/>
<defs>
<linearGradient id="paint0_linear" x1="53.9738" y1="54.974" x2="94.1635" y2="71.8295" gradientUnits="userSpaceOnUse">
<stop stop-color="#249361"/>
<stop offset="1" stop-color="#3ECF8E"/>
</linearGradient>
<linearGradient id="paint1_linear" x1="36.1558" y1="30.578" x2="54.4844" y2="65.0806" gradientUnits="userSpaceOnUse">
<stop/>
<stop offset="1" stop-opacity="0"/>
</linearGradient>
</defs>
</svg>
);

// Données des fournisseurs
const providersData = [
    { 
        id: 'appwrite', 
        name: 'Appwrite', 
        icon: IconAppwrite, 
        credentials: ['NEXT_PUBLIC_APPWRITE_ENDPOINT', 'NEXT_PUBLIC_APPWRITE_PROJECT_ID'] 
    },
    { 
        id: 'firebase', 
        name: 'Firebase', 
        icon: IconFirebase, 
        credentials: ['FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID'] 
    },
    { 
        id: 'supabase', 
        name: 'Supabase', 
        icon: IconSupabase, 
        credentials: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] 
    },
];
          











// 🆕 NOUVEAU COMPOSANT : CONSOLEPANEL
const ConsolePanel: React.FC<ConsolePanelProps> = ({ sandboxId }) => {
  const [logs, setLogs] = useState<ConsoleLog[]>([
    { type: 'INFO', content: 'Console active. En attente du démarrage du serveur...', timestamp: Date.now() }
  ]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [stdoutLength, setStdoutLength] = useState(0); 
  const [stderrLength, setStderrLength] = useState(0); 

  const fetchLogs = async () => {
    if (!sandboxId) return;

    try {
      const res = await fetch('/api/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getLogs', sandboxId }),
      });
      const data = await res.json();

      if (data.success && data.logs) {
        let newLogs: ConsoleLog[] = [];
        let newStdoutLength = stdoutLength;
        let newStderrLength = stderrLength;

        data.logs.forEach((log: ConsoleLog) => {
          if (log.type === 'STDOUT' && log.content.length > stdoutLength) {
            newLogs.push({
                type: 'STDOUT',
                content: log.content.substring(stdoutLength), 
                timestamp: Date.now(),
            });
            newStdoutLength = log.content.length;
          } else if (log.type === 'STDERR' && log.content.length > stderrLength) {
            newLogs.push({
                type: 'STDERR',
                content: log.content.substring(stderrLength),
                timestamp: Date.now(),
            });
            newStderrLength = log.content.length;
          }
        });
        
        if (newLogs.length > 0) {
            setLogs(prev => [...prev, ...newLogs]);
            setStdoutLength(newStdoutLength);
            setStderrLength(newStderrLength);
        }
      }
    } catch (e) {
      // Gérer l'erreur de connexion ou de sandbox
    }
  };

  useEffect(() => {
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [sandboxId]);
  
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const getLogColor = (type: ConsoleLog['type']) => {
    switch (type) {
      case 'STDERR': 
      case 'ERROR': 
        return 'text-red-400';
      case 'STDOUT': 
        return 'text-green-400';
      case 'INFO':
      default: 
        return 'text-gray-300';
    }
  }

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-gray-900 text-white font-mono text-xs p-4">
      {logs.map((log, index) => (
          <div key={index} className={`whitespace-pre-wrap ${getLogColor(log.type)}`}>
            <span className="text-gray-600 mr-2">
                {new Date(log.timestamp).toLocaleTimeString()}
            </span>
            {log.content}
          </div>
        ))}
        <div ref={logsEndRef} />
    </div>
  )
              }



  // Assurez-vous d'importer useEffect : import { useState, useRef, useEffect, useMemo } from "react" 

// ... (déclarations de useState, useMemo, etc.)

// 🛑 NOUVEAU BLOC : Synchronisation de l'état local 'files' avec la source de vérité 'currentProject.files'

// Dépend de currentProject (pour le changement de projet) et de la variable files elle-même


// ... (le reste de votre composant)
      
              



const FileBreadcrumb: React.FC<FileBreadcrumbProps> = ({ filePath }) => {
  if (!filePath) return null;

  // Sépare le chemin en répertoires/parties (ex: app/page.tsx -> ["app", "page.tsx"])
  const parts = filePath.split('/').filter(part => part.length > 0);

  return (
    <div className="flex items-center space-x-1 text-sm text-[#37322F] truncate">
      {parts.map((part, index) => (
        <React.Fragment key={index}>
          {/* Le nom du répertoire ou du fichier */}
          <span className="font-medium text-[rgba(55,50,47,0.8)]">
            {part}
          </span>
          
          {/* Ajout de la flèche de séparation si ce n'est pas le dernier élément */}
          {index < parts.length - 1 && (
            <ChevronRight className="h-4 w-4 text-[rgba(55,50,47,0.4)] flex-shrink-0" />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};



/**
 * Construit une structure d'arbre de fichiers (Map imbriquée) à partir d'une liste plate de fichiers.
 * @param files Le tableau d'objets fichiers ({ filePath: string, content: string }[]).
 * @returns La Map représentant le répertoire racine.
 */
const buildFileTree = (files: { filePath: string; content: string }[]): FileTree => {
  const root: FileTree = new Map()

  files.forEach((file, originalIndex) => {
    const parts = file.filePath.split('/')
    let currentNode = root
    let currentPath = ''

    parts.forEach((part, i) => {
      // Met à jour le chemin d'accès complet pour ce niveau
      currentPath = currentPath + (currentPath ? '/' : '') + part
      
      const isFile = i === parts.length - 1

      if (!currentNode.has(part)) {
        // Crée un nouveau nœud si non existant
        const newNode: FileTreeNode = {
          name: part,
          path: currentPath,
          type: isFile ? 'file' : 'directory',
          // On crée une nouvelle Map d'enfants seulement si c'est un répertoire
          children: isFile ? undefined : new Map(),
          index: isFile ? originalIndex : undefined,
        }
        currentNode.set(part, newNode)
      }

      // Descend dans le nœud (si ce n'est pas le fichier final)
      if (!isFile) {
        currentNode = currentNode.get(part)!.children as FileTree
      }
    })
  })

  return root
}




/**
 * Extrait le contenu JSON brut (potentiellement incomplet) entre ```json et ```.
 * Si le bloc n'est pas fermé, il prend tout jusqu'à la fin de la chaîne.
 */
const extractRawJson = (content: string): string | null => {
  const startMatch = content.match(/```json\s*/)
  if (!startMatch) return null

  // Trouve l'index de début après '```json' et les espaces
  const startIndex = startMatch.index + startMatch[0].length
  const substringAfterStart = content.substring(startIndex)
  
  // Cherche le triple backtick de fermeture
  const endMatch = substringAfterStart.match(/\s*```/)

  if (endMatch) {
    // Le bloc est fermé, prend le contenu avant la fermeture
    return substringAfterStart.substring(0, endMatch.index)
  } else {
    // Le bloc est ouvert, prend tout jusqu'à la fin du stream
    return substringAfterStart
  }
}
  


// ------------------------------------------------------
// --- LOGIQUE INDEXEDDB (À placer hors du composant) ---
const DB_NAME = 'StudioCodeDB';
const DB_VERSION = 2; 

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // Store pour les clés API
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }
      
      // Store pour les projets
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }
    };
  });
};

// Récupérer la Clé API (NÉCESSAIRE POUR SENDCHAT)
const getApiKeyFromIDB = async (): Promise<string | null> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readonly');
    const store = tx.objectStore('settings');
    const request = store.get('gemini_api_key');
    request.onsuccess = () => resolve(request.result ? request.result as string : null);
    request.onerror = () => reject(request.error);
  });
};

const saveProjectToIDB = async (project: any) => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite');
    const store = tx.objectStore('projects');
    const request = store.put(project); 
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

const getAllProjectsFromIDB = async (): Promise<any[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readonly');
    const store = tx.objectStore('projects');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
};

const deleteProjectFromIDB = async (projectId: string) => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite');
    const store = tx.objectStore('projects');
    const request = store.delete(projectId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

// --- FONCTION SILENCIEUSE : RÉCUPÉRER L'IMAGE ACTIVE DU SHOP ---
const getActiveShopImage = async (): Promise<string | null> => {
  return new Promise((resolve) => {
    const request = indexedDB.open('StudioCode_Assets', 1); // On ouvre la DB du Shop
    
    request.onerror = () => resolve(null);
    
    request.onsuccess = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('refs')) { resolve(null); return; }
      
      const tx = db.transaction('refs', 'readonly');
      const store = tx.objectStore('refs');
      const getAll = store.getAll();
      
      getAll.onsuccess = () => {
        // On cherche l'image marquée comme active
        const activeImg = getAll.result.find((img: any) => img.isActive);
        resolve(activeImg ? activeImg.base64 : null);
      };
      getAll.onerror = () => resolve(null);
    };
  });
};
// ------------------------------------------------------

// --- LOGIQUE D'ANALYSE (Fonctions pures) ---
const parseRootVariables = (css: string): { name: string; value: string }[] => {
  const variables: { name: string; value: string }[] = []
  const globalBlocksMatch = css.match(/:root\s*{[^}]*}|html\s*{[^}]*}|body\s*{[^}]*}/g)
  if (!globalBlocksMatch) return variables
  const globalContent = globalBlocksMatch.join("\n")
  const variableRegex = /(--[\w-]+)\s*:\s*([^;]+);/g
  let match
  while ((match = variableRegex.exec(globalContent)) !== null) {
    variables.push({ name: match[1].trim(), value: match[2].trim() })
  }
  return variables
}
const extractFontFaces = (css: string): string => {
  const fontFaceRegex = /@font-face\s*{[^}]*}/g
  const matches = css.match(fontFaceRegex)
  return matches ? matches.join("\n\n") : ""
}
const findPotentialComponents = (html: string): { tag: string; selector: string }[] => {
  if (typeof window === "undefined") return []
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, "text/html")
  const components: { tag: string; selector: string }[] = []
  const tagsToFind = ["header", "img", "aside", "ul", "li", "h1", "h2", "h3", "h4", "p", "span", "a", "nav", "footer", "section", "button"]
  tagsToFind.forEach((tag) => {
    if (doc.querySelector(tag)) components.push({ tag, selector: tag })
  })
  const cards: { tag: string; selector: string }[] = []
  doc.querySelectorAll("div").forEach((div, index) => {
    if (div.querySelector("img") && div.querySelector("h1, h2, h3, p, span, header, nav, a, button, aside, footer, section, img, video, ul, li, ol")) {
      const uniqueSelector = `[data-gemini-card-id="${index}"]`
      div.setAttribute("data-gemini-card-id", `${index}`)
      cards.push({ tag: `Card (div)`, selector: uniqueSelector })
    }
  })
  if (cards.length > 0) {
    components.push(...cards.slice(0, 5))
  }
  return components
}
const cloneWithComputedStyles = (element: Element): HTMLElement => {
  const clone = element.cloneNode(false) as HTMLElement
  const computedStyle = window.getComputedStyle(element)
  const stylePropertiesToCopy = [
    "display",
    "flex-direction",
    "align-items",
    "justify-content",
    "gap",
    "grid-template-columns",
    "grid-template-rows",
    "position",
    "top",
    "right",
    "bottom",
    "left",
    "z-index",
    "width",
    "height",
    "min-width",
    "min-height",
    "max-width",
    "max-height",
    "margin",
    "padding",
    "border",
    "border-radius",
    "background-color",
    "background-image",
    "background-size",
    "background-position",
    "color",
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "text-align",
    "text-decoration",
    "box-shadow",
    "opacity",
    "transform",
    "transition",
    "overflow",
  ]
  let styleString = ""
  for (const prop of stylePropertiesToCopy) {
    const value = computedStyle.getPropertyValue(prop)
    if (value) styleString += `${prop}: ${value}; `
  }
  clone.setAttribute("style", styleString)
  element.childNodes.forEach((child) => {
    if (child.nodeType === Node.ELEMENT_NODE) clone.appendChild(cloneWithComputedStyles(child as Element))
    else if (child.nodeType === Node.TEXT_NODE) clone.appendChild(child.cloneNode())
  })
  return clone
}




// --- COULEURS ET STYLE DE BASE ---

// --- COULEURS ET STYLE DE BASE (Mise à jour) ---
// --- COULEURS ET STYLE DE BASE (MISES À JOUR) ---
// --- CONFIGURATION DU THÈME MOZILLA (STYLE VISUEL SEUL) ---
const customThemeColors = {
  editorBackground: "#FFFFFF",
  lineNumberBackground: "#FFFFFF",
  lineNumberColor: "#888888", // Numéros de ligne inactifs
  cursorColor: "#333333",
  selectionBackground: "rgba(180, 215, 255, 0.4)",
  activeLineBackground: "#FAFAFA",
  
  // POLICE DU CODE (Mozilla Text)
  fontFamily: '"Mozilla Headline", sans-serif', 
  fontSize: '14px', 
  
  // POLICE DES NUMÉROS DE LIGNE (Mozilla Headline)
  lineNumberFontSize: '15px',
  lineNumberFontFamily: '"Mozilla Headline", sans-serif', 
};


// --- THÈME GLOBAL (EditorView.theme) ---

const customEditorTheme = EditorView.theme({
  "&": {
    // Le texte du code sera noir (la couleur par défaut)
    color: "#333333", 
    backgroundColor: customThemeColors.editorBackground,
    fontFamily: customThemeColors.fontFamily, 
    fontSize: customThemeColors.fontSize,
    height: "100%",
  },
  ".cm-content": {
    caretColor: customThemeColors.cursorColor,
    padding: "16px 0",
  },
  
  // Gouttière (Numéros de ligne)
  ".cm-gutters": {
    backgroundColor: customThemeColors.lineNumberBackground, // Blanc
    color: customThemeColors.lineNumberColor, // Gris #888
    border: "none",
    paddingRight: "10px", 
    width: "48px", 
    fontSize: customThemeColors.lineNumberFontSize, 
    fontFamily: customThemeColors.lineNumberFontFamily, 
  },
  
  ".cm-line": {
    padding: "0 16px 0 0",
  },
  
  // Ligne et numéro actif
  ".cm-activeLine": {
    backgroundColor: customThemeColors.activeLineBackground,
  },
  ".cm-activeLineGutter": {
    backgroundColor: customThemeColors.lineNumberBackground, 
    color: "#000000", // Noir
    fontWeight: "600",
  },
  
  // Sélection
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: customThemeColors.selectionBackground,
  },
}, { dark: false });


// --- EXTENSION FINALE (SANS COLORATION SYNTAXIQUE) ---
export const customEditorExtension = [
  customEditorTheme,
];


    


// --- DÉBUT DU COMPOSANT DatabaseConnector ---

interface DatabaseConnectorProps {
    dbConfig: DatabaseConfig | null;
    setDbConfig: (config: DatabaseConfig | null) => void;
    sendChat: (message: string) => Promise<void>;
}

const DatabaseConnector: React.FC<DatabaseConnectorProps> = ({ dbConfig, setDbConfig, sendChat }) => {
    const [isSelectingProvider, setIsSelectingProvider] = useState(false);
    const [selectedProviderId, setSelectedProviderId] = useState<DatabaseProvider>(null);
    const [tempCredentials, setTempCredentials] = useState<{ [key: string]: string }>({});

    // Récupère l'icône du fournisseur actif
    const ActiveIcon = useMemo(() => {
        if (!dbConfig) return null;
        const provider = providersData.find(p => p.id === dbConfig.provider);
        return provider ? provider.icon : null;
    }, [dbConfig]);
    
    // Logique de connexion et notification de l'IA
    const handleConnect = async () => {
        if (!selectedProviderId) return;

        const providerInfo = providersData.find(p => p.id === selectedProviderId);
        if (!providerInfo) return;
        
        // 1. Mise à jour de la configuration
        const newConfig: DatabaseConfig = {
            provider: selectedProviderId,
            credentials: tempCredentials,
        };
        
        setDbConfig(newConfig); // Met à jour l'état et le localStorage
        setIsSelectingProvider(false);
        setSelectedProviderId(null);
        setTempCredentials({});

        // 2. Préparation et envoi du message à l'IA pour créer le .env
        const envContent = Object.entries(tempCredentials)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');
            
        const aiMessage = `[AUTOMATED ACTION] L'utilisateur a connecté la base de données ${providerInfo.name}. Veuillez créer un fichier d'environnement nommé .env à la racine du projet avec le contenu suivant pour configurer l'accès au backend :\n\n\`\`\`\n${envContent}\n\`\`\nAssurez-vous que les clés sont bien les variables d'environnement nécessaires pour ${providerInfo.name}.`;

        await sendChat(aiMessage);
    };

    // La modale/le panneau de configuration
    const ConfigurationPanel = () => {
        const currentProvider = providersData.find(p => p.id === selectedProviderId);

        if (!currentProvider) {
            // Vue de sélection du fournisseur (Dropdown)
            return (
                <div className="p-4 border flex flex-col gap-2 rounded-[12px] shadow-lg bg-[#F7F5F3] w-[350px] h-auto">
                    <h3 className="font-semibold mb-3 text-sm">Choose provider</h3>
                    {providersData.map(p => (
                        <button 
                            key={p.id}
                            className="w-full border  bg-transparent border-[rgba(55,50,47,0.90)] text-black h-[35px] rounded-[8px] flex items-center gap-2 justify-center p-1"
                            onClick={() => {
                                const initialCreds = dbConfig?.provider === p.id ? dbConfig.credentials : {};
                                setTempCredentials(initialCreds);
                                setSelectedProviderId(p.id as DatabaseProvider);
                            }}
                        >
                            {p.icon()} <span className="text-sm">{p.name}</span>
                        </button>
                    ))}
                    {dbConfig && (
                        <button 
                            onClick={() => { setDbConfig(null); setIsSelectingProvider(false); }} 
                            className="w-full mt-3 bg-[#37322F] hover:bg-[rgba(55,50,47,0.90)] text-white h-[30px]  rounded-[12px] flex items-center justify-center p-1"
                        >
                            Disconnect
                        </button>
                    )}
                </div>
            );
        }

        // Vue de saisie des identifiants (si un provider est sélectionné)
        return (
            <div className="p-4 border rounded-[12px] shadow-lg bg-[#F7F5F3] w-83">
                <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm">{currentProvider.icon()} {currentProvider.name} Credentials</h3>
                {currentProvider.credentials.map(key => (
                    <div key={key} className="mb-3">
                        <label className="block text-xs font-medium mb-1">{key}</label>
                        <input
                            type="text"
                            className="w-full p-1 h-[28px] border rounded-[10px] text-sm"
                            value={tempCredentials[key] || ''}
                            onChange={(e) => setTempCredentials({ ...tempCredentials, [key]: e.target.value })}
                            placeholder={key}
                        />
                    </div>
                ))}
                <button 
                    onClick={handleConnect} 
                    className="w-full mt-3 bg-[#37322F] hover:bg-[rgba(55,50,47,0.90)] text-white h-[30px]  rounded-[12px] flex items-center justify-center p-1"
                    disabled={currentProvider.credentials.some(key => !tempCredentials[key] || tempCredentials[key] === '')}
                >
                    Connecter {currentProvider.name}
                </button>
                <button 
                    onClick={() => setSelectedProviderId(null)} 
                    className="w-full text-gray-600 py-1 text-sm mt-2  pt-2"
                >
                     Back to selection
                </button>
            </div>
        );
    };

    return (
        <div className="relative">
            <button
                className={`w-auto px-2 py-1 h-[25px] border rounded-[8px] flex items-center justify-center gap-2 text-sm transition-colors ${dbConfig ? 'bg-green-100 border-green-500 text-green-700 font-medium' : 'border-black hover:bg-gray-50'}`}
                onClick={() => {
                    setIsSelectingProvider(!isSelectingProvider);
                    if (isSelectingProvider) { 
                        setSelectedProviderId(null);
                        setTempCredentials({});
                    }
                }}
            >
                {ActiveIcon ? (
                    <>
                        {ActiveIcon()} 
                        <p className="text-xs">{dbConfig.provider}</p>
                    </>
                ) : (
                    <p className="text-sm">Connect database</p>
                )}
            </button>
            
            {/* Rendu du panneau (positionné absolument) */}
            {isSelectingProvider && (
                <div className="absolute top-full mt-2 right-0 z-50">
                    <ConfigurationPanel />
                </div>
            )}
        </div>
    );
};





// En haut de votre fichier SandboxPage.tsx (avant export default function SandboxPage() { ... })
const READ_FILE_REGEX = /<read_file\s+path=["']([^"']+)["']\s*\/>/;

// ... (vos types, imports, et autres constantes globales)



// Nouveau format d’artefact de lecture
const FETCH_FILE_REGEX = /<fetch_file\s+path=["']([^"']+)["']\s*\/>/;






// --- COMPOSANT PRINCIPAL ---
export default function SandboxPage() {
  const [logs, setLogs] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [sandboxId, setSandboxId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [files, setFiles] = useState<{ filePath: string; content: string }[]>([])
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", content: "Hello! Let's build something." }])
  const [chatInput, setChatInput] = useState("")
  const [analysisStatus, setAnalysisStatus] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"preview" | "code">("preview")
  const [activeFile, setActiveFile] = useState(0)
  const [logsHeight, setLogsHeight] = useState(25)
  const [iframeRoute, setIframeRoute] = useState("/")
  const [projects, setProjects] = useState<Project[]>([])
  const [currentProject, setCurrentProject] = useState<Project | null>(null)
  // ⚠️ À placer au début de votre composant SandboxPage
const [isCloning, setIsCloning] = useState(false)
const [cloneUrl, setCloneUrl] = useState("")
// Assurez-vous d'importer les icônes nécessaires de Lucide React
  // Dans votre composant principal (e.g., SandboxPage)
const [copiedFileIndex, setCopiedFileIndex] = useState(null);
const [isGitHubOpen, setIsGitHubOpen] = useState(false);

// ... et d'ajouter ces états dans votre composant principal (e.g., SandboxPage)
const [copiedMessageIndex, setCopiedMessageIndex] = useState(null);
const [expandedMessageIndex, setExpandedMessageIndex] = useState(null);
// Dans votre composant parent (e.g. SandboxPage)

// Assurez-vous d'importer Check, Copy, Download (pour les boutons de fichier) si ce n'est pas déjà fait.

// État pour contrôler l'ouverture de la modal
// ==============================================================================
// 🛑 ÉTATS ET LOGIQUE DE DÉPLOIEMENT VERCEL (Intégrés)
// ==============================================================================

// État du Token (à côté de vos autres useState)
const [vercelToken, setVercelToken] = useState<string>('');
const [tokenError, setTokenError] = useState<string>('');
const [showTokenInput, setShowTokenInput] = useState<boolean>(false);
const [isVercelModalOpen, setIsVercelModalOpen] = useState<boolean>(false);
  // DANS VOTRE COMPOSANT PRINCIPAL (où vous avez déjà vos autres useState)

// Nouveaux états de contrôle de l'UI
const [isDeploymentModalOpen, setIsDeploymentModalOpen] = useState(false);
const [deploymentDetails, setDeploymentDetails] = useState({ 
    status: 'idle', // 'idle', 'deploying', 'success', 'error'
    message: '', 
    url: null, 
    error: null 
});

// État 'connections' qui contient le jeton Vercel (à adapter à votre structure)
// ANCIENNE VERSION FRAGILE (à remplacer)
// const [connections, setConnections] = useState({ vercel: typeof window !== 'undefined' && localStorage.getItem('vercel_access_token') ? { token: localStorage.getItem('vercel_access_token') } : null });

// 🟢 NOUVELLE VERSION SÛRE : Initialisation simple et sans dépendance
const [connections, setConnections] = useState({ 
    vercel: null,
    github: null // Ajoutez d'autres plateformes si nécessaire
});


  // DANS VOTRE COMPOSANT PRINCIPAL
useEffect(() => {
    // Exécuté uniquement côté client (après le premier rendu)
    if (typeof window !== 'undefined') {
        const vercelToken = localStorage.getItem('vercel_access_token');
        if (vercelToken) {
            setConnections(prev => ({
                ...prev,
                vercel: { token: vercelToken }
            }));
        }
    }
}, []);

  const [showDeploymentStatus, setShowDeploymentStatus] = useState(false);

// Fonction placeholder (à adapter si vous avez une modale dédiée pour l'entrée du jeton)
const setShowTokenModal = (platform) => { 
    alert(`Veuillez d'abord enregistrer votre jeton d'accès Vercel.`);
    // Vous pouvez ici implémenter la logique pour ouvrir la modal de jeton
};

// État de chargement global pour le déploiement (utilisé pour désactiver le bouton)
const [isConnecting, setIsConnecting] = useState({ deploy: false });

// ... (vos autres états existants : sandboxId, currentProject, etc.)
// État du Déploiement
type DeployState = 'IDLE' | 'TOKEN_VALIDATED' | 'DEPLOYING' | 'MONITORING' | 'SUCCESS' | 'ERROR';
const DEPLOYMENT_STATES: Record<DeployState, DeployState> = {
    IDLE: 'IDLE',
    TOKEN_VALIDATED: 'TOKEN_VALIDATED',
    DEPLOYING: 'DEPLOYING',
    MONITORING: 'MONITORING',
    SUCCESS: 'SUCCESS',
    ERROR: 'ERROR',
};
interface LogEntry { timestamp: string; message: string; type: 'info' | 'error' | 'success' | 'start' | 'status'; }

const [deployState, setDeployState] = useState<DeployState>(DEPLOYMENT_STATES.IDLE);
const [deployLogs, setDeployLogs] = useState<LogEntry[]>([]); // Renommés pour ne pas confondre avec 'logs'
const [deployUrl, setDeployUrl] = useState<string>('');
const logIntervalRef = useRef<NodeJS.Timeout | null>(null); 
const VERCEL_TOKEN_KEY = 'vercel_access_token';
const VERCEL_TOKEN_URL = 'https://vercel.com/account/tokens'; 

// NOUVEAUX ÉTATS POUR LE DÉPLOIEMENT SIMPLIFIÉ

const [deploying, setDeploying] = useState(false); // État de chargement du bouton
const [deployStatus, setDeployStatus] = useState<'IDLE' | 'SUCCESS' | 'ERROR' | 'LOADING'>('IDLE');
const [deployResult, setDeployResult] = useState<string | null>(null); // URL ou message d'erreur

// Référence pour le scroll des logs
const logsEndRef = useRef<HTMLDivElement>(null);

// ----------------------
// Fonctions de la Modal
// ----------------------

const addDeployLog = useCallback((message: string, type: LogEntry['type']) => {
    const timestamp = new Date().toLocaleTimeString('fr-FR', { hour12: false });
    setDeployLogs(prev => [...prev, { timestamp, message, type }]);
}, []);

const stopLogPolling = useCallback(() => {
    if (logIntervalRef.current) {
        clearInterval(logIntervalRef.current);
        logIntervalRef.current = null;
    }
}, []);

const fetchVercelLogs = useCallback(async (id: string, currentUrl: string) => {
    const statusUrl = `https://api.vercel.com/v13/deployments/${id}`;
    const token = localStorage.getItem(VERCEL_TOKEN_KEY);
    if (!token) {
        addDeployLog('Erreur: Jeton Vercel manquant pour le suivi.', 'error');
        stopLogPolling();
        setDeployState(DEPLOYMENT_STATES.ERROR);
        return;
    }

    try {
        const response = await fetch(statusUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });

        const data = await response.json();

        if (!response.ok) {
            addDeployLog(`Erreur de l'API Vercel pendant le suivi: ${data.error?.message || 'Erreur inconnue'}`, 'error');
            stopLogPolling();
            setDeployState(DEPLOYMENT_STATES.ERROR);
            return;
        }

        const currentState = data.state as string; 
        
        if (!deployLogs.find(log => log.message.includes(`Statut: ${currentState}`))) {
             addDeployLog(`Statut: ${currentState}`, 'status');
        }
        
        if (currentState === 'READY' || currentState === 'CANCELED' || currentState === 'ERROR') {
            stopLogPolling();
        }

        if (currentState === 'READY') {
            addDeployLog(`✅ Déploiement terminé avec succès! URL: ${currentUrl}`, 'success');
            setDeployState(DEPLOYMENT_STATES.SUCCESS);
        } else if (currentState === 'ERROR') {
            addDeployLog('❌ Déploiement ÉCHOUÉ. Veuillez consulter le tableau de bord Vercel.', 'error');
            setDeployState(DEPLOYMENT_STATES.ERROR);
        } 
    } catch (error) {
        addDeployLog(`Erreur de Polling: ${(error as Error).message}`, 'error');
        stopLogPolling();
        setDeployState(DEPLOYMENT_STATES.ERROR);
    }
}, [addDeployLog, stopLogPolling, deployLogs]); // Attention aux dépendances pour éviter les boucles

const startLogPolling = useCallback((id: string, currentUrl: string) => {
    stopLogPolling();
    logIntervalRef.current = setInterval(() => {
        fetchVercelLogs(id, currentUrl);
    }, 3000); 
}, [fetchVercelLogs, stopLogPolling]);

// DANS VOTRE COMPOSANT REACT PRINCIPAL (SandboxPage ou autre)

// ... vos autres fonctions et états

const startDeployment = useCallback(async () => {
    if (deployState === DEPLOYMENT_STATES.DEPLOYING || deployState === DEPLOYMENT_STATES.MONITORING) return;
    
    const token = localStorage.getItem(VERCEL_TOKEN_KEY);

    if (!token) {
        setTokenError('Jeton manquant. Veuillez l\'enregistrer.');
        return;
    }
    
    // Vérification des dépendances critiques
    if (!currentProject || !currentProject.files || currentProject.files.length === 0 || !sandboxId) {
        addDeployLog('Erreur: Projet, fichiers ou Sandbox ID manquant.', 'error');
        return;
    }

    addDeployLog(`Début du déploiement pour '${currentProject.name}'...`, 'start');
    setDeployState(DEPLOYMENT_STATES.DEPLOYING);
    setDeployLogs([]);
    setDeployUrl('');
    stopLogPolling();

    // 🛑 CONVERSION ET INCLUSION DES FICHIERS DU PROJET
    // Convertir l'array de fichiers du projet ({filePath, content}) en un objet (map)
    // où la clé est le path et la valeur est le contenu. (Format attendu par la route API)
    const projectFilesMap: Record<string, string> = {};
    currentProject.files.forEach(file => {
        // Assurez-vous que le chemin est relatif (ex: app/page.tsx)
        const relativePath = file.filePath.startsWith('/') ? file.filePath.substring(1) : file.filePath;
        projectFilesMap[relativePath] = file.content;
    });

    const deploymentPayload = {
        projectName: currentProject.name,
        token: token,
        sandboxId: sandboxId,
        files: projectFilesMap, // 🟢 PASSAGE DIRECT DES FICHIERS
    };

    try {
        const response = await fetch('/api/deploy/vercel', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(deploymentPayload),
        });

        const data: { success: boolean; error?: string; deploymentId?: string; url?: string } = await response.json();

        if (!response.ok || !data.success || !data.deploymentId || !data.url) {
            const errorMsg = data.error || 'Erreur inconnue lors du lancement du déploiement.';
            addDeployLog(`ÉCHEC: ${errorMsg}`, 'error');
            setDeployState(DEPLOYMENT_STATES.ERROR);
            setTokenError(errorMsg); 
            return;
        }

        // Succès du lancement
        addDeployLog(`Déploiement lancé avec succès! ID: ${data.deploymentId}`, 'success');
        setDeployUrl(data.url);
        setDeployState(DEPLOYMENT_STATES.MONITORING);

        // Commence le Polling des Logs Vercel
        startLogPolling(data.deploymentId, data.url);

    } catch (error) {
        addDeployLog(`Erreur critique de la requête API: ${(error as Error).message}`, 'error');
        setDeployState(DEPLOYMENT_STATES.ERROR);
    }
}, [deployState, currentProject, sandboxId, startLogPolling, stopLogPolling, addDeployLog]);

// ... le reste du code JSX de votre modal

// Effet pour le scroll des logs
useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
}, [deployLogs]);

// Assurez-vous que cette fonction fait partie de votre composant principal
// où les états connections, currentSandboxId, currentProject, projectName,
// setDeploymentDetails, et setIsConnecting sont disponibles.



      
  
// ----------------------
// Fonctions utilitaires du Token (à appeler dans le JSX)
// ----------------------
const handleTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVercelToken(e.target.value.trim());
    setTokenError('');
};

const saveToken = () => {
    if (vercelToken) { 
        localStorage.setItem(VERCEL_TOKEN_KEY, vercelToken);
        setDeployState(DEPLOYMENT_STATES.TOKEN_VALIDATED);
        setShowTokenInput(false);
        setTokenError('');
    } else {
        setTokenError('Veuillez entrer un jeton d\'accès Vercel valide (trop court).');
    }
};

const removeToken = () => {
    localStorage.removeItem(VERCEL_TOKEN_KEY);
    setVercelToken('');
    setDeployState(DEPLOYMENT_STATES.IDLE);
    setShowTokenInput(true);
    setDeployLogs([]);
    stopLogPolling();
    addDeployLog('Jeton Vercel supprimé. Veuillez en fournir un nouveau.', 'info');
};


      

        // DANS VOTRE COMPOSANT REACT PRINCIPAL


// ... autres états (deploying, deployStatus, deployResult)



// ... (Vos autres états)
const [uploadedImages, setUploadedImages] = useState<string[]>([]);
// 🛑 NOUVEAUX ÉTATS
const [uploadedFiles, setUploadedFiles] = useState<{ fileName: string; base64Content: string }[]>([]);
const [mentionedFiles, setMentionedFiles] = useState<string[]>([]);
const [isPlusDropdownOpen, setIsPlusDropdownOpen] = useState(false);
const [isMentionDropdownOpen, setIsMentionDropdownOpen] = useState(false);
const MAX_FILES = 5; // Limite générale pour les fichiers et images
  


const [viewMode, setViewMode] = useState("chat"); // 'chat' ou 'preview'

// Fonction pour basculer
const toggleViewMode = (mode) => {
  setViewMode(mode);
};
  
  const [isDeployOpen, setIsDeployOpen] = useState(false);
  

const [showProjectSelect, setShowProjectSelect] = useState(false) // <-- AJOUTEZ CET ÉTAT
         
  const [showSidebar, setShowSidebar] = useState(false)



    // 🛑 NOUVEL ÉTAT RAG : Le cache vectoriel du projet 🛑
    const [projectEmbeddings, setProjectEmbeddings] = useState<IndexedChunk[]>([]);
    
    // --- LOGIQUE D'INDEXATION DES FICHIERS ---
    
    const reindexFile = useCallback(async (file: any /* Utilisez votre type ProjectFile réel ici */) => {
        if (file.content.length < 50) return; 
        
        const newChunks = await indexFileContent(file);
        
        setProjectEmbeddings(prevEmbeddings => 
            updateProjectEmbeddings(newChunks, prevEmbeddings)
        );
    }, []);

    // --- GESTION DE L'INDEXATION LORS DU CHARGEMENT DE PROJET ---
    
    useEffect(() => {
        if (currentProject) {
            currentProject.files.forEach((file: any /* Utilisez votre type ProjectFile réel ici */) => {
                 reindexFile(file);
            });
        } else {
            setProjectEmbeddings([]); // Réinitialiser si aucun projet
        }
    }, [currentProject, reindexFile]);


  useEffect(() => {
  if (currentProject) {
    if (files !== currentProject.files) {
      setFiles(currentProject.files)
    }
  } else if (files.length > 0) {
    setFiles([])
  }
}, [currentProject])
  
  


  // --- NOUVEAUX ÉTATS/RÉFÉRENCES (À placer avec vos autres const [state, ...] = useState) ---
const chatBottomRef = useRef<HTMLDivElement>(null); // Pour le scrolling automatique du chat
// Vous utilisez déjà `loading` pour le spinner, mais ce state peut être utile pour l'UI chat
const [isChatDisabled, setIsChatDisabled] = useState(false); 
  

// --- DANS SandboxPage(), après vos autres const [state, setState] = useState(...) ---

// NOUVEAUX ÉTATS ET FONCTIONS POUR LA BASE DE DONNÉES
const [dbConfig, setDbConfigState] = useState<DatabaseConfig | null>(null);

// Fonction enveloppe pour gérer l'état de la DB et le localStorage
const setDbConfig = (config: DatabaseConfig | null) => {
    setDbConfigState(config);
    
    if (config) {
        localStorage.setItem('dbConfig', JSON.stringify(config));
    } else {
        localStorage.removeItem('dbConfig');
    }
    
    // Notification à l'IA en cas de DÉCONNEXION
    if (!config && dbConfigState?.provider) {
         sendChat(`[AUTOMATED ACTION] L'utilisateur a déconnecté la base de données ${dbConfigState.provider}. Veuillez supprimer le fichier .env et notifier que le projet est maintenant sans backend configuré.`);
    }
};

// USE EFFECT 1: Chargement initial depuis le localStorage
useEffect(() => {
    const savedConfig = localStorage.getItem('dbConfig');
    if (savedConfig) {
        try {
            setDbConfigState(JSON.parse(savedConfig));
        } catch (e) {
            console.error("Failed to parse dbConfig from localStorage", e);
            localStorage.removeItem('dbConfig');
        }
    }
}, []);

// USE EFFECT 2: Synchronisation de l'état 'files' (Celui que nous avons corrigé précédemment)
useEffect(() => {
    if (currentProject) {
        if (currentProject.files !== files) {
             setFiles(currentProject.files);
        }
    } else if (files.length > 0) {
        setFiles([]);
    }
}, [currentProject, files, setFiles]);

// ... (Vos autres fonctions et logiques)
  



  
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") setShowSidebar(false)
  }
  window.addEventListener("keydown", onKey)
  return () => window.removeEventListener("keydown", onKey)
}, [])
  

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const chatScrollAreaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      const savedProjects = localStorage.getItem("studio-projects")
      if (savedProjects) {
        setProjects(JSON.parse(savedProjects))
      }
    } catch (error) {
      console.error("Failed to load projects from localStorage", error)
    }
  }, [])

  useEffect(() => {
    if (chatScrollAreaRef.current) {
      chatScrollAreaRef.current.scrollTo({ top: chatScrollAreaRef.current.scrollHeight, behavior: "smooth" })
    }
  }, [messages])

  const addLog = (msg: string) => setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])

  const saveProjectsToLocalStorage = (updatedProjects: Project[]) => {
    try {
      localStorage.setItem("studio-projects", JSON.stringify(updatedProjects))
    } catch (error) {
      addLog("Error saving projects to localStorage.")
    }
  }


// DANS VOTRE COMPOSANT PRINCIPAL


  
  

// DANS VOTRE COMPOSANT PRINCIPAL (utilisant useCallback)

const handleDeploy = async () => {
    // 0. Démarrage initial et configuration de l'état de chargement
    setShowDeploymentStatus(true);
    setDeploymentDetails({ status: 'idle', message: 'Démarrage du processus de déploiement...', url: null, error: null });
    setIsConnecting(prev => ({ ...prev, deploy: true })); // Début du chargement

    // === 1. COLLECTE ET VÉRIFICATION SÛRE DES DONNÉES ESSENTIELLES ===
    
    // Extraction sûre des valeurs nécessaires
    const token = connections?.vercel?.token;
    const project = currentProject;
    const sandbox = sandboxId; // Récupère la valeur du scope
    
    // Conditions de garde strictes
    if (!token) {
        setDeploymentDetails({ status: "error", message: "Jeton Vercel manquant.", error: "Veuillez enregistrer votre jeton d'accès." });
        setShowTokenModal("vercel"); 
        setIsConnecting(prev => ({ ...prev, deploy: false }));
        return; 
    }
    
    if (!sandbox) {
        setDeploymentDetails({ status: "error", message: "Sandbox ID manquant.", error: "Impossible de déployer sans une sandbox active." });
        setIsConnecting(prev => ({ ...prev, deploy: false }));
        return;
    }
    
    if (!project || !project.name || !project.files || project.files.length === 0) {
        setDeploymentDetails({ status: "error", message: "Projet incomplet.", error: "Nom du projet ou fichiers manquants." });
        setIsConnecting(prev => ({ ...prev, deploy: false }));
        return;
    }

    // === 2. NORMALISATION DU NOM VERCEL (OBLIGATOIRE POUR L'API) ===
    let vercelProjectName = project.name.toLowerCase().trim();
    
    // Nettoyage pour respecter Vercel (minuscules, tirets)
    vercelProjectName = vercelProjectName.replace(/[^a-z0-9._-]/g, '-');
    vercelProjectName = vercelProjectName.replace(/-{2,}/g, '-');
    vercelProjectName = vercelProjectName.replace(/^[._-]+|[._-]+$/g, '');
    vercelProjectName = vercelProjectName.substring(0, 100);

    if (vercelProjectName.length === 0) {
        vercelProjectName = `default-app-${sandbox.substring(0, 4)}`;
    }
    
    // === 3. PRÉPARATION DES FICHIERS ===
    let projectFilesMap = {};
    try {
        project.files.forEach(file => {
            const relativePath = file.filePath.startsWith('/') ? file.filePath.substring(1) : file.filePath;
            if (file.content) {
              projectFilesMap[relativePath] = file.content;
            }
        });
        
        if (Object.keys(projectFilesMap).length === 0) {
            throw new Error("Aucun fichier valide à déployer n'a été trouvé dans le projet.");
        }
    } catch (e) {
        setDeploymentDetails({ status: "error", message: "Erreur de préparation des fichiers.", error: e.message || "Problème avec la structure de 'project.files'." });
        setIsConnecting(prev => ({ ...prev, deploy: false }));
        return; 
    }
    
    setDeploymentDetails(prev => ({ ...prev, status: "deploying", message: `Déploiement de "${vercelProjectName}" en cours...` }));

    // === 4. APPEL À L'API ===
    try {
      const response = await fetch("/api/deploy/vercel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: projectFilesMap,
          projectName: vercelProjectName,
          token: token,
          sandboxId: sandbox, 
        }),
      });

      const data = await response.json();
      if (data.success) {
        setDeploymentDetails({
          status: "success",
          message: "Déploiement lancé avec succès ! L'URL est en ligne.",
          url: data.url,
        });
      } else {
        setDeploymentDetails({
          status: "error",
          message: `Déploiement échoué : ${data.error || "Erreur inconnue"}`,
          error: data.details || data.error || "Erreur Vercel. Vérifiez les logs.",
        });
      }
    } catch (error) {
      console.error("[v0] Échec du déploiement:", error);
      setDeploymentDetails({
        status: "error",
        message: "Échec du déploiement (erreur réseau ou interne)",
        error: error.message || "Erreur inattendue. Voir la console.",
      });
    } finally {
      setIsConnecting(prev => ({ ...prev, deploy: false }));
    }
};
      



const parseMessageContent = (content: string) => {
  
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/)
  
  if (jsonMatch && jsonMatch[1]) {
    try {
      const jsonContent = JSON.parse(jsonMatch[1])
      
      // 1. Détection de la structure de Fichiers (Création/Modification complète)
      if (
        Array.isArray(jsonContent) &&
        jsonContent.length > 0 &&
        typeof jsonContent[0] === 'object' &&
        'filePath' in jsonContent[0] &&
        'content' in jsonContent[0]
      ) {
        return {
          type: 'files',
          data: jsonContent.map((f: any) => f.filePath as string), 
          raw: content, 
        }
      } 
      // 2. Détection de la structure de Changements de Fichiers (Patch: fileChanges)
      else if (
        typeof jsonContent === 'object' &&
        jsonContent !== null &&
        jsonContent.type === 'fileChanges' &&
        jsonContent.filePath
      ) {
        return {
          type: 'fileChanges', // Nouveau type
          data: [jsonContent.filePath as string], // Un seul fichier affecté
          raw: content, 
        }
      }
      // 3. Détection de l'URL d'inspiration
      else if (
        typeof jsonContent === 'object' &&
        jsonContent !== null &&
        jsonContent.type === 'inspirationUrl' &&
        jsonContent.url
      ) {
        return {
          type: 'url',
          data: jsonContent.url as string,
          raw: content,
        }
      }

    } catch (e) {
      // Ignorer l'erreur et afficher le contenu comme texte
    }
  }

  // 4. Cas par défaut: Contenu texte normal ou JSON mal formé/inconnu
  return {
    type: 'text',
    data: content,
  }
}
  


    // 1. CHARGEMENT INITIAL (Ajoute ceci dans tes useEffect)
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const storedProjects = await getAllProjectsFromIDB();
        if (storedProjects && storedProjects.length > 0) {
           setProjects(storedProjects);
           // Optionnel : Charger le dernier projet modifié ou le premier
           // loadProject(storedProjects[0].id); 
        }
      } catch (error) {
        console.error("Erreur chargement IDB:", error);
        addLog("Failed to load projects from database.");
      }
    };
    loadInitialData();
  }, []);


  // 2. FONCTION DE SAUVEGARDE GLOBALE
  // Remplace ton ancienne fonction saveProjectsToLocalStorage par celle-ci
  const saveProject = async () => {
    if (!currentProject) return;
    
    // On crée l'objet à jour
    const updatedProject = {
        ...currentProject,
        files: files,      // État actuel des fichiers
        messages: messages // État actuel du chat
    };

    try {
        // 1. Sauvegarde dans la DB (Persistance réelle)
        await saveProjectToIDB(updatedProject);
        
        // 2. Mise à jour de la liste locale (UI)
        setProjects(prev => prev.map(p => p.id === updatedProject.id ? updatedProject : p));
        
        // (Optionnel) addLog("Project saved.");
    } catch (error) {
        addLog("Error saving project!");
        console.error(error);
    }
  }


  // 3. CRÉATION DE PROJET
  const createNewProject = async () => {
    const projectName = prompt("Enter project name:", `Project ${projects.length + 1}`)
    if (!projectName) return
    
    const newProject = { 
      id: crypto.randomUUID(),
      name: projectName,
      createdAt: new Date().toISOString(),
      files: [],
      messages: [{ role: "assistant", content: `Project "${projectName}" is ready. What should we build?` }],
    }

    try {
        // On sauvegarde d'abord dans la DB pour être sûr
        await saveProjectToIDB(newProject);
        
        // Ensuite on met à jour l'UI
        const updatedProjects = [...projects, newProject]
        setProjects(updatedProjects)
        
        // Et on charge
        loadProject(newProject.id)
        addLog(`Project "${projectName}" created.`)
        
    } catch (err) {
        addLog("Error creating project in DB.")
    }
  }
  

  // 4. CHARGEMENT D'UN PROJET
  // Note : loadProject reste synchrone ici car on lit depuis l'état 'projects' 
  // qui a été peuplé par le useEffect au démarrage.
  const loadProject = (projectId: string) => {
    const projectToLoad = projects.find((p) => p.id === projectId)
    if (!projectToLoad) return

    setSandboxId(null)
    setPreviewUrl(null)
    addLog("Sandbox reset for new project.")
    
    setCurrentProject(projectToLoad)
    setFiles(projectToLoad.files)
    setMessages(projectToLoad.messages)
    setActiveFile(0)

    addLog(`Project "${projectToLoad.name}" loaded.`)
  }


  // 5. CHANGEMENT DE PROJET (CLICK)
  const handleProjectClick = async (projectId: string) => {
    if (currentProject) {
      // On attend que la sauvegarde soit finie avant de changer
      await saveProject() 
    }
    loadProject(projectId)
    setShowSidebar(false)
        }

const handleDeleteProject = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation(); // Empêche le clic de charger le projet alors qu'on veut le supprimer
    
    if (!confirm("Voulez-vous vraiment supprimer ce projet définitivement ?")) return;

    try {
        // 1. Supprimer de la DB
        await deleteProjectFromIDB(projectId);
        
        // 2. Mettre à jour l'interface (liste locale)
        const updatedList = projects.filter(p => p.id !== projectId);
        setProjects(updatedList);

        // 3. Si on supprime le projet en cours, on réinitialise
        if (currentProject?.id === projectId) {
            setCurrentProject(null);
            setFiles([]);
            setMessages([]);
            setSandboxId(null);
        }
        
        addLog("Projet supprimé avec succès.", "success");
    } catch (err) {
        console.error(err);
        addLog("Erreur lors de la suppression.", "error");
    }
            }
    

  const updateFile = (value: string, viewUpdate: any) => {
  if (viewUpdate.docChanged) {
    setFiles(prev => {
      const updated = [...prev]
      if (updated[activeFile]) updated[activeFile] = { ...updated[activeFile], content: value }
      return updated
    })

    if (currentProject) {
      const newFiles = [...currentProject.files]
      if (newFiles[activeFile]) newFiles[activeFile].content = value
      setCurrentProject({ ...currentProject, files: newFiles })
    }
  }
  }
  





const applyAndSetFiles = (responses: any[]) => {
  if (!currentProject) {
    addLog(`❌ Impossible d'appliquer les changements : aucun projet chargé.`)
    return
  }

  const newFiles = [...currentProject.files]
  let filesUpdated = false

  responses.forEach((res) => {
    if (res.type === "inspirationUrl") return // ignore les URL

    if (res.type === "fileChanges" && res.filePath && res.changes) {
      const idx = newFiles.findIndex(f => f.filePath === res.filePath)
      if (idx !== -1) {
        newFiles[idx].content = applyChanges(newFiles[idx].content, res.changes)
        filesUpdated = true
        addLog(`Applied ${res.changes.length} changes to ${res.filePath}`)
      }
    } else if (res.filePath && typeof res.content === "string") {
      const cleanContent = res.content
        .replace(/```[\s\S]*?```/g, "")
        .replace(/^diff\s*/gm, "")
        .trim()
      const idx = newFiles.findIndex(f => f.filePath === res.filePath)
      if (idx !== -1) {
        newFiles[idx].content = cleanContent
      } else {
        newFiles.push({ filePath: res.filePath, content: cleanContent })
      }
      filesUpdated = true
    }
  })

  if (filesUpdated) {
    // 🔑 Synchronisation avec projet et éditeur
    setCurrentProject({ ...currentProject, files: newFiles })
    setFiles(newFiles)
    addLog(`✅ Fichiers du projet mis à jour.`)
    setActiveTab("code")
    saveProject()
  } else {
    addLog(`❌ Pas de fichiers modifiés/ajoutés.`)
  }
}

          



  // NOTE: Cette fonction doit être définie dans le même scope que sendChat.


  const applyChanges = (originalContent: string, changes: any[]): string => {
  const lines = originalContent.split("\n");

  const deletions = changes.filter(c => c.action === "delete").sort((a, b) => b.startLine - a.startLine);
  const insertions = changes.filter(c => c.action === "insertAfter").sort((a, b) => b.lineNumber - a.lineNumber);
  const replacements = changes.filter(c => c.action === "replace");

  deletions.forEach(change => {
    const start = change.startLine - 1;
    const end = change.endLine - 1;
    if (start >= 0 && end >= start && end < lines.length) {
      lines.splice(start, end - start + 1);
    }
  });

  insertions.forEach(change => {
    const index = change.lineNumber - 1;
    if (index >= -1 && index < lines.length) {
      lines.splice(index + 1, 0, change.contentToInsert);
    }
  });

  replacements.forEach(change => {
    const index = change.lineNumber - 1;
    if (index >= 0 && index < lines.length) {
      lines[index] = change.newContent;
    }
  });

  return lines.join("\n");
};
  


                                   


  const applyArtifactsToProject = (finalArtifacts: FileArtifact[]) => {
  if (!currentProject) {
    addLog("❌ Aucun projet chargé, impossible d'appliquer les artifacts.");
    return;
  }

  const newFiles = [...currentProject.files];
  let projectUpdated = false;

  finalArtifacts.forEach((artifact) => {
    const index = newFiles.findIndex((f) => f.filePath === artifact.filePath);

    // Nettoyage du contenu reçu
    let rawContent = artifact.content || "";
    let cleanContent = rawContent
      .replace(/```[\s\S]*?```/g, "")
      .replace(/^diff\s*/gm, "")
      .trim();

    if (artifact.type === "create") {
      // Création ou remplacement complet
      if (index === -1) {
        newFiles.push({ filePath: artifact.filePath, content: cleanContent });
        addLog(`🆕 Fichier créé : ${artifact.filePath}`);
      } else {
        newFiles[index].content = cleanContent;
        addLog(`♻️ Fichier remplacé : ${artifact.filePath}`);
      }
      projectUpdated = true;
    }

    else if (artifact.type === "changes") {
      if (index !== -1) {
        try {
          // Tente de parser JSON des changements
          let patchData: any[] = [];
          try {
            patchData = JSON.parse(cleanContent || "[]");
          } catch {
            addLog(`⚠️ Patch JSON invalide pour ${artifact.filePath}, ignoré.`);
            return;
          }

          if (Array.isArray(patchData) && patchData.length > 0) {
            const original = newFiles[index].content;
            const newContent = applyChanges(original, patchData); // <-- Applique ligne par ligne
            newFiles[index].content = newContent;
            addLog(`✏️ ${patchData.length} changements appliqués à ${artifact.filePath}`);
            projectUpdated = true;
          } else {
            addLog(`⚠️ Aucun changement valide à appliquer pour ${artifact.filePath}`);
          }
        } catch (e) {
          addLog(`❌ Échec du patch sur ${artifact.filePath}: ${e}`);
        }
      } else {
        addLog(`⚠️ Fichier introuvable pour patch (${artifact.filePath})`);
      }
    }
  });

  if (projectUpdated) {
    setCurrentProject((prev) =>
      prev ? { ...prev, files: newFiles } : null
    );
    addLog(`✅ Projet mis à jour après application des artifacts.`);
    setActiveTab("code");
    saveProject();
  }
};


  
      

  
  const fillFilesFromGeminiResponse = (text: string) => {
    // --- Ligne de débogage ---
    // Affiche la réponse exacte de l'IA dans la console de votre navigateur (accessible avec F12)
    console.log("Texte brut reçu par fillFilesFromGeminiResponse:", text)

    let jsonString = ""
    // On cherche les délimiteurs d'un objet JSON `{...}`
    const firstBrace = text.indexOf("{")
    const lastBrace = text.lastIndexOf("}")

    // On cherche les délimiteurs d'un tableau JSON `[...]`
    const firstBracket = text.indexOf("[")
    const lastBracket = text.lastIndexOf("]")

    // On décide quelle structure extraire en priorité
    if (firstBrace !== -1 && lastBrace > firstBrace && (firstBracket === -1 || firstBrace < firstBracket)) {
      // Si on trouve un objet, et qu'il apparaît avant un éventuel tableau, on le choisit.
      jsonString = text.substring(firstBrace, lastBrace + 1)
    } else if (firstBracket !== -1 && lastBracket > firstBracket) {
      // Sinon, on choisit le tableau.
      jsonString = text.substring(firstBracket, lastBracket + 1)
    }

    if (!jsonString) {
      addLog(`❌ N'a trouvé aucune structure JSON ({...} ou [...]) dans la réponse.`)
      return
    }

    try {
      const parsed = JSON.parse(jsonString)

      if (Array.isArray(parsed)) {
        // Cas 1: C'est un tableau (pour la création de fichiers)
        applyAndSetFiles(parsed)
      } else if (typeof parsed === "object" && parsed !== null && parsed.type === "fileChanges") {
        // Cas 2: C'est un objet unique pour la modification d'un fichier
        applyAndSetFiles([parsed]) // On l'encapsule dans un tableau pour la fonction suivante
      } else {
        addLog(`❌ Le JSON a été parsé mais son format n'est pas reconnu.`)
      }
    } catch (e: any) {
      addLog(`❌ Échec du parsage du JSON extrait. Erreur: ${e.message}`)
      addLog(`--- Chaîne qui a échoué ---`)
      addLog(jsonString)
      addLog(`--------------------------`)
    }
  }

  




// ⚠️ À placer APRÈS la déclaration de vos states (e.g., `logsHeight`, `currentProject`, `messages`, `loading`, etc.)

/**
 * Lit les données d'analyse volumineuses stockées temporairement,
 * crée les fichiers Next.js correspondants dans le sandbox (app/page.tsx et app/globals.css),
 * puis notifie le LLM.
 */


  
// SandboxPage.tsx

/**
 * Traite le résultat de l'analyse d'URL après clonage, met à jour les fichiers locaux 
 * du projet et envoie un prompt d'injection détaillé à Gemini.
 */
const processAnalysisResult = async (fullHTML: string, fullCSS: string, fullJS: string, urlToAnalyze: string,) => {
    // Vérification de l'état du projet (inchangée)
    if (!currentProject || !setCurrentProject) {
        addLog("ERROR: Project state is missing or cannot be updated.")
        throw new Error("Project state is missing or cannot be updated.")
    }

    addLog(`[CLONE-FLOW] Phase 2: Updating local project files for ${urlToAnalyze}...`)
    setAnalysisStatus(`2/2: Mise à jour du projet local...`)

    // --- 1. Préparation du contenu des fichiers ---
    const trimmedHTML = fullHTML.trim();
    const trimmedJS = fullJS.trim();

    // Fonction d'échappement pour intégrer le contenu dans les templates litéraux (backticks)
    const escapeContent = (content: string) => {
        return content
            .replace(/\\/g, '\\\\') 
            .replace(/`/g, '\\`')
            .replace(/\$/g, '\\$');
    };
    
    const escapedHTML = escapeContent(trimmedHTML);
    const escapedJS = escapeContent(trimmedJS);

    // Contenu du nouveau app/page.tsx (avec CSS et JS intégrés)
    const newPageContent = `"use client"\n\nimport React from 'react'\n\nconst ClonedPage = () => {\n  return (\n    <>\n      <div\n        dangerouslySetInnerHTML={{ __html: \`${escapedHTML}\` }}\n      />\n      {${!!trimmedJS} && (\n          <script\n            dangerouslySetInnerHTML={{ __html: \`${escapedJS}\` }}\n          />\n      )}\n    </>\n  )\n}\n\nexport default ClonedPage`
    
    // Fichiers à mettre à jour
    const filesToUpdate = [
        { filePath: "app/globals.css", content: fullCSS },
        { filePath: "app/page.tsx", content: newPageContent },
    ]

    // --- 2. Mise à jour de l'état local du projet ---
    const newFilesMap = new Map(currentProject.files.map(f => [f.filePath, f]))

    for (const { filePath, content } of filesToUpdate) {
        newFilesMap.set(filePath, { filePath, content })
    }

    const updatedFiles = Array.from(newFilesMap.values())

    setCurrentProject(prevProject => {
        if (!prevProject) return null
        return {
            ...prevProject,
            files: updatedFiles, 
        }
    })
    
    addLog("[CLONE-FLOW] ✅ Local project files updated.");

    // --- 3. Construction du prompt d'injection de contexte pour Gemini ---
    let injectionContext = `
[ACTION AUTOMATISÉE DE CLONAGE]
Le code du site ${urlToAnalyze} a été cloné et écrit dans les fichiers suivants. Vous avez maintenant ce code pour référence dans ce tour de conversation.
`;

    filesToUpdate.forEach(file => {
        addLog(`[CLONE-FLOW] Injecting ${file.filePath} (${file.content.length} chars) into Gemini's prompt.`);

        injectionContext += `
[CONTENU DU FICHIER: ${file.filePath}]
\`\`\`${file.filePath.split('.').pop() || 'text'}
${file.content}
\`\`\`
[FIN CONTENU FICHIER: ${file.filePath}]

`;
    });

    // 🛑 NOUVEAU: On combine le contexte d'injection avec la demande originale. 
    // Cela force l'IA à considérer TOUT ce bloc comme son dernier message utilisateur.
    const finalInjectionPrompt = `
    Le site web ${urlToAnalyze} a été cloné. Les fichiers code source de celui-ci ont été créé et je pense que tu peux les voir dans ton historique. Confirme si tu peux les voir a l'utilisateur sans faire comme si tu répondais au message actuel. Et donne lui juste un peu de détails sur les fichiers du style à voir de quoi le site web parle et ce su'il contient. Pas besoin d'ultra analyse. C'est juste une confirmation.
    `;

    addLog("[CLONE-FLOW] ✅ Notifying Gemini with full file content...");
    
    // Appel de la fonction sendChat (qui est maintenant stable sans useCallback)
    await sendChat(finalInjectionPrompt) 
  }
          

  
  
              


/**
 * Gère le flux d'analyse complet, de l'envoi de l'URL à la création des fichiers.
 * Cette fonction est appelée soit par l'input (Clone website), soit par sendChat (artefact 'url').
 */



  

// ⚠️ Assurez-vous que parseRootVariables, extractFontFaces, findPotentialComponents, 
// cloneWithComputedStyles et sendChat sont disponibles dans le scope.
const runIsolationAndGeneration = async (
  fullHTML: string,
  fullCSS: string,
  baseURL: string,
  urlToAnalyze: string,
  originalUserPrompt: string
) => {
  setAnalysisStatus(`2/4: Analyse CSS et recherche des composants...`)
  
  const globalCssVariables = parseRootVariables(fullCSS)
  const fontFaces = extractFontFaces(fullCSS)
  const componentsToFind = findPotentialComponents(fullHTML)
  const isolatedComponents: { name: string; html: string }[] = []

  addLog(`[AUTO-FLOW] Found ${componentsToFind.length} relevant components to isolate.`)

  // --- Isolation de chaque composant ---
  for (const comp of componentsToFind) {
    setAnalysisStatus(`3/4: Isolation du composant: ${comp.tag}...`)
    addLog(`[AUTO-FLOW] Isolating component: ${comp.tag} (${comp.selector})`)

    const hiddenIframe = document.createElement("iframe")
    hiddenIframe.style.display = "none"
    document.body.appendChild(hiddenIframe)

    const isolatedHtml = await new Promise<string>((resolve, reject) => {
      hiddenIframe.onload = () => {
        const iframeDoc = hiddenIframe.contentDocument
        if (!iframeDoc) return reject(new Error("Could not access iframe document."))
        const element = iframeDoc.querySelector(comp.selector)
        if (element) resolve(cloneWithComputedStyles(element).outerHTML)
        else resolve("")
        document.body.removeChild(hiddenIframe)
      }
      hiddenIframe.srcdoc = `<!DOCTYPE html><html><head><base href="${baseURL}"><style>${fullCSS}</style></head><body>${fullHTML}</body></html>`
    })

    if (isolatedHtml) {
      isolatedComponents.push({ name: comp.tag, html: isolatedHtml })
      addLog(`[AUTO-FLOW] ✅ Component ${comp.tag} isolated successfully.`)
    }
  }

  setAnalysisStatus(`4/4: Préparation des données d'analyse...`)
  addLog(`[AUTO-FLOW] Analysis done. Returning structured data.`)

  return {
    urlToAnalyze,
    globalCssVariables,
    fontFaces,
    isolatedComponents,
    originalUserPrompt
  }
                                      }
          


             // -----------------------------------------------------
// 🔗 Liaison entre Gemini et le module d'analyse automatique
// -----------------------------------------------------
const handleInspirationUrl = async (url: string, originalUserPrompt: string) => {
  try {
    addLog(`[AUTO-FLOW] 🚀 Inspiration URL détectée: ${url}`);
    addLog(`[AUTO-FLOW] Déclenchement automatique de runAutomatedAnalysis pour ${url}`);
    
    // On appelle directement ta logique principale
    await runAutomatedAnalysis(url, originalUserPrompt, false);

  } catch (err: any) {
    addLog(`❌ Erreur pendant handleInspirationUrl: ${err.message}`);
  }
};


const runAutomatedAnalysis = async (
  urlToAnalyze: string,
  originalUserPrompt: string,
  isCloning: boolean = false
) => {
  if (!sandboxId) { 
    addLog("⚠️ Please create a sandbox first.");
    return;
  }

  setLoading(true);
  setIsCloning(false);
  setCloneUrl("");

  let fullCSS = '';
  let fullHTML = '';
  let fullJS = '';
  let baseURL = '';
  
  // 🛑 Tags structuraux clés à cibler par l'IA (Les blocs de design à réutiliser)
  const STRUCTURAL_TAGS = [
      'header', 'nav', 'main', 'aside', 'footer', 'section', 'article', 
      'h1', 'h2', 'a', 'button', 'input', 'form', 'figure', 'div[class*="card"]', 'div[class*="cta"]'
  ];
  const tagsList = STRUCTURAL_TAGS.join(', ');

  // =========================================================================
  // === DÉBUT DU FLUX RUNAUTOMATEDANALYSIS ===
  // =========================================================================

  try {
    setAnalysisStatus(`1/2: Analyse de ${urlToAnalyze} (Récupération des données)...`);
    addLog(`[AUTO-FLOW] Phase 1: Calling analysis API for ${urlToAnalyze}`);

    // --- Étape 1 : Récupération des données via ton API analyse ---
    const analysisRes = await fetch("/api/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: urlToAnalyze }),
    });

    const analysisData = await analysisRes.json();

    if (!analysisRes.ok || !analysisData.success) {
      addLog(`❌ Analysis API responded with error: ${analysisData.error || analysisRes.statusText}`);
      throw new Error(`Analysis API failed: ${analysisData.error || analysisRes.statusText}`);
    }

    // --- Étape 2 : Extraction du contenu ---
    fullCSS = analysisData.fullCSS || '';
    fullHTML = analysisData.fullHTML || '';
    fullJS = analysisData.fullJS || '';

    addLog(`[DEBUG] HTML size: ${fullHTML.length}, CSS size: ${fullCSS.length}, JS size: ${fullJS.length}`);

    baseURL = new URL(urlToAnalyze).origin;

    if (!fullHTML || !fullCSS || fullCSS.trim().length < 50) {
      throw new Error("Analysis failed: Le fullHTML ou le fullCSS est manquant/vide. Impossible de procéder à la génération de design.");
    }
    
    // --- Étape 3 : DISPATCH logique selon mode ---
    if (isCloning) {
      await processAnalysisResult(fullHTML, fullCSS, fullJS, urlToAnalyze); 
    } else {
      // 🧠 NOUVELLE ÉTAPE : Création du contexte avec FULL HTML et instructions renforcées
      setAnalysisStatus(`2/2: Envoi du contexte d'analyse renforcé à l'IA...`);
      addLog("[AUTO-FLOW] Sending FULL HTML + FULL CSS with maximum reinforced application instructions to Gemini.");
      
      const analysisContext = `
        Voici les fullhtml et fullcss reçu après que toi Gemini est lancée l'inspirationUrl, ne la relance plus, sert toi de ces fullhtml et fullcss  :
        - fullHTML (Code source complet de la Landing Page)
        - fullCSS (Styles globaux et variables du Système de Design)

        OBJECTIF FINAL: Ton but est de construire le logiciel complet demandé par l'utilisateur avec un **ultra design** basé sur l'esthétique du fullCSS/fullHTML, mais avec une **structure logique et fonctionnelle** pour des pages d'application modernes.

        ### 🚨 RÈGLES D'ADAPTATION STRUCTURELLE CRITIQUES 🚨
        
        La différence entre une Landing Page et une Page d'Application est **structurelle** et **fonctionnelle**.

        1.  **FULLHTML (Landing Page) : Source d'Inspiration de Composants (Atomes et Molécules).**
            * Le fullHTML est le plan de conception d'une vitrine. **Il ne doit JAMAIS servir de plan de construction global.**
            * **INTERDICTION ABSOLUE de Copier la Méta-Structure :** Tu ne dois *pas* réutiliser la structure complète du Header de la Landing Page, du Footer complet, ni la séquence des sections principales. Ces éléments sont spécifiques à une page unique de marketing.
            * **PRIORITÉ MAXIMALE : Focus sur les Composants Structuraux :** Concentre-toi sur l'extraction des patterns de design des éléments réutilisables suivants. Ces balises représentent les **blocs de construction** à adapter : **${tagsList}**.
            * **DEVOIR :** Lorsque tu construis une page d'application (ex: Dashboard, Profil, Settings), tu dois créer une structure D'APPLICATION appropriée (ex: Sidebar de navigation, En-tête de Dashboard minimaliste, Zone de contenu principal en grille/flex). Ensuite, tu dois injecter le **style visuel** et la **micro-structure HTML/CSS** des éléments ciblés ci-dessus.

        2.  **FULLCSS (Système de Design) : Le "Miel" du Style (Couleurs, Typographie).**
            * Le fullCSS est ton guide de style. Il garantit la cohérence visuelle.
            * **Extraction sélective stricte :** N'utilise que les déclarations CSS vitales (Variables de couleur, Polices, Mixins/Fonctions clés). **Ne copie pas plus de 45% du code total** dans \`app/globals.css\`.
            * **Maintien du Style :** Même en adaptant la structure, le **rendu visuel final** (couleurs, ombres, coins arrondis, polices) doit être cohérent avec l'esthétique fournie par le fullCSS.

        3.  **SYNTHÈSE : Objectif de Transformation.**
            * **Transformer la Structure Marketing (Landing Page) en Structure Fonctionnelle (App).**
            * **Ton code doit être fonctionnel, modulaire et utiliser les patterns de design adaptés de la source, mais *dans un contexte d'application*.**

       4. Construit le projet de l'utilisateur dont il t'a fait complètement dès le début: celle ci: ${originalUserPrompt}, les étapes de base. les fullhtml fullcss qui sont ci dessous sont justes pour les designs.

        --- FULL HTML START (Landing Page Structure & Patterns) ---
        ${fullHTML}
        --- FULL HTML END ---

        --- FULL CSS START (Système de Design) ---
        ${fullCSS}
        --- FULL CSS END ---

        génère des fichiers complets et sans donner d'instructions ou explications sur le code que tu as généré. Génère au bon format comme il t'a été instruit dans tes instructions.
        Surtout, ne lance plus une autre InspirationUrl car celle-ci est largement suffisante.
        
      `;
      
      // 🚀 Envoi à ton système IA (api/gemini)
      await sendChat(`${analysisContext}`);
    }

  } catch (err: any) {
    const errorMessage = err.message || "Une erreur inconnue est survenue.";
    addLog(`❌ ERROR during automated analysis: ${errorMessage}`);
    setAnalysisStatus(`Erreur durant l'analyse: ${errorMessage}`);
  } finally {
    setLoading(false);
    setAnalysisStatus(null);
  }
};
                                                  
      

const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const remainingSlots = MAX_FILES - (uploadedImages.length + uploadedFiles.length);

    if (remainingSlots <= 0) {
        addLog("ERROR: Limite maximale d'uploads (images + fichiers) atteinte.");
        event.target.value = '';
        return;
    }

    const filesToProcess = Array.from(files).slice(0, remainingSlots);

    const readAndProcessFile = (file: File) => {
        if (!file.type.startsWith('image/')) {
            addLog(`ERROR: Fichier non supporté: ${file.name}`);
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const base64Url = e.target?.result as string;

            setUploadedImages((prev) => {
                // 🛑 CORRECTION: Vérification de l'existence par le Base64 
                // ou par un identifiant unique (ici, nous utilisons le Base64).
                // Cette vérification garantit l'idempotence contre le Strict Mode.
                if (prev.includes(base64Url)) {
                    return prev;
                }
                return [...prev, base64Url];
            });
        };
        reader.readAsDataURL(file);
    };

    filesToProcess.forEach(readAndProcessFile);
    
    // Réinitialise l'input
    event.target.value = '';
};
                                        
  



const handleScreenshot = async () => {
    if (uploadedImages.length + uploadedFiles.length >= MAX_FILES) {
        addLog("Limite d'uploads atteinte.");
        setIsPlusDropdownOpen(false);
        return;
    }
    
    setIsPlusDropdownOpen(false);

    // 🛑 VÉRIFICATION ROBUSTE de l'existence de l'API
    if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
        addLog("ERROR: Votre navigateur ou l'environnement actuel ne supporte pas la fonction de capture d'écran d'onglet (getDisplayMedia).");
        return;
    }

    try {
        addLog("Démarrage de la capture d'écran. Veuillez sélectionner l'onglet à partager...");
        
        // 1. Demande de capture
        // Utilisation du type correct pour garantir la compatibilité
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { mediaSource: 'tab' as any }, // 'tab' est une bonne suggestion pour cibler un onglet
            audio: false,
        });

        const videoTrack = stream.getVideoTracks()[0];
        if (!videoTrack) throw new Error("Capture annulée ou aucune piste vidéo n'a pu être obtenue.");

        // 2. Capture de l'image
        const imageCapture = new (window as any).ImageCapture(videoTrack);
        const bitmap = await imageCapture.grabFrame();

        // 3. Conversion en Base64
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("Impossible de créer le contexte du canvas.");
        ctx.drawImage(bitmap, 0, 0);

        const base64Url = canvas.toDataURL('image/png');
        
        // 4. Nettoyage
        videoTrack.stop();
        stream.getTracks().forEach(track => track.stop());
        
        // 5. Mise à jour de l'état
        setUploadedImages(prev => [...prev, base64Url]);
        addLog("Capture d'écran ajoutée avec succès.");

    } catch (err: any) {
        // Gère l'erreur d'annulation par l'utilisateur (nom souvent différent)
        if (err.name === "NotAllowedError" || err.message.includes("cancelled")) {
            addLog("Capture d'écran annulée par l'utilisateur.");
        } else {
             addLog(`ERROR: Échec de la capture d'écran: ${err.message}`);
        }
    }
};
          



const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const readAndProcessFile = (file: File) => {
        // Exclut les types non supportés (Audio, Vidéo, Images, etc.)
        if (file.type.startsWith('audio/') || file.type.startsWith('video/') || file.type.startsWith('image/')) {
            addLog(`ERROR: Le type de fichier ${file.type} n'est pas supporté par ce bouton.`);
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const base64Url = e.target?.result as string;
            // Extrait la partie Base64 pure pour l'envoi à l'IA
            const base64Content = base64Url.split(',')[1] || ""; 
            
            setUploadedFiles((prev) => {
                if (prev.length >= MAX_FILES) return prev;
                return [...prev, { fileName: file.name, base64Content }];
            });
        };
        reader.readAsDataURL(file); // Utiliser DataURL pour obtenir le Base64
    };

    Array.from(files).slice(0, MAX_FILES - (uploadedImages.length + uploadedFiles.length)).forEach(readAndProcessFile);
    event.target.value = '';
    setIsPlusDropdownOpen(false);
};
      

  



  const handleMentionFile = (filePath: string) => {
    setMentionedFiles((prev) => {
        // Basculement : si déjà présent, on le retire, sinon on l'ajoute
        if (prev.includes(filePath)) {
            return prev.filter(p => p !== filePath);
        }
        return [...prev, filePath];
    });
};

const handleRemoveMention = (filePath: string) => {
    setMentionedFiles((prev) => prev.filter(p => p !== filePath));
};
                

  

  
      
        // --- MISE À JOUR DES MESSAGES DANS LE STATE ---



// --- NOUVELLE FONCTION D'INDEXATION RAG (À placer avec vos autres fonctions) ---

/**
 * Fonction pour mettre à jour les embeddings du projet (logique RAG)
 * Utilisée pour l'indexation du code du projet dans la base de données vectorielle.
 */
// --- Empêche les répétitions et les boucles RAG infinies ---
const ragRunningRef = useRef(false);

const handleUpdateEmbeddings = useCallback(async () => {
  if (!currentProject || !currentProject.id) return;
  if (ragRunningRef.current) return;
  
  ragRunningRef.current = true;
  try {
    const files = currentProject.files || [];
    const indexChunks: IndexedChunk[] = [];

if (!files || files.length === 0 || files.every(f => !f.content?.trim())) {
  addLog(`[RAG] ⚠️ Aucun contenu détecté à indexer — arrêt de la boucle.`);
  return;
    }
            
  
    addLog(`[RAG] 🧠 Démarrage de la mise à jour des embeddings pour ${files.length} fichiers...`);

    for (const file of files) {
      const chunks = indexFileContent(file);
      if (Array.isArray(chunks)) indexChunks.push(...chunks);
    }

    if (indexChunks.length === 0) {
      addLog(`[RAG] Aucun contenu à indexer.`);
      return;
    }

    const success = await updateProjectEmbeddings(currentProject.id, indexChunks);
    if (success) addLog(`[RAG] ✅ Indexation réussie.`);
  } catch (err: any) {
    addLog(`[RAG] ❌ Erreur: ${err.message}`);
  } finally {
    ragRunningRef.current = false;
  }
}, [currentProject, addLog]);
  


// --- NOUVELLE FONCTION POUR SOUMETTRE LE CHAT (Formulaire) ---
const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Votre sendChat existant prend l'input du chat en interne
    sendChat(); 
}





  // SandboxPage.tsx

/**
 * Lit le contenu d'un fichier du projet et relance sendChat avec le contenu injecté.
 * Cette fonction est appelée UNIQUEMENT après la détection de l'artefact <read_file> dans le stream.
 * * @param filePath Le chemin du fichier demandé par l'IA.
 * @param currentProjectFiles La liste des fichiers disponibles pour la lecture.
 * @param messages L'historique des messages pour déterminer la dernière requête utilisateur.
 */

  

  /**
 * Lit le contenu d'un fichier du projet et l'envoie à Gemini via sendFileToGemini.
 * Déclenchée quand l'IA émet <read_file path="..."/>.
 */

      
  
 
            // --- FONCTION sendChat INTÉGRALE ET FINALE (RAG, Historique, Artefacts) ---

                
// SandboxPage.tsx


  /**
 * Nouvelle version : lecture de fichier via <fetch_file path="..."/> 
 * sans utiliser l’ancien artefact <read_file>.
 */

/**
 * 🧩 Version améliorée : lecture et analyse de fichier envoyée à Gemini
 */

      
    

/**
 * Envoie directement le contenu d’un fichier à Gemini sans passer par sendChat().
 * Utilisé quand l’IA demande <read_file path="..."/>.
 */
const sendFileToGemini = async (
  filePath: string,
  fileContent: string,
  lastUserMessage: string,
  addLog: (msg: string) => void,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  currentProjectFiles: ProjectFile[]
) => {
  try {
    addLog(`📤 [sendFileToGemini] Injection du fichier ${filePath} vers Gemini...`);

    // 🧩 Création du prompt d'injection
    const injectionPrompt = `
[CONTENU DU FICHIER REQUIS PAR VOUS : ${filePath}]

[FIN CONTENU FICHIER]

✅ Vous avez maintenant le contenu COMPLET du fichier ${filePath}.
Veuillez analyser ce fichier et continuer votre réponse à la dernière requête utilisateur :
"${lastUserMessage}"

Ne redemandez PAS ce fichier. Si vous avez besoin d'un autre, émettez simplement une autre balise <read_file path="..."/>.
`;

    addLog(`✅ [sendFileToGemini] ${filePath} injecté (${fileContent.length} caractères)`);

    // 🧠 Affiche dans le chat
    setMessages((prev) => [
      ...prev,
      { role: "system", content: `✅ Fichier ${filePath} injecté avec succès (${fileContent.length} caractères)` },
    ]);

    // 🔄 Envoi direct à ton API Gemini
    const res = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        history: [
          { role: "user", content: injectionPrompt }
        ],
        currentProjectFiles: currentProjectFiles,
      }),
    });

    if (!res.ok) throw new Error(`Gemini API request failed: ${res.statusText}`);
    const data = await res.text();

    addLog(`💬 [sendFileToGemini] Réponse reçue (${data.length} caractères)`);

    // 🪄 Affiche la réponse de Gemini dans le chat
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: data },
    ]);

  } catch (err: any) {
    addLog(`❌ [sendFileToGemini] Erreur: ${err.message}`);
    setMessages((prev) => [
      ...prev,
      { role: "system", content: `Erreur lors de l'envoi du fichier ${filePath}: ${err.message}` },
    ]);
  }
};
  

    

// SandboxPage.tsx

// Constante pour la regex (à s'assurer qu'elle est définie au début du composant)


              

    

                    
            // ---------------------- GLOBALS ----------------------
  // Constante pour la regex (à s'assurer qu'elle est définie au début du composant)
// Exemple: const FETCH_FILE_REGEX = /<fetch_file\s+path=["']([^"']+)["'][^>]*\/>/i;

// ---------------------- GLOBALS ----------------------
let isFetchInProgress = false; // Bloque les fetch en double

// **NOUVEAU:** Cache local pour cette session, pour éviter les relectures non nécessaires d'un fichier déjà injecté.
// Ceci n'est pas géré par le code ci-dessous, mais sera géré par la logique dans sendChat.

// ---------------------- HANDLE FETCH FILE ----------------------
/**
 * Lit un fichier et retourne son contenu formaté (sans relancer sendChat)
 */
const handleFetchFileAction = async (
  filePath: string,
  projectFiles: ProjectFile[],
  // NOTE: Le paramètre 'messages' n'est pas utilisé ici et peut être omis.
): Promise<string> => { 
  if (isFetchInProgress) {
    // Si déjà en cours, retourne immédiatement.
    addLog(`⚠️ [FETCH_FILE] Ignoré (déjà en cours pour ${filePath})`);
    return "";
  }

  isFetchInProgress = true;

  try {
    addLog(`📂 [FETCH_FILE] Demande de lecture du fichier : ${filePath}`);

    const targetFile = projectFiles.find(f => f.filePath === filePath);
    if (!targetFile) {
      addLog(`❌ [FETCH_FILE] Fichier introuvable : ${filePath}`);
      // Retourne une balise d'erreur pour que l'IA le voie.
      return `<file_content path="${filePath}" error="File not found."></file_content>`;
    }

    const content = targetFile.content || "";
    const lines = content.split("\n");
    const totalLines = lines.length;

    addLog(`✅ [FETCH_FILE] Fichier trouvé (${content.length} caractères, ${totalLines} lignes). Préparation pour envoi...`);

    // Formatte le contenu ligne par ligne
    const formattedFile = [
      `<file_content path="${filePath}" totalLines="${totalLines}">`,
      ...lines.map((line, i) => `${i + 1} | ${line}`),
      `</file_content>`
    ].join("\n");

    addLog(`📤 [FETCH_FILE] Contenu prêt pour injection (${totalLines} lignes)`);

    return formattedFile;
  } finally {
    isFetchInProgress = false;
  }
};


// ---------------------- SEND CHAT ----------------------


     // ---------------------- DÉFINITIONS GLOBALES (VÉRIFIEZ BASE_DELAY_MS) ----------------------
// Définir ces constantes au début du composant, en dehors de sendChat
const MAX_RETRIES = 10;
// 🔥 CORRECTION DE LA BASE DE DÉLAI: Utilisable pour le backoff exponentiel
const BASE_DELAY_MS = 500; 
// Limite stricte de 6000 caractères pour inclure le contenu complet
const CONTENT_SNAPSHOT_LIMIT = 50000; 

// Définitions de Regex rendues accessibles globalement pour la fonction
const inspirationUrlRegex = /```json\s*\{[\s\S]*?"type"\s*:\s*"inspirationUrl"[\s\S]*?\}/;
// Assurez-vous que FETCH_FILE_REGEX est aussi définie ici si elle n'est pas globale
// const FETCH_FILE_REGEX = /<fetch_file path=["']([^"']+)["'][^>]*\/>/g; 


// ---------------------- SEND CHAT (AVEC CONTEXTE ET FILTRAGE) ----------------------


const sendChat = async (promptOverride?: string) => {
  const userPrompt = promptOverride || chatInput;

  if (!userPrompt && uploadedImages.length === 0 && uploadedFiles.length === 0 && mentionedFiles.length === 0) return;
  if (!currentProject && !promptOverride) {
    addLog("Please create or load a project before starting a conversation.");
    return;
  }

  // 1. Préparation du message utilisateur
  let contextForPrompt = "";
  if (mentionedFiles.length > 0 && currentProject) {
    contextForPrompt = "\n[MENTIONED PROJECT FILES: " + mentionedFiles.join(', ') + "]";
  }
  const finalUserPrompt = userPrompt + contextForPrompt;

  const userMsg: Message = {
    role: "user",
    content: finalUserPrompt,
    artifactData: { type: null, rawJson: "", parsedList: [] },
    images: uploadedImages,
    externalFiles: uploadedFiles,
    mentionedFiles
  };

  // 2. Préparation du placeholder
  const assistantPlaceholder: Message = {
    role: "assistant",
    content: "",
    artifactData: { type: null, rawJson: "", parsedList: [] }
  };
  
  // 3. Logique de mise à jour de l'état
  let currentHistory = [...messages, userMsg];
  let assistantMessageIndex = -1;
  
  setMessages((prev) => {
    assistantMessageIndex = prev.length + 1; 
    if (!promptOverride) {
      setChatInput("");
    }
    return [...prev, userMsg, assistantPlaceholder];
  });
  
  const currentProjectFiles = currentProject
    ? currentProject.files.map((f: any) => ({ filePath: f.filePath, content: f.content }))
    : [];

  // ---------------- INJECTION DU CONTEXTE SYSTÈME ----------------
  
  const filesList: string[] = [];
  const filesContentSnapshots: string[] = [];
  let filesExcludedCount = 0; 

  currentProjectFiles.forEach(file => {
      const content = file.content || "";
      const size = content.length;
      let fileStatus = '';

      if (size > 0 && size <= CONTENT_SNAPSHOT_LIMIT) {
          const lines = content.split('\n');
          const contentWithLineNumbers = lines.map((line, index) => `${index + 1}: ${line}`).join('\n');
          
          filesContentSnapshots.push(
              `<file_content_snapshot path="${file.filePath}" totalLines="${lines.length}">\n` +
              contentWithLineNumbers + 
              `\n</file_content_snapshot>`
          );
          fileStatus = `(Content snapshot INCLUDED: ${size} chars)`;

      } else if (size > CONTENT_SNAPSHOT_LIMIT) {
          filesExcludedCount++;
          fileStatus = `(Content EXCLUDED: ${size} chars > ${CONTENT_SNAPSHOT_LIMIT} limit)`;
      } else {
          fileStatus = `(EMPTY file)`;
      }
      filesList.push(`<project_file path="${file.filePath}" ${fileStatus.trim()}/>`);
  });

  const systemFileContext: Message = {
    role: "system",
    content: (
        `# PROJECT FILES (${currentProjectFiles.length} files total)\n` +
        `[Use the <fetch_file path="..."/> artifact to read content for files excluded or not included below.]\n` +
        (filesExcludedCount > 0 ? `⚠️ ${filesExcludedCount} files were EXCLUDED from initial context injection.\n` : '') +
        filesList.join("\n") +
        (filesContentSnapshots.length > 0 ? `\n\n# INJECTED FILE CONTENT SNAPSHOTS\n` + filesContentSnapshots.join("\n\n") : "")
    )
  };

  let historyForApi = [systemFileContext, ...currentHistory];
  const readFilesCache = new Set<string>();

  setLoading(true);
  addLog(`Sending prompt to Gemini...`);

// 1. ON RÉCUPÈRE L'IMAGE DU SHOP (SILENCIEUSEMENT)
  let activeShopImage = null;
  try {
      activeShopImage = await getActiveShopImage();
      if (activeShopImage) {
          addLog("🎨 Applying visual style from Design Shop...");
      }
  } catch (e) { console.error("Erreur image shop", e); }
  
  // 🔥 AJOUT CLÉ API : Récupération depuis IndexedDB
  let apiKey = "";
  try {
      const dbKey = await getApiKeyFromIDB();
      if (dbKey) apiKey = dbKey;
      else console.warn("Aucune clé API trouvée dans la base de données.");
  } catch (e) {
      console.warn("Erreur lecture clé API:", e);
  }
  
  let urlArtifact: any = null;
  let text = "";
  let retryCount = 0;
  let finalAssistantMessage: Message | undefined = undefined; 
  
  try {
    let res: Response | null = null;
    let apiCallSuccessful = false;

    // ---------------- BOUCLE DE RETRY ----------------
    while (!apiCallSuccessful && retryCount < MAX_RETRIES) {
      try {
        if (retryCount > 0) {
          const delay = Math.min(BASE_DELAY_MS * Math.pow(2, retryCount - 1), 5000); 
          addLog(`[RETRY] Tentative ${retryCount + 1}/${MAX_RETRIES}... Attente ${delay}ms.`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        res = await fetch("/api/gemini", {
          method: "POST",
          headers: { 
              "Content-Type": "application/json",
              "x-gemini-api-key": apiKey // 🔥 Envoi de la clé dans les headers
          },
          body: JSON.stringify({ 
            history: historyForApi, 
            currentProjectFiles,
            uploadedImages,
            uploadedFiles,
            referenceImageBase64: activeShopImage
          }),
        });

        if (!res.ok || !res.body) {
          throw new Error(`Gemini API request failed: ${res.statusText}`);
        }
        apiCallSuccessful = true;
        retryCount = 0;
      } catch (e: any) {
        console.error(`API Call failed on attempt ${retryCount + 1}:`, e.message);
        retryCount++;
        if (retryCount >= MAX_RETRIES) throw new Error(`Gemini API failed after ${MAX_RETRIES} retries.`);
        res = null; 
      }
    }

    if (!res || !res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    
    // -------- STREAMING LOOP ---------- 
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      text += chunk;

      // ---------------- FETCH FILE ----------------
      const fetchFileMatch = text.match(FETCH_FILE_REGEX);
      if (fetchFileMatch) {
        const filePath = fetchFileMatch[1].trim();
        addLog(`[ACTION] Gemini requested file: ${filePath}`);

        const isContentPreInjected = currentProjectFiles.some(
            f => f.filePath === filePath && (f.content || "").length <= CONTENT_SNAPSHOT_LIMIT
        );
        
        if (!isFetchInProgress && !readFilesCache.has(filePath) && !isContentPreInjected) {
          const fileContent = await handleFetchFileAction(filePath, currentProjectFiles); 
          if (fileContent) {
            text += `\n${fileContent}\n`; 
            readFilesCache.add(filePath); 
            
            setMessages((prev) => {
              const updated = [...prev];
              if (assistantMessageIndex >= 0 && assistantMessageIndex < updated.length) {
                  updated[assistantMessageIndex].content = text;
              }
              return updated;
            });
          }
        }
      }

      // ----------------- URL ARTIFACT -----------------
      const urlMatch = text.match(inspirationUrlRegex);
      if (urlMatch) {
        try {
          const jsonString = urlMatch[0].replace(/```json|```/g, '').trim();
          const parsedUrlData = JSON.parse(jsonString);
          if (parsedUrlData.type === 'inspirationUrl' && parsedUrlData.url) {
            urlArtifact = { url: parsedUrlData.url };
          }
        } catch (e) { console.error("Failed to parse URL JSON:", e); }
      }

      // ----------------- FILE ARTIFACTS -----------------
      const fileArtifacts = extractFileArtifacts(text);

      fileArtifacts.forEach((artifact: any) => {
        if (artifact.type === "changes" && artifact.content && !artifact.content.trim().endsWith("</file_changes>")) {
          artifact.content += "\n</file_changes>";
        }
        if (artifact.type === "create" && artifact.content && !artifact.content.trim().endsWith("</create_file>")) {
          artifact.content += "\n</create_file>";
        }
      });

      const incompleteRegex = /<(create_file|file_changes)\s+path=["']([^"']+)["'][^>]*>(?![\s\S]*<\/(?:create_file|file_changes)>)/g;
      let incompleteMatches = [...text.matchAll(incompleteRegex)];

      const isGeneratingCode = fileArtifacts.length > 0 || incompleteMatches.length > 0;
      let newArtifactData = undefined;
      const artifactList: { path: string, type: 'create' | 'changes' }[] = [];

      if (isGeneratingCode) {
        fileArtifacts.forEach(a => artifactList.push({ path: a.filePath, type: a.type }));
        incompleteMatches.forEach(match => {
          const path = match[2];
          const type = match[1] === 'create_file' ? 'create' : 'changes';
          if (!artifactList.some(a => a.path === path)) artifactList.push({ path, type });
        });

        if (currentProject) {
          addFilesIfNew(artifactList, currentProject.files, activeFile, setActiveFile, setCurrentProject);
        }

        newArtifactData = { type: 'files', parsedList: artifactList, rawJson: text };
      }

      // Nettoyage texte pour affichage
      let textWithoutArtifacts = text
        .replace(inspirationUrlRegex, '')
        .replace(/<create_file[\s\S]*?<\/create_file>/gs, '')
        .replace(/<file_changes[\s\S]*?<\/file_changes>/gs, '')
        .replace(FETCH_FILE_REGEX, '') 
        .replace(/<file_content_snapshot[\s\S]*?<\/file_content_snapshot>/gs, ''); 

      setMessages((prev) => {
        const updatedMessages = [...prev];
        if (assistantMessageIndex >= 0 && assistantMessageIndex < updatedMessages.length) {
          const lastMsg = updatedMessages[assistantMessageIndex];
          if (lastMsg?.role === "assistant") {
            if (newArtifactData) lastMsg.artifactData = { ...lastMsg.artifactData, ...newArtifactData } as any;
            lastMsg.content = textWithoutArtifacts;
          }
        }
        return updatedMessages;
      });
    } // FIN STREAMING

    addLog("[STREAMING] Fin du streaming.");
    
    let finalCleanText = text
        .replace(inspirationUrlRegex, '')
        .replace(/<create_file[\s\S]*?<\/create_file>/gs, '')
        .replace(/<file_changes[\s\S]*?<\/file_changes>/gs, '')
        .replace(FETCH_FILE_REGEX, '') 
        .replace(/<file_content_snapshot[\s\S]*?<\/file_content_snapshot>/gs, ''); 

    const finalArtifacts = extractFileArtifacts(text);
    let artifactData: any;
    if (finalArtifacts.length > 0) {
        artifactData = { 
            type: 'files', 
            parsedList: finalArtifacts.map(a => ({ path: a.filePath, type: a.type })),
            rawJson: text 
        };
    } else if (urlArtifact) {
        artifactData = { type: 'inspirationUrl', rawJson: JSON.stringify(urlArtifact), parsedList: [] };
    } else {
        artifactData = { type: null, rawJson: "", parsedList: [] };
    }

    finalAssistantMessage = {
        role: "assistant",
        content: finalCleanText,
        artifactData: artifactData
    };

    if (urlArtifact) {
      addLog(`✅ Gemini suggests inspiration URL: ${urlArtifact.url}`);
      await runAutomatedAnalysis(urlArtifact.url, userPrompt, false);
      return; 
    }
          
    if (finalArtifacts.length > 0) {
      addLog(`Applying ${finalArtifacts.length} changes.`);
      applyArtifactsToProject(finalArtifacts);
      setTimeout(() => {
        finalArtifacts.forEach(async (artifact) => {
          const updatedFile = currentProject?.files.find(f => f.filePath === artifact.filePath);
          if (updatedFile) await reindexFile(updatedFile);
        });
      }, 100);
    } else {
      addLog("✅ Response received. No code artifacts.");
    }
  } catch (err: any) {
    addLog(`CLIENT-SIDE ERROR: ${err.message}`);
    setMessages((prev) => {
        const updated = [...prev];
        if (assistantMessageIndex >= 0 && assistantMessageIndex < updated.length) {
             return updated.filter((_, index) => index !== assistantMessageIndex);
        }
        return prev;
    }); 
    setMessages((prev) => [...prev, { role: "system", content: `Error: ${err.message}` }]);
  } finally {
    if (finalAssistantMessage) {
        setMessages((prev) => {
            const updated = [...prev];
            if (assistantMessageIndex >= 0 && assistantMessageIndex < updated.length && updated[assistantMessageIndex].role === "assistant") {
                 updated[assistantMessageIndex] = finalAssistantMessage as Message; 
            }
            return updated;
        });
    }
    setLoading(false);
  }
};
      
             

         
         
        
         const runAction = async (
  action: "create" | "install" | "build" | "start" | "addFiles"
) => {
  setLoading(true)

  // 🔧 Fonction utilitaire pour nettoyer le stderr (INCHANGÉE MAIS CRITIQUE)
  const cleanBuildOutput = (output: string) => {
    // Supprime les codes couleur ANSI (e.g. \x1B[0m)
    return output
      .replace(/\x1B\[[0-9;]*[A-Za-z]/g, "") 
      // Supprime les caractères non imprimables
      .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "") 
      .trim()
  }

  try {
    addLog(`Running action: ${action}...`)
    const body: any = { action, sandboxId: sandboxId || undefined }

    if (action === "addFiles") {
      const filesToSend = currentProject?.files || []

      if (!filesToSend.length || filesToSend.some((f) => !f.filePath)) {
        addLog("ERROR: Missing file path for one or more files.")
        setLoading(false)
        return
      }
      body.files = filesToSend
    }

    const res = await fetch("/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json()

    if (data.error) {
      addLog(`API ERROR: ${data.error}`)
      if (data.details) addLog(`Details: ${data.details}`)
      setLoading(false)
      return
    }

    if (data.logs) data.logs.split("\n").forEach((l: string) => addLog(l))
    if (data.sandboxId) setSandboxId(data.sandboxId)
    if (data.url) setPreviewUrl(data.url)

    // 🧠 Traitement des commandes build/install
    if (data.action === "install" || data.action === "build") {
      const result: CommandResult = data.result
      if (result) {
        addLog(`Commande '${data.action}' terminée (Code: ${result.exitCode})`)

        if (result.stdout) {
          addLog("--- STDOUT ---")
          result.stdout.split("\n").forEach((l) => addLog(l))
          addLog("--------------")
        }

        if (result.stderr) {
          addLog("--- STDERR ---")
          result.stderr.split("\n").forEach((l) => addLog(l))
          addLog("--------------")

          // 🧹 Nettoyage du stderr avant toute action (C'EST LA CLÉ)
          const cleanStderr = cleanBuildOutput(result.stderr)

          // ✅ Filtrage des erreurs non bloquantes
          const lowerErr = cleanStderr.toLowerCase()
          const isIgnorable =
            lowerErr.includes("npm warn") ||
            lowerErr.includes("npm notice") ||
            lowerErr.includes("deprecated") ||
            lowerErr.includes("audit") ||
            lowerErr.includes("funding")

          // 🚀 Envoi à l’IA uniquement si c’est une vraie erreur
          if (!isIgnorable && cleanStderr.length > 0) {
            // Utilisation du cleanStderr pour le prompt
            const prompt = `J’ai obtenu cette erreur pendant l’action '${data.action}'. Corrige-la :\n\n\`\`\`\n${cleanStderr}\n\`\`\``
            try {
              // L'appel sendChat utilise maintenant la version corrigée
              await sendChat(prompt) 
              addLog("🧠 Erreur critique transmise à l'IA pour correction.")
            } catch (chatErr: any) {
              addLog(`⚠️ Erreur lors de l’envoi à l’IA : ${chatErr.message}`)
            }
          } else {
            addLog("ℹ️ Avertissement ignoré (non bloquant).")
          }
        }

        if (result.error) addLog(`E2B Command Error: ${result.error}`)
        if (result.exitCode !== 0)
          addLog(`ERROR: Commande '${data.action}' échouée.`)
        else addLog(`SUCCESS: Commande '${data.action}' réussie.`)
      }
    } else if (data.success && action === "addFiles") {
      addLog(`${currentProject?.files.length || 0} files written successfully.`)
      if (currentProject) saveProject()
    } else if (data.success && action === "create") {
      addLog(`Sandbox créé avec l'ID: ${data.sandboxId}`)
      if (currentProject && currentProject.files.length > 0) {
        addLog("Writing current project files to the new sandbox...")
        await runAction("addFiles")
      }
    } else if (data.success && action === "start") {
      addLog(`Serveur démarré. Aperçu: ${data.url}`)
    } else if (!data.success) {
      addLog(`ERROR: Action '${action}' échouée.`)
    }
  } catch (err: any) {
    addLog(`CLIENT-SIDE ERROR: ${err.message}`)
  } finally {
    setLoading(false)
  }
      }   
 




        
  const copyLogs = () => navigator.clipboard.writeText(logs.join("\n"))


  // Fonction pour copier le contenu du fichier actif
const handleCopyFileContent = () => {
    if (!currentProject || activeFile === null) return;

    const fileContent = currentProject.files[activeFile]?.content || "";

    if (fileContent) {
        navigator.clipboard.writeText(fileContent)
            .then(() => {
                setCopiedFileIndex(activeFile); // Active l'icône Check
                setTimeout(() => setCopiedFileIndex(null), 2000); // Réinitialise après 2s
            })
            .catch(err => {
                console.error("Erreur de copie:", err);
            });
    }
};


  // Fonction pour télécharger le fichier actif
const handleDownloadFile = () => {
    if (!currentProject || activeFile === null) return;

    const file = currentProject.files[activeFile];
    if (!file || !file.filePath) return;

    const fileContent = file.content || "";
    const fileName = file.filePath.split('/').pop() || 'download.txt'; // Utilise le nom de fichier

    try {
        // 1. Crée un Blob à partir du contenu
        const blob = new Blob([fileContent], { type: 'text/plain' });
        
        // 2. Crée un lien de téléchargement temporaire
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName; // Nom du fichier lors du téléchargement

        // 3. Déclenche le téléchargement
        document.body.appendChild(link);
        link.click();
        
        // 4. Nettoyage
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        // Ajoutez un log ou une notification de succès ici si nécessaire
        // addLog(`File downloaded: ${fileName}`); 
        
    } catch (e) {
        console.error("Erreur lors du téléchargement du fichier:", e);
        // addLog("ERROR: Failed to download file.");
    }
};

  const handleNavigate = () => {
    if (iframeRef.current && previewUrl) {
      const targetUrl = new URL(previewUrl)
      const route = iframeRoute.startsWith("/") ? iframeRoute : `/${iframeRoute}`
      targetUrl.pathname = route
      iframeRef.current.src = targetUrl.toString()
      addLog(`Navigating iframe to: ${targetUrl.toString()}`)
    }
  }

  const handleReload = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src
      addLog("Reloading iframe...")
    }
  }


// --- NOUVELLE FONCTION D'ANALYSE DU CONTENU ---


// Constantes de couleur définies dans le composant ou en dehors
const ROUGE = 'FF0000'; 
const NOIR = '000000'; 
const VERT = '008000'; 
// Thème par défaut pour Monaco. Ici, nous partons du principe 'light' 
const MONACO_BASE_THEME = 'vs'; 
// NOTE : J'ai mis le thème en 'vs' (clair) car votre design a beaucoup de noir.

const handleEditorDidMount: OnMount = (editorInstance, monaco) => {
    
    // Désactivation de la vérification TypeScript/JSX (Lignes Rouges)
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      noSemanticValidation: true, 
      noSyntaxValidation: true,   
      jsx: monaco.languages.typescript.JsxEmit.React,
    });
    
    // Définition du Thème Ultra-Personnalisé
    monaco.editor.defineTheme('customTheme', {
        base: MONACO_BASE_THEME,
        inherit: true,
        rules: [
            // ROUGE: Mots-clés (import, const, interface, from, etc.)
            { token: 'keyword', foreground: ROUGE },
            { token: 'keyword.flow', foreground: ROUGE }, 

            // VERT: Chaînes de caractères (Chemin des imports ex: 'react', './utils')
            { token: 'string', foreground: VERT },
            
            // NOIR: Identifiants (React, useState, noms de classes, variables, etc.)
            { token: 'identifier', foreground: NOIR },
            { token: 'type', foreground: NOIR }, // Types (string, number, UserProps)
            
            // NOIR: JSX/HTML (Balises et Attributs)
            { token: 'tag', foreground: NOIR }, // Balises comme <div>
            { token: 'tag.html', foreground: NOIR }, 
            { token: 'attribute.name', foreground: NOIR }, // Attributs comme 'className'
        ],
        colors: {
            // Sidebar (Numéros de Ligne Noirs avec Opacité)
            'editorLineNumber.foreground': '#00000033', // Inactif
            'editorLineNumber.activeForeground': '#000000FF', // Actif
            'editorLineNumber.background': '#FFFAF0',
            // S'assurer que le texte par défaut est noir
            'editor.foreground': NOIR, 
            'editor.background': '#FFFCF6', // Fond blanc pour le thème 'vs'
        },
    });

    // Appliquer le thème
    monaco.editor.setTheme('customTheme');

};
    





         


            // --- INTERFACE ET COMPOSANT RÉCURSIF (À L'INTÉRIEUR DE SandboxPage) ---
interface FileTreeItemProps {
  node: FileTreeNode
  activeFile: number | null
  setActiveFile: (index: number) => void
}

/**
 * Composant pour afficher un seul fichier ou dossier dans l'arborescence.
 * Utilise la récursivité pour afficher les sous-dossiers.
 */
const FileTreeItem: React.FC<FileTreeItemProps> = ({ node, activeFile, setActiveFile }) => {
  // useState pour gérer l'ouverture/fermeture des dossiers
  const [isOpen, setIsOpen] = useState(true)
  
  // Icônes nécessaires (assurez-vous d'avoir Code et ChevronRight importés depuis 'lucide-react')
  // J'utilise Code pour tous les fichiers pour simplifier.
  const isDirectory = node.type === 'directory'
  const isCurrentlyActive = node.index !== undefined && activeFile === node.index

  return (
    <li>
      <button
        className={`w-full text-left text-sm py-1 px-2 rounded-[10px] flex items-center gap-2 transition-colors ${
          isCurrentlyActive
            ? "bg-[#FFFAF0] " 
            : "hover:bg-[#FFFAF0] text-[#37322F]/80"
        }`}
        onClick={() => {
          if (isDirectory) {
            setIsOpen(!isOpen) // Ouvre/Ferme le dossier
          } else if (node.index !== undefined) {
            setActiveFile(node.index) // Ouvre le fichier
          }
        }}
      >
        {/* Icône de flèche pour les dossiers */}
        {isDirectory && (
          <ChevronRight 
            className={`h-4 w-4 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} 
            style={{ minWidth: '1rem' }} // Force la taille pour l'alignement
          />
        )}
        {/* Icône de fichier pour les fichiers */}
      

        <span className="truncate">{node.name}</span>
      </button>

      {/* Rendu récursif des enfants */}
      {isDirectory && isOpen && node.children && (
        <ul className="pl-5 text-sm mt-1 space-y-1">
          {Array.from(node.children.entries())
            .sort(([nameA, nodeA], [nameB, nodeB]) => {
              // Trie les dossiers en premier, puis par ordre alphabétique
              if (nodeA.type === 'directory' && nodeB.type === 'file') return -1;
              if (nodeA.type === 'file' && nodeB.type === 'directory') return 1;
              return nameA.localeCompare(nameB);
            })
            .map(([key, childNode]) => (
              <FileTreeItem
                key={key}
                node={childNode}
                activeFile={activeFile}
                setActiveFile={setActiveFile}
              />
            ))}
        </ul>
      )}
    </li>
  )
}
  


  



// Assurez-vous que useMemo est importé depuis 'react'
// REMPLACEZ VOTRE DÉFINITION STATIQUE PAR CE BLOC RÉACTIF

const fileTree = useMemo(() => {
    // Utilise currentProject.files comme source de données (votre 'files' doit pointer vers ceci)
    const files = currentProject?.files || [];

    if (files.length === 0) {
        return new Map();
    }
    
    // Appel à votre fonction buildFileTree
    return buildFileTree(files); 
    
// 🛑 Dépendance essentielle : assure que le calcul se fait après la mise à jour de l'état.
}, [currentProject?.files]); 
  



  // Assurez-vous d'importer useEffect : import { useState, useRef, useEffect, useMemo } from "react" 

// ... (déclarations de useState, useMemo, etc.)
useEffect(() => {
    if (currentProject) {
        if (currentProject.files !== files) {
             setFiles(currentProject.files);
        }
    } else if (files.length > 0) {
        setFiles([]);
    }
}, [currentProject, files, setFiles]);



useEffect(() => {
  if (!currentProject || !currentProject.id) return;

  const timeoutId = setTimeout(() => {
    handleUpdateEmbeddings();
  }, 2000);

  return () => clearTimeout(timeoutId);

  // ⚠️ Ne mets pas currentProject.files dans les deps sinon relance infinie
}, [currentProject?.id, handleUpdateEmbeddings]);




  
 
const handleVercelDeploy = async () => {
  if (!currentProject || !currentProject.files.length) {
    setDeployLogs(prev => [...prev, "❌ Aucun projet chargé ou vide."]);
    return;
  }

  if (!vercelToken) {
    const token = prompt("Entrez votre Vercel Access Token (https://vercel.com/account/tokens)");
    if (!token) return;
    localStorage.setItem("vercel_access_token", token);
    setVercelToken(token);
  }

  const token = vercelToken || localStorage.getItem("vercel_access_token");
  if (!token) return;

  setDeploying(true);
  setDeployLogs(["🚀 Lancement du déploiement sur Vercel..."]);

  try {
    // Prépare les fichiers à envoyer
    const projectFiles = currentProject.files.reduce((acc, f) => {
      acc[f.filePath] = f.content;
      return acc;
    }, {} as Record<string, string>);

    const res = await fetch("/api/deploy/vercel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        projectName: currentProject.name,
        files: projectFiles,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Erreur lors du déploiement");
    }

    setDeployLogs(prev => [...prev, `✅ Déploiement lancé : ${data.url}`]);
    setDeployUrl(data.url);

    pollVercelLogs(data.deploymentId, token, data.url);

                  

    // Suivi automatique des logs
    
  } catch (err: any) {
    setDeployLogs(prev => [...prev, `❌ ${err.message}`]);
  } finally {
    setDeploying(false);
  }
};



const pollVercelLogs = async (deploymentId: string, token: string, url: string) => {
  setDeployLogs(prev => [...prev, "⏳ Suivi du déploiement et lecture des logs..."]);

  try {
    const response = await fetch(
      `https://api.vercel.com/v3/deployments/${deploymentId}/events?follow=1`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!response.body) {
      setDeployLogs(prev => [...prev, "❌ Pas de flux disponible depuis l'API Vercel"]);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let partial = "";

    // Buffers pour stdout et stderr
    let stdoutBuffer = "";
    let stderrBuffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      partial += decoder.decode(value, { stream: true });

      const lines = partial.split("\n");
      partial = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line);

          let text = "";

          // ✅ Gestion stdout/stderr avec buffering
          if (event.type === "stdout") {
            text = event.payload?.text || event.payload?.message || "";
            stdoutBuffer += text;
            if (text.includes("\n")) {
              setDeployLogs(prev => [...prev, stdoutBuffer.trim()]);
              stdoutBuffer = "";
            }
            continue; // passe au prochain événement
          }

          if (event.type === "stderr") {
            text = event.payload?.text || event.payload?.message || "";
            stderrBuffer += text;
            if (text.includes("\n")) {
              setDeployLogs(prev => [...prev, `[stderr] ${stderrBuffer.trim()}`]);
              stderrBuffer = "";
            }
            continue;
          }

          // 🔹 Reste de ta logique inchangée
          text =
            event?.payload?.text ||
            event?.payload?.message ||
            event?.payload?.output ||
            event?.payload?.command ||
            event?.type ||
            "";

          if (text) {
            setDeployLogs(prev => [...prev, text]);
          }

          if (event.type === "state") {
            if (event.payload?.state === "READY") {
              setDeployLogs(prev => [...prev, `✅ Déploiement terminé : ${url}`]);
              return;
            }
            if (event.payload?.state === "ERROR") {
              setDeployLogs(prev => [...prev, `❌ Déploiement échoué (ERROR)`]);
              return;
            }
          }
        } catch {
          // ligne incomplète, on continue
        }
      }
    }

    // flush buffers restant à la fin du flux
    if (stdoutBuffer) setDeployLogs(prev => [...prev, stdoutBuffer.trim()]);
    if (stderrBuffer) setDeployLogs(prev => [...prev, `[stderr] ${stderrBuffer.trim()}`]);

  } catch (e: any) {
    setDeployLogs(prev => [...prev, `⚠️ Erreur lecture flux: ${e.message}`]);
  }
};
            
                               
  
  
        
  // -------------------
  // LE RETURN DU JSX (ne pas mettre d'accolade fermante avant !)
  // -------------------
  return (
    <div className="flex h-screen bg-[#fffcf6] font-sans text-[#37322F]">
      
        <div 
  className={`
    h-full flex flex-col bg-[#fffcf6] border-[rgba(55,50,47,0.12)] 
    
    
    md:w-[40%] md:flex
    
    
    ${viewMode === "chat" ? "w-full flex" : "hidden"} 
  `}
>
        <div className="flex items-center justify-between px-6 h-12 flex-shrink-0  border-[rgba(55,50,47,0.12)]">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3">
{/* Import nécessaire en haut : import { Trash2, ChevronsUpDown } from 'lucide-react' */}

<div className="relative">
  {/* Bouton AFFICHEUR */}
  <button
    onClick={() => setShowProjectSelect(!showProjectSelect)}
    className="flex items-center w-[80%] gap-1 text-sm bg-transparent border-none focus:ring-0 font-medium max-w-[150px] text-[#37322F] hover:bg-[#F7F5F3] p-1 rounded-md transition-colors"
  >
    <div className="w-4 h-4 xs:w-5 xs:h-5 sm:w-6 sm:h-7 md:w-7 md:h-7 lg:w-8 lg:h-8 relative shadow-[0px_-4px_8px_rgba(255,255,255,0.64)_inset] overflow-hidden rounded-[12px] shrink-0">
        <img src="/horizon-icon.svg" alt="Horizon" className="w-full h-full object-contain" />
    </div>
    <span className="truncate flex-1 x-fukl text-left">
      {currentProject?.name || "Select a Project"}
    </span>
    <ChevronsUpDown className="h-4 w-4 text-[rgba(55,50,47,0.6)] shrink-0" />
  </button>

  {/* Conteneur du Menu Déroulant */}
  {showProjectSelect && (
    <div className="absolute z-50 top-full mt-1 left-0 bg-[#E3DFDB] border border-[rgba(55,50,47,0.08)] shadow-lg rounded-[12px] min-w-[300px] max-h-70 overflow-y-auto flex flex-col p-1">
      {projects.map((p) => (
        <div
          key={p.id}
          className={`group w-full p-2 text-sm hover:bg-[#F7F5F3] rounded-lg flex items-center justify-between cursor-pointer transition-colors ${
            currentProject?.id === p.id ? "bg-[#F7F5F3] font-semibold" : ""
          }`}
          // LOGIQUE CLÉ : Click sur le conteneur pour charger
          onClick={async () => {
            if (currentProject) {
              await saveProject() // On attend la sauvegarde IDB
            }
            loadProject(p.id)
            setShowProjectSelect(false)
          }}
        >
          {/* Partie Gauche : Icone + Nom */}
          <div className="flex items-center gap-2 flex-1 overflow-hidden">
              <div className="w-5 h-5 relative shadow-[0px_-4px_8px_rgba(255,255,255,0.64)_inset] overflow-hidden rounded-[8px] shrink-0">
                <img src="/horizon-icon.svg" alt="Horizon" className="w-full h-full object-contain" />
              </div>
              <span className="truncate">{p.name}</span>
          </div>

          {/* Partie Droite : Bouton Supprimer (Visible au survol uniquement) */}
          <button
            onClick={(e) => handleDeleteProject(e, p.id)}
            className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-100 text-gray-400 hover:text-red-600 rounded-md transition-all"
            title="Delete project"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      
      {projects.length === 0 && (
        <div className="p-3 text-sm text-[rgba(55,50,47,0.6)] text-center">
          No projects yet. Create one!
        </div>
      )}
    </div>
  )}
</div>
     </div>   

            
            
          </div>
          <div className="flex items-center">
            
            <Button
              variant="ghost"
              size="icon"
              onClick={createNewProject}
              className="bg-[#37322F] hover:bg-[rgba(55,50,47,0.90)] text-white h-[24px] w-[24px] rounded-[12px] flex items-center justify-center p-1"
              
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            
          </div>
        </div>

        <div className="flex-grow overflow-y-auto relative">
          <ScrollArea className="absolute overflow-y-auto inset-0 p-6" viewportRef={chatScrollAreaRef}>
            <div className="space-y-6 pb-4">
              
                  {/* --- DEBUT DU BLOC messages.map (Ligne ~580) --- */}




                {messages.map((msg, index) => {
  const artifact = msg.artifactData;
  const isExpanded = expandedMessageIndex === index;
  const isCopied = copiedMessageIndex === index;
  
  return (
    <div
      key={index}
      className={`flex flex-col items-start gap-3 ${msg.role === "user" ? "items-end" : "items-start"}`}
    >
      {/* Affichage de l'icône de l'assistant */}
      {msg.role === "assistant" && (
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 bg-[#37322F] rounded-full flex items-center justify-center">
            <svg className="h-[18px] w-[18px]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="10" />
            </svg>
          </div>

          {/* Indicateur "Thinking..." */}
          {loading && index === messages.length - 1 && (
          <div className="flex items-center gap-[3px]">
            <p className="text-sm font-medium text-[#37322F]/80 animate-pulse">Thinking...</p>
            <svg className="h-[17px] w-[17px]" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#37322F"><path d="M480-80q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80ZM320-200v-80h320v80H320Zm10-120q-69-41-109.5-110T180-580q0-125 87.5-212.5T480-880q125 0 212.5 87.5T780-580q0 81-40.5 150T630-320H330Zm24-80h252q45-32 69.5-79T700-580q0-92-64-156t-156-64q-92 0-156 64t-64 156q0 54 24.5 101t69.5 79Zm126 0Z"/></svg>
          </div>
          )}
        </div>
      )}
      
      {/* Conteneur du message */}
      <div
        className={`p-2 rounded-xl max-w-xl group relative ${
          msg.role === "user"
            ? "bg-[#37322F] text-white self-end border-[#37322F]"
            : "bg-none text-[#37322F] self-start"
        }`}
      >
        {(() => {
          const rawTextContent = msg.content; 
          const isFileArtifact = artifact && (artifact.type === 'files');
          const isUrlArtifact = artifact && (artifact.type === 'url');
          const displayElements = [];
          
          // 🔥 LOGIQUE DE MASQUAGE (Split sur |||)
          const contentForTextDisplay = rawTextContent.split('|||')[0];

          let finalContentToDisplay = contentForTextDisplay
              .replace(/<create_file[\s\S]*?<\/create_file>/gs, '')
              .replace(/<file_changes[\s\S]*?<\/file_changes>/gs, '')
              .replace(/```json[\s\S]*?"type"\s*:\s*"inspirationUrl"[\s\S]*?```/g, '')
              .replace(/---[\s\S]*?---/g, '')
              .trim();
          
          const hasTextContent = finalContentToDisplay.length > 0;
          
          // --- RENDU MESSAGE UTILISATEUR ---
          if (msg.role === "user") {
              const MAX_HEIGHT = 150; 
              const isLongMessage = msg.content.length > 10000 || rawTextContent.split('\n').length > 20; 
              
              const userContent = (
                  <pre 
                      className="whitespace-pre-wrap font-sans text-sm leading-relaxed"
                      style={{ maxHeight: isExpanded ? 'none' : `${MAX_HEIGHT}px`, overflow: 'hidden' }}
                  >
                      {msg.content}
                  </pre>
              );

              displayElements.push(
                  <div key="user-content-wrapper" className="relative">
                      {userContent}
                      {!isExpanded && isLongMessage && (
                          <div 
                              className="absolute inset-x-0 bottom-0 h-[60px] flex flex-col justify-end items-center p-2 rounded-b-xl cursor-pointer z-10"
                              style={{ background: 'linear-gradient(to top, rgba(55,50,47,1) 50%, rgba(55,50,47,0))' }}
                              onClick={() => setExpandedMessageIndex(index)} 
                          >
                              <button className="text-white text-xs font-semibold px-2 py-1 rounded-full border border-white/50 bg-[#37322F]/80">
                                  <ArrowUp className="h-3 w-3 inline-block mr-1 rotate-180" /> Expand
                              </button>
                          </div>
                      )}
                      {isExpanded && isLongMessage && (
                          <div className="flex justify-center mt-2">
                              <button onClick={() => setExpandedMessageIndex(null)} className="text-white text-xs font-semibold px-2 py-1 rounded-full border border-white/50 bg-[#37322F]/80">
                                  <ArrowUp className="h-3 w-3 inline-block mr-1" /> Collapse
                              </button>
                          </div>
                      )}
                  </div>
              );
              return displayElements; 
          }
          
          // --- RENDU MESSAGE ASSISTANT (TEXTE) ---
          if (hasTextContent) {
              displayElements.push(
                  <pre key="text" className="whitespace-pre-wrap font-sans text-sm leading-relaxed mb-1">
                      {finalContentToDisplay} 
                  </pre>
              );
          }

          // --- LOGIQUE ARTEFACT ---
          const isCreating = rawTextContent.includes('<create_file') && !rawTextContent.includes('</create_file>');
          const isEditing = rawTextContent.includes('<file_changes') && !rawTextContent.includes('</file_changes>');
          const isBuilding = isCreating || isEditing;
          const totalItems = artifact?.parsedList?.length || 0;
          const svgPath = "M560-80v-123l221-220q9-9 20-13t22-4q12 0 23 4.5t20 13.5l37 37q8 9 12.5 20t4.5 22q0 11-4 22.5T903-300L683-80H560Zm300-263-37-37 37 37ZM620-140h38l121-122-18-19-19-18-122 121v38ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v120h-80v-80H520v-200H240v640h240v80H240Zm280-400Zm241 199-19-18 37 37-18-19Z";
          const currentStatusText = isCreating ? 'Creating' : (isEditing ? 'Editing' : 'Building');

          if (isFileArtifact && artifact.parsedList && artifact.parsedList.length > 0) {
              const artifactClasses = hasTextContent ? "mt-1 pt-1 border-[rgba(55,50,47,0.1)]" : "pt-0";
              displayElements.push(
                  <div key="code-artifact" className={`border-[rgba(55,50,47,0.1)] rounded-lg w-full ${artifactClasses}`}>
                      <ul className="list-disc pl-5 w-[100%] space-y-1">
                          {artifact.parsedList.map((item: {path: string, type: 'create' | 'changes'}, i) => {
                              const isCurrentlyStreaming = isBuilding && i === totalItems - 1;
                              const statusText = item.type === 'create' 
                                  ? (isCurrentlyStreaming ? 'Creating' : 'created')
                                  : (isCurrentlyStreaming ? 'Editing' : 'edited');
                              
                              return (
                                  <li key={i} className={`text-xs w-full list-style-none flex items-center gap-1 text-[#37322F]/80 ${isCurrentlyStreaming ? 'animate-pulse' : ''}`}>
                                      <span><svg xmlns="http://www.w3.org/2000/svg" className="h-[18px] w-[18px]" viewBox="0 -960 960 960" fill="#37322F"><path d={svgPath}/></svg></span>
                                      <p className="font-semibold">{statusText}</p>
                                      <span className="bg-[#FFFAF0] py-[3px] rounded-[8px] font-semibold px-[12px]">{item.path}</span>
                                  </li>
                              );
                          })}
                          {isBuilding ? (
                              <li className="text-xs text-[#37322F]/60 italic flex items-center gap-1">
                                <span className="animate-spin">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="#37322F"><path d="M12 2a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8.009 8.009 0 0 1-8 8zm0-15V7h2V4zM8.47 4.93l1.41 1.41-1.41 1.41-1.41-1.41zM19.07 15.53l-1.41-1.41 1.41-1.41 1.41 1.41zM20 12h-3v2h3zM15.53 19.07l-1.41-1.41 1.41-1.41 1.41 1.41zM12 20v-3h2v3zM4.93 15.53l1.41-1.41-1.41-1.41-1.41 1.41zM4 12h3v2H4zM8.47 19.07l1.41 1.41-1.41-1.41-1.41 1.41z"/></svg>
                                </span>
                                <span className="font-semibold">{currentStatusText}...</span>
                              </li>
                          ) : null}
                      </ul>
                  </div>
              );
          }

          // --- RENDU URL ARTIFACT ---
          if (isUrlArtifact) {
              const artifactClasses = hasTextContent ? "mt-3 pt-3 border-t border-[rgba(55,50,47,0.1)]" : "pt-0";
              displayElements.push(
                  <div key="url-artifact" className={`p-3 bg-[#F7F5F3] border border-[rgba(55,50,47,0.1)] rounded-lg w-full ${artifactClasses}`}>
                      <p className="text-sm font-semibold mb-1 flex items-center gap-1 text-[#37322F]">Designing process</p>
                      <div className="h-[8px] w-full rounded-[8px] bg-[#E3DFDB]"></div>
                  </div>
              );
          }
          
          return displayElements.length > 0 
                 ? displayElements 
                 : <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{finalContentToDisplay}</pre>;
        })()}
      </div>
      
      {/* Fichiers uploadés & Mentions */}
      {msg.role === "user" && msg.images && msg.images.length > 0 && (
          <div className="flex gap-1 mt-1">
              {msg.images.map((base64Src, imgIndex) => (
                  <div key={imgIndex} className="w-[25px] h-[25px] rounded-[8px] overflow-hidden" title="Image utilisateur">
                      <img src={base64Src} alt="User input" className="w-full h-full object-cover" />
                  </div>
              ))}
          </div>
      )}
      {msg.role === "user" && msg.externalFiles && msg.externalFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
              {msg.externalFiles.map((file, fileIndex) => (
                   <div key={fileIndex} className="flex items-center h-[24px] border border-black rounded-[8px] bg-[#F7F5F3] px-2 text-sm max-w-xs truncate">
                      {file.fileName}
                  </div>
              ))}
          </div>
      )}
      {msg.role === "user" && msg.mentionedFiles && msg.mentionedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
              {msg.mentionedFiles.map((filePath, mentionIndex) => (
                  <div key={mentionIndex} className="flex items-center h-[24px] border border-black rounded-[8px] bg-[#E3F5E3] px-2 text-sm max-w-xs truncate">
                      @{filePath}
                  </div>
              ))}
          </div>
     )}
    </div>
  );
})}

              

              

                

          
          

          
                
                  {/* --- DEBUT DU BLOC messages.map (Ligne ~580) --- */}                
                            
            </div>
          </ScrollArea>
        </div>







<div className="p-1 h-[200px] md:h-[250px] border-[rgba(55,50,47,0.12)] flex-shrink-0">
  {analysisStatus && <p className="text-sm text-[rgba(55,50,47,0.60)] mb-3 animate-pulse">{analysisStatus}</p>}
  <div className="relative p-2 flex flex-col h-[170px] md:h-[190px]">
    
    {/* ZONE DES BOUTONS DE COMMANDE / INPUT DE CLONAGE */}
    <div className="flex flex-col h-[20%] rounded-t-[25px] bg-[#FFFAF0] w-full">
     <div className="w-full h-full flex items-center justify-center">
        <div className="w-full p-2 pl-1 rounded-t-[25px]  h-full p-[2px] flex items-center border-t border-l border-r border-[rgba(55,50,47,0.12)] gap-1">
        
        {/* BOUTON/INPUT CLONE WEBSITE */}
        {!isCloning ? (
            
            <button 
                onClick={() => setIsCloning(true)}
                className="w-auto p-1 h-[25px] border border-black rounded-[10px] flex items-center gap-1 justify-center hover:bg-white transition-colors duration-150"
                disabled={loading}
            >
              <svg className="h-[16px] w-[16px]" xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#1f1f1f"><path d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q83 0 155.5 31.5t127 86q54.5 54.5 86 127T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Zm0-82q26-36 45-75t31-83H404q12 44 31 83t45 75Zm-104-16q-18-33-31.5-68.5T322-320H204q29 50 72.5 87t99.5 55Zm208 0q56-18 99.5-55t72.5-87H638q-9 38-22.5 73.5T584-178ZM170-400h136q-3-20-4.5-39.5T300-480q0-21 1.5-40.5T306-560H170q-5 20-7.5 39.5T160-480q0 21 2.5 40.5T170-400Zm216 0h188q3-20 4.5-39.5T580-480q0-21-1.5-40.5T574-560H386q-3 20-4.5 39.5T380-480q0 21 1.5 40.5T386-400Zm268 0h136q5-20 7.5-39.5T800-480q0-21-2.5-40.5T790-560H654q3 20 4.5 39.5T660-480q0 21-1.5 40.5T654-400Zm-16-240h118q-29-50-72.5-87T584-782q18 33 31.5 68.5T638-640Zm-234 0h152q-12-44-31-83t-45-75q-26 36-45 75t-31 83Zm-200 0h118q9-38 22.5-73.5T376-782q-56 18-99.5 55T204-640Z"/></svg>
              <p className="text-sm">Clone website</p>
            </button>
        ) : (
            // 2. Affichage de l'input full-width pour l'URL (état de clonage actif)
            <div className="flex items-center h-full w-full">
                {/* Icône SVG (conservée) */}
                <svg className="h-[16px] w-[16px] flex-shrink-0 mx-1" xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#1f1f1f"><path d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q83 0 155.5 31.5t127 86q54.5 54.5 86 127T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Zm0-82q26-36 45-75t31-83H404q12 44 31 83t45 75Zm-104-16q-18-33-31.5-68.5T322-320H204q29 50 72.5 87t99.5 55Zm208 0q56-18 99.5-55t72.5-87H638q-9 38-22.5 73.5T584-178ZM170-400h136q-3-20-4.5-39.5T300-480q0-21 1.5-40.5T306-560H170q-5 20-7.5 39.5T160-480q0 21 2.5 40.5T170-400Zm216 0h188q3-20 4.5-39.5T580-480q0-21-1.5-40.5T574-560H386q-3 20-4.5 39.5T380-480q0 21 1.5 40.5T386-400Zm268 0h136q5-20 7.5-39.5T800-480q0-21-2.5-40.5T790-560H654q3 20 4.5 39.5T660-480q0 21-1.5 40.5T654-400Zm-16-240h118q-29-50-72.5-87T584-782q18 33 31.5 68.5T638-640Zm-234 0h152q-12-44-31-83t-45-75q-26 36-45 75t-31 83Zm-200 0h118q9-38 22.5-73.5T376-782q-56 18-99.5 55T204-640Z"/></svg>
                

                

<input
    type="url"
    placeholder="Enter website URL to clone (e.g., example.com) and press Enter"
    
    className="h-full w-full border-none outline-none bg-transparent text-sm"
    
    
    value={cloneUrl}
    onChange={(e) => setCloneUrl(e.target.value)}
    
    
    onKeyDown={(e) => {
        
        if (e.key === "Enter" && cloneUrl) {
            e.preventDefault() 
            
            
            runAutomatedAnalysis(
                cloneUrl, 
                `User wants to clone website: ${cloneUrl}`, 
                true 
            ) 
        } else if (e.key === "Escape") {
            
            setIsCloning(false) 
            setCloneUrl("")
        }
    }}
    
    
    disabled={loading} 
    autoFocus
/>
                  


              

  
            </div>
        )}
        
        {/* BOUTON CONNECT DATABASE (Masqué si isCloning est vrai) */}
        

        
{/* BOUTON CONNECT DATABASE (Masqué si isCloning est vrai) */}
{!isCloning && (
    <DatabaseConnector
        dbConfig={dbConfig}
        setDbConfig={setDbConfig}
        sendChat={sendChat}
    />
)}
          
        
      </div>
     </div>
    </div>
    
    {/* ZONE DE SAISIE DE CHAT */}
    <div className="w-full bg-[#FFFAF0] h-[60%] border-b-none  border-l border-r border-[rgba(55,50,47,0.12)] p-2 ">
      <textarea
  placeholder={currentProject ? "Describe what to build..." : "Please create or select a project first."}
  className="h-full w-full rounded-[8px] border-none outline-none resize-none bg-none"
  value={chatInput}
  onChange={(e) => setChatInput(e.target.value)}
  onKeyDown={(e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendChat()
    }
  }}
  
  disabled={!currentProject || loading || isCloning}
/>
  

    </div>
    
    {/* PIED DE PAGE DE CHAT */}
    <div className="w-full p-4 bg-[#FFFAF0] rounded-b-[25px] h-[20%] border-b border-l border-r border-t-none border-[rgba(55,50,47,0.12)] p-[2px] flex items-center justify-between gap-1">
        

{/* 1. BOUTON PLUS (UPLOAD FICHIERS ET SCREENSHOT) */}
<div className="mb-1 pl-1 p-2 flex items-center gap-2">
    <div 
        className="w-[22px] relative -bottom-[3px] p-1 h-[22px] border border-black rounded-[8px] hidden items-center justify-center cursor-pointer hover:bg-gray-100"
        onClick={() => setIsPlusDropdownOpen(!isPlusDropdownOpen)}
    >
        <Plus size={16} />
    </div>


  
  <label className="w-[22px] relative p-1 h-[22px] border border-black rounded-full flex items-center justify-center cursor-pointer hover:bg-gray-100">
                <Plus size={16} />
                <input 
                    type="file" 
                    accept="*/*" // Tout type sauf ceux filtrés dans handleFileUpload
                    multiple 
                    onChange={handleFileUpload} 
                    className="hidden" 
                />
            </label>
  <label className="flex pr-1 items-center gap-1  cursor-pointer">
    <div className="h-[22px] w-auto  flex text-[17px] items-center gap-[3px]">
        {/* L'icône du bouton d'upload (utiliser un simple SVG ou une icône) */}
        <Image size={18} />
      <p>attach</p>
    </div>
    <input 
        type="file" 
        accept="image/*" 
        multiple 
        onChange={handleImageUpload} 
        className="hidden" // Cache l'input par défaut
    />
</label>

    {isPlusDropdownOpen && (
        <div className="absolute bottom-full mb-2 left-0 z-50 p-2 border rounded shadow-lg bg-white w-48">
            {/* Bouton Upload File */}
            <label className="w-full text-left py-1.5 px-2 hover:bg-gray-100 flex items-center gap-2 rounded cursor-pointer text-sm">
                Upload File
                <input 
                    type="file" 
                    accept="*/*" // Tout type sauf ceux filtrés dans handleFileUpload
                    multiple 
                    onChange={handleFileUpload} 
                    className="hidden" 
                />
            </label>
            {/* Bouton Screenshot */}
            <button 
                className="w-full text-left py-1.5 px-2 hover:bg-gray-100 flex items-center gap-2 rounded text-sm mt-1"
                onClick={handleScreenshot}
            >
                Screenshot Tab
            </button>
        </div>
    )}
</div>

{/* 2. BOUTON MENTION */}
<div className="relative p-2">

    {isMentionDropdownOpen && (
        <div className="absolute bottom-full mb-2 left-0 z-50 p-2 border rounded shadow-lg bg-white w-60 max-h-60 overflow-y-auto">
            <p className="text-xs font-semibold mb-1 border-b pb-1">Fichiers du Projet ({currentProject?.files.length || 0})</p>
            {(currentProject?.files || []).map((file) => (
                <button
                    key={file.filePath}
                    className={`w-full text-left py-1 px-2 flex items-center gap-2 rounded text-xs transition-all ${
                        mentionedFiles.includes(file.filePath) ? 'bg-blue-100 text-blue-700 font-medium' : 'hover:bg-gray-100'
                    }`}
                    onClick={() => handleMentionFile(file.filePath)}
                >
                    {mentionedFiles.includes(file.filePath) ? '✅' : '☐'} {file.filePath}
                </button>
            ))}
            {(currentProject?.files.length === 0 || !currentProject) && (
                <p className="text-xs text-gray-500 italic">Aucun fichier dans le projet.</p>
            )}
        </div>
    )}
</div>


{/* 🛑 NOUVEAU BLOC : Affichage des Fichiers Uploadés et Mentionnés */}
{(uploadedImages.length > 0 || uploadedFiles.length > 0 || mentionedFiles.length > 0) && (
    <div className="flex flex-wrap gap-1.5 p-1 border-t border-gray-200 mt-1">
        {/* Images (existant) */}
        {uploadedImages.map((src, index) => (
            <div key={`img-${index}`} className="relative w-[40px] h-[40px] rounded-[10px] overflow-hidden group">
                <img 
                    src={src} 
                    alt="Image uploadée" 
                    className="w-full h-full object-cover"
                />
                <button
                    onClick={() => setUploadedImages(prev => prev.filter((_, i) => i !== index))}
                    className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition text-white text-xs font-bold"
                    title="Retirer l'image"
                >
                    X
                </button>
            </div>
        ))}
        {/* Fichiers Externes (Nouveau) */}
        {uploadedFiles.map((file, index) => (
            <div key={`file-${index}`} className="flex items-center gap-1.5 h-[24px] border border-black rounded-[8px] bg-[#F7F5FF] px-2 text-sm max-w-xs truncate">
                {file.fileName}
                <button 
                    onClick={() => setUploadedFiles(prev => prev.filter((_, i) => i !== index))}
                    className="text-xs text-red-600 font-bold"
                >
                    ×
                </button>
            </div>
        ))}
        {/* Fichiers Mentionnés (Nouveau) */}
        {mentionedFiles.map((filePath, index) => (
            <div key={`mention-${index}`} className="flex items-center gap-1.5 h-[24px] border border-black rounded-[8px] bg-[#E3F5E3] px-2 text-sm max-w-xs truncate">
                @{filePath}
                <button 
                    onClick={() => handleRemoveMention(filePath)}
                    className="text-xs text-red-600 font-bold"
                >
                    ×
                </button>
            </div>
        ))}
    </div>
)}


      
      
    
      <div className="flex pr-1 p-2 items-center gap-1 mb-1">
              


{/* ZONE D'AFFICHAGE DES IMAGES UPLOADEES */}
{uploadedImages.length > 0 && (
    <div className="flex flex-wrap gap-2 p-1 border-t border-gray-200 mt-1">
        {uploadedImages.map((src, index) => (
            <div key={index} className="relative w-[40px] h-[40px] rounded-[10px] overflow-hidden group">
                <img 
                    src={src} 
                    alt={`Uploaded image ${index + 1}`} 
                    className="w-full h-full object-cover"
                />
                <button
                    onClick={() => setUploadedImages(prev => prev.filter((_, i) => i !== index))}
                    className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition text-white text-xs font-bold"
                    title="Remove"
                >
                    X
                </button>
            </div>
        ))}
    </div>
)}

<button className="h-[24px] w-auto bg-transparent px-3 flex items-center gap-[2px] text-[17px] text-black">
         <svg className="h-[20px] w-[20px]" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#37322F"><path d="M480-80q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80ZM320-200v-80h320v80H320Zm10-120q-69-41-109.5-110T180-580q0-125 87.5-212.5T480-880q125 0 212.5 87.5T780-580q0 81-40.5 150T630-320H330Zm24-80h252q45-32 69.5-79T700-580q0-92-64-156t-156-64q-92 0-156 64t-64 156q0 54 24.5 101t69.5 79Zm126 0Z"/></svg>
         <p>Plan</p>
</button>
        <Button
      className=" bg-[#37322F] -ml-[2px] hover:bg-[rgba(55,50,47,0.90)] text-white h-[24px] w-[24px] rounded-full flex items-center justify-center p-1"
      onClick={() => sendChat()}
      disabled={loading || !chatInput || !currentProject}
    >
      <ArrowUp size={16} /> 
    </Button>
      </div>
    </div>
  </div>

  <div className="flex md:hidden justify-center items-center border border-[rgba(55,50,47,0.12)]  w-full rounded-[12px] mb-3 bg-[#fffcf6] ">
    <button
        onClick={() => toggleViewMode("chat")}
        className={`px-1 w-1/2 py-1  rounded-l-[12px] transition-colors duration-200 ${
            viewMode === "chat" 
                ? "bg-[#37322F] text-white font-semibold" 
                : "bg-transparent text-gray-700"
        }`}
    >
        Chat
    </button>
    <button
        onClick={() => toggleViewMode("preview")}
        className={`px-1 w-1/2 py-1 rounded-r-lg transition-colors duration-200 ${
            viewMode === "preview" 
                ? "bg-[#37322F] text-white font-semibold" 
                : " text-gray-700"
        }`}
    >
        Preview
    </button>
</div>
  
</div>













        
       </div> 
      
    {/* ZONE DES BOUTONS DE COMMANDE / INPUT DE CLONAGE */}

  


      
      
    
      

    {/* ZONE DES BOUTONS DE COMMANDE / INPUT DE CLONAGE */}
        
          <div 
  className={`
    h-full flex flex-col bg-[#fffcf6] 
    
    
    md:w-[60%] md:flex
    
    
    ${viewMode === "preview" ? "w-full flex" : "hidden"}
  `}
>
        <div className="flex items-center gap-1 justify-between p-4 flex-shrink-0 h-12  border-[rgba(55,50,47,0.12)]">
          <div className="bg-[#fffcf6] rounded-xl h-10 flex items-center p-1 border border-[rgba(55,50,47,0.12)]">
            <Button
              variant={activeTab === "preview" ? "secondary" : "ghost"}
              size="icon"
              className={`h-7 w-7 rounded-lg ${activeTab === "preview" ? "bg-white shadow-sm" : "text-[rgba(55,50,47,0.60)] hover:text-[#37322F]"}`}
              onClick={() => setActiveTab("preview")}
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant={activeTab === "code" ? "secondary" : "ghost"}
              size="icon"
              className={`h-7 w-7 rounded-lg ${activeTab === "code" ? "bg-white shadow-sm" : "text-[rgba(55,50,47,0.60)] hover:text-[#37322F]"}`}
              onClick={() => setActiveTab("code")}
            >
              <Code className="h-4 w-4" />
            </Button>
          </div>

<div 
  // La div est masquée si activeTab n'est PAS "preview"
  className={`
    items-center rounded-[15px] justify-center bg-transparent gap-2 border border-[rgba(55,50,47,0.12)] p-1 
    w-[60%] bg-[#F7F5F3]
    ${activeTab === "preview" ? "flex" : "hidden"}
  `}
>
    <input
      type="text"
      value={iframeRoute}
      onChange={(e) => setIframeRoute(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") handleNavigate()
      }}
      className="flex-grow bg-transparent w-[60%] outline-none px-3 text-sm text-[#37322F] placeholder:text-[rgba(55,50,47,0.60)]"
      placeholder="/route"
    />
    <div className="w-auto flex items-center gap-[2px]">
      <Button
      variant="ghost"
      size="icon"
      className="h-7 w-auto flex-shrink-0 text-[rgba(55,50,47,0.60)] hover:text-[#37322F]"
      onClick={handleNavigate}
    >
      <ArrowRight size={17} className="h-4 w-4" />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-auto flex-shrink-0 text-[rgba(55,50,47,0.60)] hover:text-[#37322F]"
      onClick={handleReload}
    >
      <RefreshCw size={17} className="h-4 w-4" />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-auto flex-shrink-0 text-[rgba(55,50,47,0.60)] hover:text-[#37322F]"
      disabled={!previewUrl}
      onClick={() => window.open(previewUrl, "_blank")}
    >
      <svg className="h-[16px] w-[16px] flex-shrink-0 mx-1"  xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#1f1f1f"><path d="M838-65 720-183v89h-80v-226h226v80h-90l118 118-56 57ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 20-2 40t-6 40h-82q5-20 7.5-40t2.5-40q0-20-2.5-40t-7.5-40H654q3 20 4.5 40t1.5 40q0 20-1.5 40t-4.5 40h-80q3-20 4.5-40t1.5-40q0-20-1.5-40t-4.5-40H386q-3 20-4.5 40t-1.5 40q0 20 1.5 40t4.5 40h134v80H404q12 43 31 82.5t45 75.5q20 0 40-2.5t40-4.5v82q-20 2-40 4.5T480-80ZM170-400h136q-3-20-4.5-40t-1.5-40q0-20 1.5-40t4.5-40H170q-5 20-7.5 40t-2.5 40q0 20 2.5 40t7.5 40Zm34-240h118q9-37 22.5-72.5T376-782q-55 18-99 54.5T204-640Zm172 462q-18-34-31.5-69.5T322-320H204q29 51 73 87.5t99 54.5Zm28-462h152q-12-43-31-82.5T480-798q-26 36-45 75.5T404-640Zm234 0h118q-29-51-73-87.5T584-782q18 34 31.5 69.5T638-640Z"/></svg>
    </Button>
    </div>
</div>

       
        
               
          

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button
                  onClick={() => {
    if (!currentProject) return alert("Select a project first");
    setIsGitHubOpen(true);
  }}
                className="flex items-center justify-center rounded-[8px] border border-[rgba(55,50,47,0.12)] bg-white p-2 hover:bg-[#F7F5F3] transition-colors h-8 w-8"
                aria-label="GitHub"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#37322F" className="h-[18px] w-[18px]" viewBox="0 0 16 16">
  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"/>
</svg>
                
              </button>

                <GitHubDeployModal 
  isOpen={isGitHubOpen} 
  onClose={() => setIsGitHubOpen(false)} 
  currentProject={currentProject} 
/>

{/* ⚠️ Assurez-vous d'importer l'icône Zap et Loader de Lucide React */}


              {/* Rendu de la Modal Vercel (Doit être affiché par-dessus le reste) */}
{/* ---------------------------------------------------- */}
{/* Affichage du Composant Modal */}
{/* ---------------------------------------------------- */}

<Button
    onClick={() => {
    if (!currentProject) {
      alert("Veuillez d'abord créer ou sélectionner un projet.");
      return;
    }
    setIsDeployOpen(true); 
  }}
    disabled={deploying}
    className="bg-[#37322F] text-white px-1 py-1 rounded-[12px]  transition flex items-center "
  >
    
              <svg className="h-[16px] fill-white flex md:hidden w-[16px]" xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#fff"><path d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q83 0 155.5 31.5t127 86q54.5 54.5 86 127T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Zm0-82q26-36 45-75t31-83H404q12 44 31 83t45 75Zm-104-16q-18-33-31.5-68.5T322-320H204q29 50 72.5 87t99.5 55Zm208 0q56-18 99.5-55t72.5-87H638q-9 38-22.5 73.5T584-178ZM170-400h136q-3-20-4.5-39.5T300-480q0-21 1.5-40.5T306-560H170q-5 20-7.5 39.5T160-480q0 21 2.5 40.5T170-400Zm216 0h188q3-20 4.5-39.5T580-480q0-21-1.5-40.5T574-560H386q-3 20-4.5 39.5T380-480q0 21 1.5 40.5T386-400Zm268 0h136q5-20 7.5-39.5T800-480q0-21-2.5-40.5T790-560H654q3 20 4.5 39.5T660-480q0 21-1.5 40.5T654-400Zm-16-240h118q-29-50-72.5-87T584-782q18 33 31.5 68.5T638-640Zm-234 0h152q-12-44-31-83t-45-75q-26 36-45 75t-31 83Zm-200 0h118q9-38 22.5-73.5T376-782q-56 18-99.5 55T204-640Z"/></svg>
         <span className="md:flex hidden">
           {deploying ? "Deploying..." : "Deploy site"}
         </span>     
    
  </Button>

                <VercelDeployModal 
    isOpen={isDeployOpen} 
    onClose={() => setIsDeployOpen(false)} 
    currentProject={currentProject} 
/>
              
{showDeploymentStatus && deploymentDetails.status !== 'idle' && (
    <div 
        className={`fixed bottom-4 right-4 p-4 rounded-lg shadow-2xl z-50 max-w-sm w-full 
            ${deploymentDetails.status === 'success' ? 'bg-green-50 border border-green-300' : 
              deploymentDetails.status === 'error' ? 'bg-red-50 border border-red-300' : 
              'bg-blue-50 border border-blue-300'}`
        }
    >
        <div className="flex justify-between items-start">
            <div className="flex items-center space-x-3">
                {deploymentDetails.status === 'deploying' && <Loader className="h-5 w-5 text-blue-600 animate-spin" />}
                {deploymentDetails.status === 'success' && <Check className="h-5 w-5 text-green-600" />}
                {deploymentDetails.status === 'error' && <X className="h-5 w-5 text-red-600" />}
                
                <h4 className={`text-sm font-semibold ${
                    deploymentDetails.status === 'success' ? 'text-green-800' : 
                    deploymentDetails.status === 'error' ? 'text-red-800' : 
                    'text-blue-800'}`
                }>
                    {deploymentDetails.status === 'deploying' ? 'Déploiement en cours' : 
                     deploymentDetails.status === 'success' ? 'Déploiement Terminé' : 
                     'Échec du Déploiement'}
                </h4>
            </div>
            <button onClick={() => setShowDeploymentStatus(false)} className="text-gray-400 hover:text-gray-600">
                <CloseIcon className="h-4 w-4" />
            </button>
        </div>

        <p className="text-sm mt-2 text-gray-700">{deploymentDetails.message}</p>

        {deploymentDetails.url && (
            <a href={deploymentDetails.url} target="_blank" rel="noopener noreferrer">
                <Button variant="link" className="h-8 p-0 mt-1 text-sm text-blue-600">
                    {deploymentDetails.status === 'success' ? 'Voir le Déploiement' : 'Suivre le Statut'}
                    <ExternalLink className="h-3 w-3 ml-1" />
                </Button>
            </a>
        )}

        {deploymentDetails.error && deploymentDetails.status === 'error' && (
            <div className="mt-2 p-2 bg-red-100 rounded text-xs text-red-700">
                **Erreur :** <span className="font-mono">{deploymentDetails.error.substring(0, 100)}...</span>
            </div>
        )}
    </div>
)}

            </div>
          </div>
        </div>

        <div className="w-full h-[calc(100%-64px)] bg-[#fffcf6] flex flex-col">

        
          {activeTab === "preview" ? (
            <div className="flex-grow flex flex-col overflow-hidden w-full h-full">
              {/* SECTION PRÉVISUALISATION (IFRAME) */}
              <div className="flex-grow bg-[#fffcf6] w-full border rounded-[20px] p-1 border-[rgba(55,50,47,0.12)] m-1 h-full  overflow-hidden"
                   style={{ height: `calc(100% - ${logsHeight}%)` }}>
                {previewUrl ? (
                  <iframe ref={iframeRef} src={previewUrl} className="w-full h-full border-0" title="Sandbox Preview" />
                ) : (
                  <div className="flex items-center justify-center h-full text-[rgba(55,50,47,0.60)]">
                    <p>Create a sandbox and start the server.</p>
                  </div>
                )}
              </div>

              {/* SECTION LOGS BRUTS (Ancienne version avec logs.join("\n")) */}
              <div
                className="flex-shrink-0 border-[rgba(55,50,47,0.12)] w-full bg-white"
                style={{ height: `${logsHeight}%` }}
              >
                {/* Barre de contrôle */}
                <div className="flex items-center justify-between p-4 h-12 bg-[#fffcf6] border-[rgba(55,50,47,0.12)]">
                  {/* Boutons d'action */}
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => runAction("create")}
                      disabled={loading}
                      variant="outline"
                      size="sm"
                      className="border-[rgba(55,50,47,0.12)] text-[#37322F] hover:bg-white"
                    >
                      Create
                    </Button>
                    <Button
                      onClick={() => runAction("install")}
                      disabled={loading || !sandboxId}
                      variant="outline"
                      size="sm"
                      className="border-[rgba(55,50,47,0.12)] text-[#37322F] hover:bg-white"
                    >
                      Install
                    </Button>
                    <Button
                      onClick={() => runAction("build")}
                      disabled={loading || !sandboxId}
                      variant="outline"
                      size="sm"
                      className="border-[rgba(55,50,47,0.12)] text-[#37322F] hover:bg-white"
                    >
                      Build
                    </Button>
                    <Button
                      onClick={() => runAction("start")}
                      disabled={loading || !sandboxId}
                      variant="outline"
                      size="sm"
                      className="border-[rgba(55,50,47,0.12)] text-[#37322F] hover:bg-white"
                    >
                      Start
                    </Button>
                  </div>
                  
                  {/* Contrôles de Log (Titre Logs) */}
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-medium px-2 text-[#37322F]">Logs</h3>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-[rgba(55,50,47,0.60)] hover:text-[#37322F]"
                      onClick={() => setLogsHeight((h) => (h === 25 ? 75 : 25))}
                    >
                      <ChevronsUpDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-[rgba(55,50,47,0.60)] hover:text-[#37322F]"
                      onClick={copyLogs}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                
                {/* Contenu des logs bruts */}
                <ScrollArea className="w-full" style={{ height: "calc(100% - 48px)" }}>
                  {/* Ici, on réutilise l'ancien affichage simple de logs */}
                  <p className="text-xs  whitespace-pre-wrap p-4">{logs.join("\n")}</p>
                </ScrollArea>
              </div>
            </div>
          ) : (
            <div className="flex-grow border border-[rgba(55,50,47,0.12)] rounded-[12px]   flex flex-row overflow-hidden w-full h-full">
              <div className="w-1/3 h-full border-r border-[rgba(55,50,47,0.12)] ">
                <div className="p-1 border-[rgba(55,50,47,0.12)] flex justify-between items-center h-8">
                  <h3 className="text-sm font-medium px-2 text-[#37322F]">Files</h3>
                  <Button
                    onClick={() => runAction("addFiles")}
                    disabled={loading || !sandboxId}
                    size="sm"
                    className="bg-[#37322F] hover:bg-[rgba(55,50,47,0.90)] text-white rounded-[25px]"
                  >
                    <HardDrive className="h-4 w-4 mr-2" />
                    
                  </Button>
                </div>
                
<ScrollArea className="h-[calc(100%-57px)] bg-[#fffcf6] p-1">
    <ul className="space-y-1 font-semibold text-[20px]">
        {/* Démarre le rendu récursif à partir de la racine de l'arbre */}
        {Array.from(fileTree.entries()) 
            .sort(([nameA, nodeA], [nameB, nodeB]) => {
                // Trie les dossiers en premier à la racine
                if (nodeA.type === 'directory' && nodeB.type === 'file') return -1;
                if (nodeA.type === 'file' && nodeB.type === 'directory') return 1;
                return nameA.localeCompare(nameB);
            })
            .map(([key, node]) => (
                <FileTreeItem
                    key={key}
                    node={node}
                    activeFile={activeFile}
                    setActiveFile={setActiveFile}
                />
            ))}
    </ul>
    
</ScrollArea>
              
              </div>


              
              <div className="w-2/3 h-full bg-white flex flex-col">
                
                {/* 🆕 1. LE BREADCRUMB HEADER (Header de l'éditeur) */}
                <div className="h-10 flex items-center px-4 border-b border-[rgba(55,50,47,0.12)] bg-[#FFFAF0] flex-shrink-0">
                  {/* Affiche le chemin complet du fichier actif */}
                  

<div className="flex items-center w-full h-full justify-between p-2 border-b border-[rgba(55,50,47,0.1)] h-10">
    <div className="flex items-center gap-2"> {/* Conteneur pour le Breadcrumb */}
        {currentProject && files.length > 0 && activeFile !== null && (
            <FileBreadcrumb 
                filePath={files[activeFile]?.filePath || ""} 
            />
        )}
    </div>

    {/* NOUVEAU: Conteneur des Boutons d'Action (uniquement si un fichier est ouvert) */}
    {currentProject && activeFile !== null && (
        <div className="flex items-center gap-2">
            {/* Bouton Copier */}
            <Button 
                variant="ghost" 
                size="icon" 
                onClick={handleCopyFileContent}
                className={`h-8 w-8 ${copiedFileIndex === activeFile ? "text-black" : "text-black"}`}
                title="Copier le contenu du fichier"
            >
                {copiedFileIndex === activeFile ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>

            {/* Bouton Télécharger */}
            <Button 
                variant="ghost" 
                size="icon" 
                onClick={handleDownloadFile}
                className="h-8 w-8 p-1  text-black"
                title="Télécharger le fichier"
            >
                <Download />
            </Button>
        </div>
    )}
</div>
                </div>

                {/* 2. L'ÉDITEUR MONACO */}
                <div className="flex-grow"> 
                  <Editor
    // 🛑 CORRECTION : Lire directement à partir du projet actif (la source unique de vérité)
    value={currentProject?.files[activeFile]?.content || ""}
    
    height="100%" 
    
    // Langage
    defaultLanguage="typescript" 
    
    // Thème
    theme="customTheme" 
    
    // La fonction de montage
    onMount={handleEditorDidMount} 
    
    // La fonction de changement de contenu
    onChange={(value) => updateFile(value || "")} 
    
    // Options
    options={{
        minimap: { enabled: true },
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        lineNumbersMinChars: 3, 
        fontFamily: "Mozilla Headline", 
        fontSize: 14, 
        backgroundColor: "#fffcf6",
    }}
/>

                </div>
              </div>
              
              
            </div>
          )}
        </div>

            
  <div className="flex md:hidden justify-center items-center border border-[rgba(55,50,47,0.12)]  w-full rounded-[12px] mb-3 bg-[#fffcf6] ">
    <button
        onClick={() => toggleViewMode("chat")}
        className={`px-1 w-1/2 py-1  rounded-l-[12px] transition-colors duration-200 ${
            viewMode === "chat" 
                ? "bg-[#37322F] text-white font-semibold" 
                : "bg-transparent text-gray-700"
        }`}
    >
        Chat
    </button>
    <button
        onClick={() => toggleViewMode("preview")}
        className={`px-1 w-1/2 py-1 rounded-r-lg transition-colors duration-200 ${
            viewMode === "preview" 
                ? "bg-[#37322F] text-white font-semibold" 
                : " text-gray-700"
        }`}
    >
        Preview
    </button>
</div>
      </div>
<ApiKeyModal />

      {/* ---------- SIDEBAR OVERLAY ---------- */}
<div className={`fixed inset-0 z-40 pointer-events-none`}>
  {/* backdrop */}
  <div
    onClick={() => setShowSidebar(false)}
    className={`absolute inset-0 bg-black/40 transition-opacity ${showSidebar ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
  />
  {/* panel */}
  <aside
    className={`absolute left-0 top-0 h-full w-72 bg-white border-r border-[rgba(55,50,47,0.12)] transform transition-transform duration-200 shadow-lg
      ${showSidebar ? "translate-x-0" : "-translate-x-full"}
    `}
    aria-hidden={!showSidebar}
  >
    <div className="p-4 flex items-center justify-between border-b border-[rgba(55,50,47,0.08)]">
      <h3 className="text-sm font-medium">Projects</h3>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={createNewProject} className="h-8 w-8">
          <Plus className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setShowSidebar(false)} className="h-8 w-8">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>

    <div className="p-3 overflow-auto h-[calc(100%-56px)]">
      {projects.length === 0 ? (
        <p className="text-sm text-[rgba(55,50,47,0.6)]">No projects yet.</p>
      ) : (
        <ul className="space-y-2">
          {projects.map((p) => (
            <li key={p.id}>
              <button
  onClick={() => {
    // 1. Sauvegarde le projet actuel si nécessaire (copie de handleProjectClick)
    if (currentProject) {
      saveProject() 
    }
    // 2. Charge le nouveau projet (Imite directement l'appel du <select>)
    loadProject(p.id) 
    // 3. Ferme la sidebar
    setShowSidebar(false)
  }}
  className={`w-full text-left p-3 rounded-md flex flex-col ${
    currentProject?.id === p.id ? "bg-[#F7F5F3] font-semibold" : "hover:bg-[#F7F5F3]"
  }`}
>
ll
                </button>
                <div className="text-sm">{p.name}</div>
                <div className="text-xs text-[rgba(55,50,47,0.6)]">{new Date(p.createdAt).toLocaleString()}</div>
              
            </li>
          ))}
        </ul>
      )}
    </div>
  </aside>
</div>
        
    </div>
  )
}
