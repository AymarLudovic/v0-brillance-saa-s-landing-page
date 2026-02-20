'use client';

import { useState } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showThinking, setShowThinking] = useState(false);

  const sendMessage = async (useReasoner = false) => {
    if (!input.trim()) return;

    const userMessage: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMessage],
          useReasoner
        })
      });

      if (!response.ok) throw new Error('Erreur API');

      const data = await response.json();
      
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: data.message 
      }]);
    } catch (error) {
      console.error(error);
      alert('Erreur lors de l\'envoi du message');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto p-4 bg-gradient-to-br from-purple-50 to-blue-50">
      <div className="bg-white rounded-lg shadow-lg p-4 mb-4">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
          DeepSeek V3.2 Chat 🧠
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Modèle Pro puissant • Gratuit • 671B paramètres
        </p>
      </div>
      
      <div className="flex-1 overflow-y-auto mb-4 space-y-4 bg-white rounded-lg shadow-lg p-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-10">
            <p className="text-lg">💬 Commencez une conversation</p>
            <p className="text-sm">DeepSeek V3.2 est prêt à vous aider</p>
          </div>
        )}
        
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] p-4 rounded-2xl ${
              msg.role === 'user' 
                ? 'bg-gradient-to-r from-purple-500 to-blue-500 text-white' 
                : 'bg-gray-100 text-gray-800 border border-gray-200'
            }`}>
              <div className="text-xs font-semibold mb-1 opacity-70">
                {msg.role === 'user' ? '👤 Vous' : '🤖 DeepSeek V3.2'}
              </div>
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}
        
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 p-4 rounded-2xl border border-gray-200">
              <div className="flex items-center space-x-2">
                <div className="animate-pulse">🧠</div>
                <span className="text-gray-600 animate-pulse">
                  DeepSeek réfléchit...
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-lg p-4">
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && !loading && sendMessage(showThinking)}
            placeholder="Posez votre question..."
            className="flex-1 border-2 border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:border-purple-500 transition"
            disabled={loading}
          />
          <button
            onClick={() => sendMessage(showThinking)}
            disabled={loading}
            className="bg-gradient-to-r from-purple-500 to-blue-500 text-white px-8 py-3 rounded-lg hover:from-purple-600 hover:to-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition font-semibold"
          >
            Envoyer
          </button>
        </div>
        
        <label className="flex items-center text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showThinking}
            onChange={e => setShowThinking(e.target.checked)}
            className="mr-2"
          />
          🧠 Activer le mode Reasoner (raisonnement avancé)
        </label>
      </div>
    </div>
  );
    }
