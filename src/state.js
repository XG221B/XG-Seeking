import { t } from './i18n.js';

const state = {
  page: "home",
  pageLoading: false,
  notes: [],
  selectedId: "",
  query: "",
  showTrash: false,
  trashNotes: [],
  settings: { language: "zh", title: t("appTitle") },
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
};

const pageLoadToken = { current: 0 };
const noteSaveQueue = new Map();
const mindmapSaveQueue = new Map();
const app = document.getElementById("app");
const navButtons = Array.from(document.querySelectorAll(".nav button"));

export { state, pageLoadToken, noteSaveQueue, mindmapSaveQueue, app, navButtons };
