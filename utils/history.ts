// Clé utilisée dans le localStorage
const HISTORY_STORAGE_KEY = 'chat_history_v1';

// Interface Message (à importer si dans un fichier séparé)
/*
interface Message { 
    role: "user" | "assistant" | "system"; 
    content: string; 
    // Ajoutez ici les autres propriétés (images, artifactData, etc.)
}
*/

// Fonction pour récupérer l'historique
const getHistory = (): Message[] => {
    if (typeof window !== 'undefined') {
        const storedHistory = localStorage.getItem(HISTORY_STORAGE_KEY);
        try {
            // NOTE: Assurez-vous que l'interface Message utilisée est correcte.
            return storedHistory ? JSON.parse(storedHistory) : [];
        } catch (e) {
            console.error("Failed to parse chat history from localStorage", e);
            return [];
        }
    }
    return [];
};

// Fonction pour sauvegarder l'historique
const saveHistory = (history: Message[]) => {
    if (typeof window !== 'undefined') {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    }
};

// Fonction pour ajouter un message et mettre à jour le localStorage
const updateHistory = (newMsg: Message) => {
    const history = getHistory();
    const updatedHistory = [...history, newMsg];
    saveHistory(updatedHistory);
    return updatedHistory;
};

// Fonction pour remplacer le dernier message (utile pour remplacer le placeholder)
const replaceLastHistoryMessage = (finalMsg: Message) => {
    const history = getHistory();
    if (history.length === 0) return;

    const updatedHistory = [...history];
    // Remplace le dernier message par le message final (complet)
    updatedHistory[updatedHistory.length - 1] = finalMsg;
    saveHistory(updatedHistory);
    return updatedHistory;
};
