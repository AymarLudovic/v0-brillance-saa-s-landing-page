"use client" // Obligatoire pour utiliser les hooks comme useState et useEffect

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Zap, Loader, Check, LogOut } from 'lucide-react'; 

// ==============================================================================
// 1. TYPES ET CONSTANTES
// ==============================================================================

interface ProjectFile {
    filePath: string;
    content: string;
}

interface CurrentProject {
    id: string;
    name: string;
    files: ProjectFile[];
}

interface VercelDeployModalProps {
    currentProject: CurrentProject | null;
    sandboxId: string;
    onClose: () => void;
    isOpen: boolean;
}

interface LogEntry {
    timestamp: string;
    message: string;
    type: 'info' | 'error' | 'success' | 'start' | 'status';
}

// Étapes de déploiement
type DeployState = 'IDLE' | 'TOKEN_VALIDATED' | 'DEPLOYING' | 'MONITORING' | 'SUCCESS' | 'ERROR';

const DEPLOYMENT_STATES: Record<DeployState, DeployState> = {
    IDLE: 'IDLE',
    TOKEN_VALIDATED: 'TOKEN_VALIDATED',
    DEPLOYING: 'DEPLOYING',
    MONITORING: 'MONITORING',
    SUCCESS: 'SUCCESS',
    ERROR: 'ERROR',
};

const VERCEL_TOKEN_KEY = 'vercel_access_token';
const VERCEL_TOKEN_URL = 'https://vercel.com/account/tokens'; 

// ==============================================================================
// 2. COMPOSANT VercelDeployModal (Export Default Function)
// ==============================================================================

export default function VercelDeployModal({ currentProject, sandboxId, onClose, isOpen }: VercelDeployModalProps) {
    // État du Token
    const [vercelToken, setVercelToken] = useState<string>('');
    const [tokenError, setTokenError] = useState<string>('');
    const [showTokenInput, setShowTokenInput] = useState<boolean>(false);
    
    // État du Déploiement
    const [deployState, setDeployState] = useState<DeployState>(DEPLOYMENT_STATES.IDLE);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [deployUrl, setDeployUrl] = useState<string>('');
    const logIntervalRef = useRef<NodeJS.Timeout | null>(null); 
    const logsEndRef = useRef<HTMLDivElement>(null);

    // ----------------------
    // LOGIQUE DE GESTION DU TOKEN
    // ----------------------

    useEffect(() => {
        // Chargement initial du token
        const storedToken = localStorage.getItem(VERCEL_TOKEN_KEY);
        if (storedToken) {
            setVercelToken(storedToken);
            setDeployState(DEPLOYMENT_STATES.TOKEN_VALIDATED);
        } else {
            setShowTokenInput(true);
        }
    }, []);

    useEffect(() => {
        // Scroll automatique vers le bas
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    const handleTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setVercelToken(e.target.value.trim());
        setTokenError('');
    };

    const saveToken = () => {
        if (vercelToken.length > 50) { 
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
        setLogs([]);
        stopLogPolling();
        addLog('Jeton Vercel supprimé. Veuillez en fournir un nouveau.', 'info');
    };
    
    // ----------------------
    // LOGIQUE DE DÉPLOIEMENT & LOGS
    // ----------------------

    const addLog = useCallback((message: string, type: LogEntry['type']) => {
        const timestamp = new Date().toLocaleTimeString('fr-FR', { hour12: false });
        setLogs(prev => [...prev, { timestamp, message, type }]);
    }, []);
    
    // Fonction pour arrêter le polling
    const stopLogPolling = useCallback(() => {
        if (logIntervalRef.current) {
            clearInterval(logIntervalRef.current);
            logIntervalRef.current = null;
        }
    }, []);

    // Fonction pour interroger le statut Vercel
    const fetchVercelLogs = useCallback(async (id: string) => {
        const statusUrl = `https://api.vercel.com/v13/deployments/${id}`;
        
        try {
            const response = await fetch(statusUrl, {
                headers: {
                    Authorization: `Bearer ${vercelToken}`,
                    'Content-Type': 'application/json',
                },
            });

            const data = await response.json();

            if (!response.ok) {
                addLog(`Erreur de l'API Vercel pendant le suivi: ${data.error?.message || 'Erreur inconnue'}`, 'error');
                stopLogPolling();
                setDeployState(DEPLOYMENT_STATES.ERROR);
                return;
            }

            const currentState = data.state as string; 
            
            // Afficher le statut s'il change
            // Utilise les logs actuels pour éviter les doublons
            if (!logs.find(log => log.message.includes(`Statut: ${currentState}`))) {
                 addLog(`Statut: ${currentState}`, 'status');
            }
            
            // Logique d'arrêt du Polling et de détermination du succès/échec
            if (currentState === 'READY' || currentState === 'CANCELED' || currentState === 'ERROR') {
                stopLogPolling();
            }

            if (currentState === 'READY') {
                addLog(`✅ Déploiement terminé avec succès! URL: ${deployUrl}`, 'success');
                setDeployState(DEPLOYMENT_STATES.SUCCESS);
            } else if (currentState === 'ERROR') {
                addLog('❌ Déploiement ÉCHOUÉ. Veuillez consulter le tableau de bord Vercel.', 'error');
                setDeployState(DEPLOYMENT_STATES.ERROR);
            } 
        } catch (error) {
            addLog(`Erreur de Polling: ${(error as Error).message}`, 'error');
            stopLogPolling();
            setDeployState(DEPLOYMENT_STATES.ERROR);
        }
    }, [vercelToken, deployUrl, logs, stopLogPolling, addLog]); 
    
    // Contrôle de l'intervalle de Polling
    const startLogPolling = useCallback((id: string) => {
        stopLogPolling();
        logIntervalRef.current = setInterval(() => {
            fetchVercelLogs(id);
        }, 3000); 
    }, [fetchVercelLogs, stopLogPolling]);

    // Fonction principale de déploiement
    const startDeployment = useCallback(async () => {
        if (deployState === DEPLOYMENT_STATES.DEPLOYING || deployState === DEPLOYMENT_STATES.MONITORING) return;
        if (!vercelToken || !currentProject) {
            setTokenError('Jeton manquant ou projet non chargé.');
            return;
        }

        addLog(`Début du déploiement pour '${currentProject.name}'...`, 'start');
        setDeployState(DEPLOYMENT_STATES.DEPLOYING);
        setLogs([]);
        setDeployUrl('');
        stopLogPolling();

        const deploymentPayload = {
            projectName: currentProject.name,
            token: vercelToken,
            sandboxId: sandboxId,
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
                addLog(`ÉCHEC: ${errorMsg}`, 'error');
                setDeployState(DEPLOYMENT_STATES.ERROR);
                setTokenError(errorMsg); 
                return;
            }

            // Succès du lancement
            addLog(`Déploiement lancé avec succès! ID: ${data.deploymentId}`, 'success');
            setDeployUrl(data.url);
            setDeployState(DEPLOYMENT_STATES.MONITORING);

            // Commence le Polling des Logs Vercel
            startLogPolling(data.deploymentId);

        } catch (error) {
            addLog(`Erreur critique de la requête API: ${(error as Error).message}`, 'error');
            setDeployState(DEPLOYMENT_STATES.ERROR);
        }
    }, [deployState, vercelToken, currentProject, sandboxId, startLogPolling, stopLogPolling, addLog]);

    // Nettoyage lors de la fermeture ou du démontage
    useEffect(() => {
        return () => {
            stopLogPolling();
        };
    }, [stopLogPolling]);


    if (!isOpen) return null;

    // ----------------------
    // RENDU
    // ----------------------
    
    const isActionActive = deployState === DEPLOYMENT_STATES.DEPLOYING || deployState === DEPLOYMENT_STATES.MONITORING;
    const canDeploy = !isActionActive && vercelToken && currentProject;
    
    const tokenSection = (
        <div className="p-3 border border-[rgba(55,50,47,0.1)] rounded-lg bg-[#F7F5F3] flex flex-col gap-2">
            <h3 className="font-semibold text-sm flex justify-between items-center">
                Jeton d'Accès Vercel
                {vercelToken && !showTokenInput && (
                    <button onClick={() => setShowTokenInput(true)} className="text-xs text-[#37322F]/60 hover:text-[#37322F] underline transition-colors">
                        Modifier le jeton
                    </button>
                )}
            </h3>
            
            <a 
                href={VERCEL_TOKEN_URL} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:text-blue-800 underline transition-colors"
            >
                Générer ou trouver votre jeton personnel ici
            </a>

            {showTokenInput ? (
                <>
                    <input
                        type="password"
                        value={vercelToken}
                        onChange={handleTokenChange}
                        placeholder="Collez votre jeton Vercel ici..."
                        className={`w-full p-2 border rounded-md text-sm font-mono ${tokenError ? 'border-red-500' : 'border-[rgba(55,50,47,0.1)]'}`}
                    />
                    <div className="flex justify-between items-center">
                         <button 
                            onClick={saveToken} 
                            className="text-xs text-white px-3 py-1 bg-green-600 rounded-md hover:bg-green-700 transition-colors"
                            disabled={vercelToken.length < 50}
                        >
                            Enregistrer le jeton
                        </button>
                        {vercelToken && (
                           <button 
                                onClick={removeToken} 
                                className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700 transition-colors"
                            >
                                <LogOut className="h-3 w-3" /> Supprimer
                            </button>
                        )}
                    </div>
                </>
            ) : (
                <div className="text-sm font-mono truncate py-1.5 border border-green-500 bg-green-50/50 rounded-md px-2 flex justify-between items-center">
                    Jeton enregistré.
                    <Check className="h-4 w-4 text-green-600" />
                </div>
            )}
            {tokenError && <p className="text-xs text-red-500 mt-1">{tokenError}</p>}
        </div>
    );
    
    const logsSection = (
        <div className="flex flex-col gap-2 flex-grow min-h-0">
            <h3 className="font-semibold text-sm">Logs de Déploiement ({deployState})</h3>
            <div className="flex-grow bg-black text-white text-xs p-3 rounded-lg overflow-y-scroll font-mono min-h-[150px] max-h-[300px] border border-gray-700">
                {logs.length === 0 && <p className="text-gray-500">En attente de lancement du déploiement...</p>}
                {logs.map((log, i) => (
                    <div key={i} className={`flex gap-2 ${
                        log.type === 'error' ? 'text-red-400' : 
                        log.type === 'success' ? 'text-green-400 font-bold' : 
                        log.type === 'start' ? 'text-yellow-300' : 
                        'text-gray-300'
                    }`}>
                        <span className="text-gray-500 flex-shrink-0">[{log.timestamp}]</span>
                        <span className="whitespace-pre-wrap">{log.message}</span>
                    </div>
                ))}
                <div ref={logsEndRef} />
            </div>
        </div>
    );

    return (
        // Utilise un overlay fixe pour la modal
        <div className="fixed inset-0 w-full h-full bg-black/50 flex justify-end items-start z-[9999] p-5">
            {/* Conteneur de la modal, ajusté à 80px du haut et 2px de la droite */}
            <div className="absolute top-[80px] right-2 max-w-lg w-full bg-white p-5 rounded-xl shadow-2xl flex flex-col gap-4">
                
                {/* En-tête de la Modal */}
                <div className="flex justify-between items-center border-b pb-3 border-[rgba(55,50,47,0.1)]">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <Zap className="h-6 w-6 text-[#37322F]" />
                        Déploiement Vercel
                    </h2>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-[#F7F5F3] transition-colors" aria-label="Fermer">
                        <X className="h-5 w-5 text-[#37322F]" />
                    </button>
                </div>

                {/* Section du Token */}
                {tokenSection}

                {/* Section des Logs */}
                {logsSection}

                {/* Pied de page et Bouton Deploy */}
                <div className="flex justify-between items-center pt-3 border-t border-[rgba(55,50,47,0.1)]">
                    <div className="text-sm">
                        {deployUrl && (deployState === DEPLOYMENT_STATES.SUCCESS || deployState === DEPLOYMENT_STATES.MONITORING) ? (
                            <a href={deployUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 underline">
                                Voir le site (URL: {new URL(deployUrl).hostname})
                            </a>
                        ) : (
                            <p className="text-[#37322F]/60">Projet: {currentProject?.name || 'Inconnu'}</p>
                        )}
                    </div>
                    
                    {/* Bouton Deploy on Vercel */}
                    <button
                        onClick={startDeployment}
                        disabled={!canDeploy}
                        className={`rounded-[10px] w-[200px] text-white flex items-center justify-center transition hover:brightness-90 h-8 px-6 
                            ${canDeploy ? 'bg-[#37322F] hover:bg-[rgba(55,50,47,0.90)]' : 'bg-gray-400 cursor-not-allowed'}`}
                    >
                        {isActionActive ? (
                            <>
                                <Loader className="h-4 w-4 mr-2 animate-spin" />
                                {deployState === DEPLOYMENT_STATES.DEPLOYING ? 'Lancement...' : 'Suivi du déploiement...'}
                            </>
                        ) : (
                            'Deployer sur Vercel'
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
              }
