/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import ProjectList from './components/ProjectList';
import ConversationStream from './components/ConversationStream';
import ContextMap from './components/ContextMap';
import ManagePanel from './components/ManagePanel';
import { useState, useEffect } from 'react';
import { PanelRightClose, PanelRightOpen, Maximize2, Minimize2 } from 'lucide-react';
import clsx from 'clsx';
import { getActiveUserId, setActiveUserId } from './utils/branchFeedbackDataset';
import { pullRemoteChatHistory, reconstructChatStateFromRecords, startChatHistorySync } from './services/chatHistory';
import { pullRemotePatterns, startPatternSync } from './services/patternSync';
import { mergePatternsFromRemoteRecords, mergeRecoveredChatStateIntoStore, rehydrateStoreForActiveUser } from './store';

export default function App() {
  const isManageRoute = typeof window !== 'undefined' && window.location.pathname === '/manage';
  const MANAGE_PASSWORD = '666888';
  const MANAGE_AUTH_KEY = 'context-map.manage-auth.v1';
  const [isContextMapOpen, setIsContextMapOpen] = useState(true);
  const [isContextMapFullscreen, setIsContextMapFullscreen] = useState(false);
  const [contextMapWidth, setContextMapWidth] = useState(320);
  const [isDragging, setIsDragging] = useState(false);
  const [activeUserId, setActiveUserIdState] = useState<string | null>(null);
  const [userIdInput, setUserIdInput] = useState('');
  const [managePasswordInput, setManagePasswordInput] = useState('');
  const [manageAuthError, setManageAuthError] = useState('');
  const [isManageAuthed, setIsManageAuthed] = useState(false);

  const syncPatternsFromRemote = async () => {
    const records = await pullRemotePatterns();
    mergePatternsFromRemoteRecords(records);
  };

  const syncChatHistoryFromRemote = async () => {
    const records = await pullRemoteChatHistory();
    if (records.length === 0) return;
    mergeRecoveredChatStateIntoStore(reconstructChatStateFromRecords(records));
  };

  useEffect(() => {
    const previous = getActiveUserId();
    if (!previous) return;
    const normalized = previous.trim();
    if (!normalized) return;
    setUserIdInput(normalized);
  }, []);

  useEffect(() => {
    const stopSync = startChatHistorySync();
    const stopPatternSync = startPatternSync();
    return () => {
      stopSync();
      stopPatternSync();
    };
  }, []);

  useEffect(() => {
    if (!isManageRoute || typeof window === 'undefined') return;
    const existing = window.sessionStorage.getItem(MANAGE_AUTH_KEY);
    setIsManageAuthed(existing === '1');
  }, [isManageRoute]);

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

  const handleConfirmUserId = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = userIdInput.trim();
    if (!normalized) return;
    setActiveUserId(normalized);
    await rehydrateStoreForActiveUser();
    await syncChatHistoryFromRemote();
    await syncPatternsFromRemote();
    setActiveUserIdState(normalized);
  };

  useEffect(() => {
    if (!activeUserId) return;

    void syncChatHistoryFromRemote();
    void syncPatternsFromRemote();

    const onOnline = () => {
      void syncChatHistoryFromRemote();
      void syncPatternsFromRemote();
    };

    const onVisible = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        void syncChatHistoryFromRemote();
        void syncPatternsFromRemote();
      }
    };

    window.addEventListener('online', onOnline);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible);
    }

    const timer = window.setInterval(() => {
      void syncChatHistoryFromRemote();
      void syncPatternsFromRemote();
    }, 15000);

    return () => {
      window.removeEventListener('online', onOnline);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
      }
      window.clearInterval(timer);
    };
  }, [activeUserId]);

  const handleManageAuth = (e: React.FormEvent) => {
    e.preventDefault();
    if (managePasswordInput.trim() !== MANAGE_PASSWORD) {
      setManageAuthError('Wrong password.');
      return;
    }
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(MANAGE_AUTH_KEY, '1');
    }
    setManageAuthError('');
    setIsManageAuthed(true);
  };

  const handleSwitchUser = () => {
    if (!activeUserId) return;
    setUserIdInput(activeUserId);
    setActiveUserIdState(null);
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
    <div className="flex h-screen w-full bg-zinc-50 text-zinc-900 overflow-hidden font-sans flex-col">
      {!isManageRoute && activeUserId && (
        <div className="h-10 border-b border-zinc-200 bg-white px-4 flex items-center justify-end gap-2 text-xs text-zinc-600">
          <span>Current User: <strong className="text-zinc-800">{activeUserId}</strong></span>
          <button
            onClick={handleSwitchUser}
            className="px-2 py-1 rounded border border-zinc-300 text-zinc-700 hover:bg-zinc-100"
          >
            Switch
          </button>
        </div>
      )}
      {isManageRoute ? (
        isManageAuthed ? (
          <div className="flex-1 min-h-0">
            <ManagePanel />
          </div>
        ) : (
          <div className="h-full w-full bg-zinc-100 text-zinc-900 flex items-center justify-center">
            <form
              onSubmit={handleManageAuth}
              className="w-full max-w-sm bg-white border border-zinc-200 rounded-2xl shadow-sm p-6 space-y-4"
            >
              <h1 className="text-lg font-semibold">Manage Access</h1>
              <p className="text-sm text-zinc-600">Enter password to open management page.</p>
              <input
                type="password"
                value={managePasswordInput}
                onChange={(e) => {
                  setManagePasswordInput(e.target.value);
                  if (manageAuthError) setManageAuthError('');
                }}
                className="w-full px-4 py-3 rounded-xl border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-zinc-900"
                placeholder="Password"
              />
              {manageAuthError && <div className="text-sm text-red-600">{manageAuthError}</div>}
              <button
                type="submit"
                disabled={!managePasswordInput.trim()}
                className="w-full py-2.5 rounded-xl bg-zinc-900 text-white font-medium hover:bg-zinc-800 disabled:bg-zinc-300 disabled:text-zinc-600"
              >
                Enter Manage
              </button>
            </form>
          </div>
        )
      ) : (
        <div className="flex flex-1 min-h-0">
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
      )}
    </div>
  );
}
