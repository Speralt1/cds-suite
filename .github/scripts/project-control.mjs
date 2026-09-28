
import fs from "node:fs/promises";

const CONFIG_PATH = ".github/project-control.json";
const START = "<!-- AUTO-STATUS:START -->";
const END = "<!-- AUTO-STATUS:END -->";

export function replaceBlock(source, block, start = START, end = END) {
  const text = String(source ?? "").trimEnd();
  const managed = start + "\n" + String(block).trim() + "\n" + end;
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a < 0 && b < 0) return text ? text + "\n\n" + managed : managed;
  if (a < 0 || b < a) throw new Error("auto_status_markers_invalid");
  const before = text.slice(0, a).trimEnd();
  const after = text.slice(b + end.length).trimStart();
  return [before, managed, after].filter(Boolean).join("\n\n");
}

export function normalize(block) {
  return String(block ?? "").split("\n")
    .filter((line) => !line.startsWith("- **Sync:**"))
    .filter((line) => !line.startsWith("- **Consistencia:**"))
    .filter((line) => !line.startsWith("- **Motivo:**"))
    .join("\n").trim();
}

function extract(source, start = START, end = END) {
  const text = String(source ?? "");
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a < 0 && b < 0) return "";
  if (a < 0 || b < a) throw new Error("auto_status_markers_invalid");
  return text.slice(a + start.length, b).trim();
}

const clean = (v, n = 120) => String(v || "").replace(/\s+/g, " ").trim().slice(0, n);
const short = (sha) => String(sha || "").slice(0, 7);

async function github(repo, path, token) {
  const r = await fetch("https://api.github.com/repos/" + repo + path, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "salva-project-control"
    }
  });
  if (!r.ok) throw new Error("github_http_" + r.status + ":" + await r.text());
  return r.json();
}

async function trello(path, key, token, init = {}) {
  const u = new URL("https://api.trello.com/1" + path);
  u.searchParams.set("key", key);
  u.searchParams.set("token", token);
  const r = await fetch(u, {
    ...init,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(init.headers || {}) }
  });
  if (!r.ok) throw new Error("trello_http_" + r.status + ":" + await r.text());
  return r.json();
}

export function buildBlock(state, meta) {
  const prs = state.openPulls.length
    ? state.openPulls.slice(0, 8).map((p) => "#" + p.number + (p.draft ? " draft" : "")).join(", ")
    : "ninguno";
  const latest = state.latestMerged
    ? "#" + state.latestMerged.number + " · " + clean(state.latestMerged.title)
    : "sin merge reciente";
  return [
    "### AUTO · GitHub",
    "- **Sync:** " + meta.syncedAt,
    "- **Consistencia:** " + meta.consistency,
    "- **Motivo:** " + meta.reason,
    "- **Rama canónica:** " + state.branch,
    "- **HEAD:** " + short(state.headSha) + " · " + clean(state.headMessage),
    "- **Última Action:** " + state.actionStatus,
    "- **Último merge:** " + latest,
    "- **PR abiertos:** " + prs
  ].join("\n");
}

async function main() {
  const cfg = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"));
  const gh = process.env.GITHUB_TOKEN;
  const key = process.env.TRELLO_API_KEY;
  const token = process.env.TRELLO_TOKEN;
  if (!gh) throw new Error("github_token_missing");
  if (!key || !token) {
    console.log("Project Control: Trello secrets missing; sync skipped safely.");
    return;
  }

  const repo = cfg.github.repo;
  const branch = cfg.github.canonicalBranch;
  const enc = encodeURIComponent(branch);
  const [branchInfo, runs, openPulls, closedPulls, card] = await Promise.all([
    github(repo, "/branches/" + enc, gh),
    github(repo, "/actions/runs?branch=" + enc + "&per_page=30", gh),
    github(repo, "/pulls?state=open&base=" + enc + "&per_page=50", gh),
    github(repo, "/pulls?state=closed&base=" + enc + "&sort=updated&direction=desc&per_page=30", gh),
    trello("/cards/" + cfg.trello.masterCardId + "?fields=name,desc,url", key, token)
  ]);

  const headSha = branchInfo?.commit?.sha || "";
  const action = (runs?.workflow_runs || []).find((r) =>
    !String(r.name || "").startsWith("Project Control") && r.head_sha === headSha
  ) || (runs?.workflow_runs || []).find((r) => !String(r.name || "").startsWith("Project Control"));
  const latestMerged = (closedPulls || []).find((p) => p.merged_at);
  const state = {
    branch,
    headSha,
    headMessage: branchInfo?.commit?.commit?.message?.split("\n")[0] || "",
    actionStatus: action ? String(action.name) + " · " + String(action.conclusion || action.status || "unknown").toUpperCase() : "sin Action registrada",
    openPulls: (openPulls || []).map((p) => ({ number: p.number, draft: Boolean(p.draft) })),
    latestMerged
  };

  const reason = clean(process.env.CONTROL_PLANE_REASON || "manual", 80);
  const syncedAt = new Date().toISOString();
  const neutral = buildBlock(state, { syncedAt: "IGNORED", consistency: "IGNORED", reason: "IGNORED" });
  const current = normalize(extract(card.desc, cfg.automation?.markerStart, cfg.automation?.markerEnd));
  const drift = current !== normalize(neutral);
  const consistency = drift
    ? (reason.startsWith("schedule") ? "🛠 DRIFT CORREGIDO" : "🔄 CAMBIO APLICADO")
    : "✅ ALINEADO";
  const block = buildBlock(state, { syncedAt, consistency, reason });
  const desc = replaceBlock(card.desc, block, cfg.automation?.markerStart, cfg.automation?.markerEnd);
  await trello("/cards/" + cfg.trello.masterCardId, key, token, {
    method: "PUT",
    body: JSON.stringify({ desc })
  });
  console.log(JSON.stringify({ ok: true, drift, consistency, head: headSha, prs: state.openPulls }, null, 2));
}

if (process.argv[1]?.endsWith("project-control.mjs")) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
