// utils/history.ts

// Interface Message (si elle est définie ailleurs, vous devez l'importer ici)
interface Message { 
    role: "user" | "assistant" | "system"; 
    content: string; 
    // Ajoutez ici les autres propriétés
    images?: any[]; 
    artifactData?: any; 
    externalFiles?: any[]; 
    mentionedFiles?: string[];
    functionResponse?: any;
}

const HISTORY_STORAGE_KEY = 'chat_history_v1';

export const getHistory = (): Message[] => {
    if (typeof window !== 'undefined') {
        const storedHistory = localStorage.getItem(HISTORY_STORAGE_KEY);
        try {
            return storedHistory ? JSON.parse(storedHistory) : [];
        } catch (e) {
            console.error("Failed to parse chat history from localStorage", e);
            return [];
        }
    }
    return [];
};

export const saveHistory = (history: Message[]) => {
    if (typeof window !== 'undefined') {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    }
};

export const updateHistory = (newMsg: Message) => {
    const history = getHistory();
    const updatedHistory = [...history, newMsg];
    saveHistory(updatedHistory);
    return updatedHistory;
};

export const replaceLastHistoryMessage = (finalMsg: Message) => {
    const history = getHistory();
    if (history.length === 0) return;

    const updatedHistory = [...history];
    updatedHistory[updatedHistory.length - 1] = finalMsg;
    saveHistory(updatedHistory);
    return updatedHistory;
};
