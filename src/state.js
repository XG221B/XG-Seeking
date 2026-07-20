import { t } from './i18n.js';

const state = {
  page: "notes",
  notes: [],
  selectedId: "",
  query: "",
  showTrash: false,
  trashNotes: [],
  settings: { language: "zh", title: t("appTitle"), theme: "system" },
  sourceMode: false,
  mindmaps: [],
  selectedMindmapId: "",
  selectedNodeId: "",
  showMindmapTrash: false,
  mindmapQuery: "",
  mindmapTrash: [],
  editingNode: false,
  noteSaveStatus: "",
  mindmapSaveStatus: "",
  dataDirPath: "",
  selectedTag: "",
  storageWarningCount: 0,
};

function storageWarningHtml() {
  if (!state.storageWarningCount) return "";
  return `<div class="storage-warning" role="status">${t("storageWarning")} (${state.storageWarningCount})</div>`;
}

const pageLoadToken = { current: 0 };
const noteSaveQueue = new Map();
const mindmapSaveQueue = new Map();
const app = document.getElementById("app");
const navButtons = Array.from(document.querySelectorAll(".nav button"));

export { state, pageLoadToken, noteSaveQueue, mindmapSaveQueue, app, navButtons, storageWarningHtml };
