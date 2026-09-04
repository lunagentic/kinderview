import { api } from './api.js';

// 브라우저 저장소는 접근 자체가 막히는 환경이 있으므로 항상 감싼다
const readStored = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeStored = (key, value) => { try { localStorage.setItem(key, value); } catch { /* 저장 불가 시 메모리만 */ } };

export const state = {
  me: readStored('kf.me') || null,
  members: [],
  projects: [],
  vendors: [],
  areaLeads: [],
  meta: null,
  today: null,
  slackConfigured: false,
};

export async function loadBootstrap() {
  const data = await api.get('/api/bootstrap');
  state.members = data.members;
  state.projects = data.projects;
  state.vendors = data.vendors;
  state.areaLeads = data.area_leads ?? [];
  state.meta = data.meta;
  state.today = data.today;
  state.slackConfigured = data.slack_configured;
  const valid = data.members.some((m) => m.slack_user_id === state.me && m.is_active);
  if (!valid) setMe(data.me);
  return data;
}

export function setMe(id) {
  state.me = id;
  writeStored('kf.me', id);
}

export const memberOf = (id) => state.members.find((m) => m.slack_user_id === id) || null;
export const projectOf = (id) => state.projects.find((p) => p.id === id) || null;
export const activeMembers = () => state.members.filter((m) => m.is_active);
export const activeProjects = () =>
  state.projects.filter((p) => !p.is_archived && ['ACTIVE', 'PLANNED'].includes(p.status));

export const statusMeta = (code) => {
  const all = [...(state.meta?.normal_statuses || []), ...(state.meta?.out_statuses || [])];
  return all.find((s) => s.code === code) || { code, label: code, tone: 'wait' };
};
export const statusesFor = (area) =>
  area === 'OUT' ? state.meta.out_statuses : state.meta.normal_statuses;
export const leadOf = (area) => state.areaLeads.find((l) => l.area === area) ?? null;
export const leadAreas = (slackUserId) =>
  state.areaLeads.filter((l) => l.slack_user_id === slackUserId).map((l) => l.area);

export const areaMeta = (code) => (state.meta?.areas || []).find((a) => a.code === code) || { code, label: code };
export const issueStatusMeta = (code) =>
  (state.meta?.issue_statuses || []).find((s) => s.code === code) || { code, label: code, tone: 'wait' };
