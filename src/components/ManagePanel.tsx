import { useMemo, useState } from 'react';
import {
  buildPersonaProfile,
  computeUserBranchStats,
  getActiveUserId,
  getBranchDebugEnabled,
  readAllBranchFeedbackByUser,
  readAllPersonaProfiles,
  readBranchFeedbackDatasetByUser,
  readPersonaProfile,
  savePersonaProfile,
  setActiveUserId,
  setBranchDebugEnabled,
} from '../utils/branchFeedbackDataset';

export default function ManagePanel() {
  const [refreshTick, setRefreshTick] = useState(0);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [profileJson, setProfileJson] = useState('');
  const [status, setStatus] = useState('');
  const [debugEnabled, setDebugEnabled] = useState(getBranchDebugEnabled());

  const activeUserId = getActiveUserId() || '';
  const users = useMemo(() => {
    const byUser = readAllBranchFeedbackByUser();
    const profiles = readAllPersonaProfiles();
    const set = new Set<string>([...Object.keys(byUser), ...Object.keys(profiles)]);
    const arr = Array.from(set).sort();
    return arr;
  }, [refreshTick]);

  const effectiveUserId = selectedUserId || activeUserId || users[0] || '';
  const dataset = effectiveUserId ? readBranchFeedbackDatasetByUser(effectiveUserId) : { should_branch: [], should_not_branch: [] };
  const stats = effectiveUserId ? computeUserBranchStats(effectiveUserId) : null;

  const handleRefresh = () => {
    setRefreshTick((n) => n + 1);
    setDebugEnabled(getBranchDebugEnabled());
    setStatus('Refreshed.');
  };

  const handleToggleDebug = (enabled: boolean) => {
    setBranchDebugEnabled(enabled);
    setDebugEnabled(enabled);
    setStatus(`Console debug ${enabled ? 'enabled' : 'disabled'}.`);
  };

  const handleSwitchActiveUser = () => {
    if (!effectiveUserId) return;
    setActiveUserId(effectiveUserId);
    setStatus(`Active user switched to ${effectiveUserId}`);
  };

  const handleGenerateAndSaveProfile = () => {
    if (!effectiveUserId) return;
    const profile = buildPersonaProfile(effectiveUserId);
    savePersonaProfile(profile);
    setProfileJson(JSON.stringify(profile, null, 2));
    setStatus(`Persona profile updated for ${effectiveUserId}`);
    setRefreshTick((n) => n + 1);
  };

  const handleLoadSavedProfile = () => {
    if (!effectiveUserId) return;
    const profile = readPersonaProfile(effectiveUserId);
    if (!profile) {
      setProfileJson('');
      setStatus('No saved persona profile for this user.');
      return;
    }
    setProfileJson(JSON.stringify(profile, null, 2));
    setStatus(`Loaded saved persona profile for ${effectiveUserId}`);
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-zinc-50 p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="bg-white border border-zinc-200 rounded-xl p-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[220px]">
            <label className="block text-xs text-zinc-500 mb-1">Select User</label>
            <select
              value={effectiveUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 bg-white"
            >
              {!effectiveUserId && <option value="">No user found</option>}
              {users.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleSwitchActiveUser}
            disabled={!effectiveUserId}
            className="px-4 py-2 rounded-lg bg-zinc-900 text-white disabled:bg-zinc-300"
          >
            Set Active User
          </button>
          <button
            onClick={handleGenerateAndSaveProfile}
            disabled={!effectiveUserId}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white disabled:bg-zinc-300"
          >
            Generate + Save Profile
          </button>
          <button
            onClick={handleLoadSavedProfile}
            disabled={!effectiveUserId}
            className="px-4 py-2 rounded-lg border border-zinc-300 bg-white disabled:bg-zinc-100"
          >
            Load Saved Profile
          </button>
          <button
            onClick={handleRefresh}
            className="px-4 py-2 rounded-lg border border-zinc-300 bg-white"
          >
            Refresh
          </button>
          <label className="flex items-center gap-2 text-sm text-zinc-700 ml-2">
            <input
              type="checkbox"
              checked={debugEnabled}
              onChange={(e) => handleToggleDebug(e.target.checked)}
            />
            Console Debug
          </label>
          <div className="text-xs text-zinc-500 ml-auto">
            Active user: <span className="font-medium text-zinc-700">{activeUserId || 'N/A'}</span>
          </div>
        </div>

        {status && <div className="text-sm text-zinc-600">{status}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white border border-zinc-200 rounded-xl p-4">
            <h2 className="text-sm font-semibold mb-3">Dataset Summary</h2>
            <div className="text-sm space-y-1">
              <div>Total: {dataset.should_branch.length + dataset.should_not_branch.length}</div>
              <div>should_branch: {dataset.should_branch.length}</div>
              <div>should_not_branch: {dataset.should_not_branch.length}</div>
            </div>
          </div>

          <div className="bg-white border border-zinc-200 rounded-xl p-4">
            <h2 className="text-sm font-semibold mb-3">Stats</h2>
            {stats ? (
              <div className="text-sm space-y-1">
                <div>branch_rate: {stats.branch_rate.toFixed(3)}</div>
                <div>depth_sensitivity_accept_rate: {stats.depth_sensitivity_accept_rate.toFixed(3)}</div>
                <div>topical_continuity_reject_ignore_ratio: {stats.topical_continuity_reject_ignore_ratio.toFixed(3)}</div>
                <div>accept_ratio: {stats.behaviour_source_ratio.accept_branch.toFixed(3)}</div>
                <div>reject_ratio: {stats.behaviour_source_ratio.reject_branch.toFixed(3)}</div>
                <div>manual_ratio: {stats.behaviour_source_ratio.manually_branch.toFixed(3)}</div>
                <div>ignore_ratio: {stats.behaviour_source_ratio.ignore_branch.toFixed(3)}</div>
              </div>
            ) : (
              <div className="text-sm text-zinc-500">No user selected.</div>
            )}
          </div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Persona Profile JSON</h2>
          <textarea
            value={profileJson}
            onChange={(e) => setProfileJson(e.target.value)}
            className="w-full min-h-[360px] rounded-lg border border-zinc-300 p-3 font-mono text-xs"
            placeholder="Load or generate profile JSON..."
          />
        </div>
      </div>
    </div>
  );
}
