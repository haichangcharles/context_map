/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAppStore } from './store';
import ProjectList from './components/ProjectList';
import ConversationStream from './components/ConversationStream';
import ContextMap from './components/ContextMap';
import { useState, useEffect } from 'react';
import { PanelRightClose, PanelRightOpen, Maximize2, Minimize2 } from 'lucide-react';
import clsx from 'clsx';
import { getActiveUserId, setActiveUserId } from './utils/branchFeedbackDataset';

export default function App() {
  const [isContextMapOpen, setIsContextMapOpen] = useState(true);
  const [isContextMapFullscreen, setIsContextMapFullscreen] = useState(false);
  const [contextMapWidth, setContextMapWidth] = useState(320);
  const [isDragging, setIsDragging] = useState(false);
  const [activeUserId, setActiveUserIdState] = useState<string | null>(null);
  const [userIdInput, setUserIdInput] = useState('');

  useEffect(() => {
    const previous = getActiveUserId();
    if (previous) {
      setUserIdInput(previous);
    }
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const newWidth = document.body.clientWidth - e.clientX;
      if (newWidth > 200 && newWidth < 800) {
        setContextMapWidth(newWidth);
      }
    };
    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const handleConfirmUserId = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = userIdInput.trim();
    if (!normalized) return;
    setActiveUserId(normalized);
    setActiveUserIdState(normalized);
  };

  if (!activeUserId) {
    return (
      <div className="h-screen w-full bg-zinc-100 text-zinc-900 flex items-center justify-center">
        <form
          onSubmit={handleConfirmUserId}
          className="w-full max-w-md bg-white border border-zinc-200 rounded-2xl shadow-sm p-6 space-y-4"
        >
          <h1 className="text-lg font-semibold">Enter User ID</h1>
          <p className="text-sm text-zinc-600">
            Please enter your user id before starting. Branch feedback data will be stored under this id.
          </p>
          <input
            value={userIdInput}
            onChange={(e) => setUserIdInput(e.target.value)}
            placeholder="e.g. charles-dev"
            className="w-full px-4 py-3 rounded-xl border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-zinc-900"
          />
          <button
            type="submit"
            disabled={!userIdInput.trim()}
            className="w-full py-2.5 rounded-xl bg-zinc-900 text-white font-medium hover:bg-zinc-800 disabled:bg-zinc-300 disabled:text-zinc-600"
          >
            Continue
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-zinc-50 text-zinc-900 overflow-hidden font-sans">
      {/* Left Sidebar: Projects */}
      {!isContextMapFullscreen && (
        <div className="w-64 border-r border-zinc-200 bg-zinc-100 flex-shrink-0 flex flex-col">
          <ProjectList />
        </div>
      )}

      {/* Middle: Conversation Stream */}
      {!isContextMapFullscreen && (
        <div className="flex-1 flex flex-col relative min-w-0">
          <ConversationStream />
          
          {/* Toggle Context Map Button */}
          <button
            onClick={() => setIsContextMapOpen(!isContextMapOpen)}
            className="absolute top-4 right-4 p-2 bg-white border border-zinc-200 rounded-md shadow-sm hover:bg-zinc-50 z-10"
            title={isContextMapOpen ? "Hide Context Map" : "Show Context Map"}
          >
            {isContextMapOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
          </button>
        </div>
      )}

      {/* Right Sidebar: Context Map */}
      {isContextMapOpen && (
        <div 
          className={clsx(
            "border-l border-zinc-200 bg-white flex-shrink-0 flex flex-col shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.05)] relative",
            isContextMapFullscreen ? "w-full" : ""
          )}
          style={{ width: isContextMapFullscreen ? '100%' : contextMapWidth }}
        >
          {/* Resize Handle */}
          {!isContextMapFullscreen && (
            <div
              className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-400 z-30 transition-colors"
              onMouseDown={() => setIsDragging(true)}
            />
          )}
          
          <button
            onClick={() => setIsContextMapFullscreen(!isContextMapFullscreen)}
            className="absolute top-4 right-4 p-2 bg-white border border-zinc-200 rounded-md shadow-sm hover:bg-zinc-50 z-20"
            title={isContextMapFullscreen ? "Exit Fullscreen" : "Fullscreen Map"}
          >
            {isContextMapFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <ContextMap />
        </div>
      )}
    </div>
  );
}
