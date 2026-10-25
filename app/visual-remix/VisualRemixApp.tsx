"use client";

/* Local Blob previews deliberately bypass Next Image optimization and any server. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { ToolsLayout } from "@/components/ToolsLayout";
import {
  emptyScene,
  importProposal,
  REMIX_LIMITS,
  type Scene,
  type SceneNode,
  type RasterAsset,
} from "@/lib/visual-remix";
import {
  LocalAssets,
  type RasterCrop,
  loadPortableProject,
  savePortableProject,
} from "@/lib/visual-remix-assets";
import {
  VisualRemixController,
  type LayoutDiagnostic,
} from "@/lib/visual-remix-controller";
import { renderScene } from "@/lib/visual-remix-renderer";
import { RemixMotion } from "@/lib/visual-remix-motion";
import { agentBrief, proposalSchema } from "@/lib/visual-remix-agent";

import { VisualRemixTransport } from "@/lib/visual-remix-transport";
import type { SceneSharingState } from "@/lib/visual-remix-sharing-view";
import { SceneSharingPanel } from "./SceneSharingPanel";
import { ReferenceCrop } from "./ReferenceCrop";

const sceneRemoteEnabled = process.env.NEXT_PUBLIC_SCENE_REMOTE === "true";
type Snapshot = ReturnType<VisualRemixController["snapshot"]>;
const button =
  "inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40";
const primary = `${button} !border-zinc-900 !bg-zinc-900 !text-white hover:!bg-zinc-700`;
const input =
  "w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-2 focus:outline-orange-500";
const panel = "min-w-0 rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5";

function useBlobURL(blob: Blob | null | undefined) {
  const [url, setURL] = useState<string | null>(null);
  useEffect(() => {
    const next = blob ? URL.createObjectURL(blob) : null;
    // Synchronize an externally allocated Blob URL; allocation during render leaks.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setURL(next);
    return () => {
      if (next) URL.revokeObjectURL(next);
    };
  }, [blob]);
  return url;
}
function Diagnostics({ items }: { items: LayoutDiagnostic[] }) {
  if (!items.length)
    return (
      <p className="text-xs text-emerald-800">
        No layout errors detected. Check visual fidelity before publishing.
      </p>
    );
  return (
    <ul className="space-y-2 text-xs">
      {items.map((d, i) => (
        <li
          key={i}
          className={
            d.severity === "error"
              ? "rounded-lg bg-red-50 p-2 text-red-800"
              : "rounded-lg bg-amber-50 p-2 text-amber-900"
          }
        >
          <strong>
            {d.severity === "error" ? "Fix before PNG export" : "Check fonts"}
            {d.nodeIds.length ? ` · ${d.nodeIds.join(", ")}` : ""}:{" "}
          </strong>
          {d.message}
        </li>
      ))}
    </ul>
  );
}
function Preview({
  title,
  url,
  empty,
}: {
  title: string;
  url: string | null;
  empty: string;
}) {
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
        {url ? (
          <img src={url} alt={title} className="h-full w-full object-contain" />
        ) : (
          <p className="max-w-48 px-4 text-center text-sm text-zinc-500">
            {empty}
          </p>
        )}
      </div>
    </div>
  );
}

export default function VisualRemixApp() {
  const controller = useRef<VisualRemixController | null>(null);
  const sharing = useRef<VisualRemixTransport | null>(null);
  const [sharingState, setSharingState] = useState<SceneSharingState>({ available: sceneRemoteEnabled, canConnect: false, canDisconnect: false, phase: "disconnected" });
  const assets = useRef(new LocalAssets());
  const motion = useRef(new RemixMotion());
  const motionTicket = useRef(0);
  const [motionBusy, setMotionBusy] = useState(false);
  const [motionProgress, setMotionProgress] = useState(0);
  const [motionBlob, setMotionBlob] = useState<Blob | null>(null);
  const [motionMessage, setMotionMessage] = useState("");
  const motionURL = useBlobURL(motionBlob);
  const pending = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const downloadURLs = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const localTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localTicket = useRef(0);
  const [draft, setDraft] = useState<Scene | null>(null);
  const [selected, setSelected] = useState("");
  const [approved, setApproved] = useState<RasterAsset[]>([]);
  const [reference, setReference] = useState<{
    blob: Blob;
    name: string;
    descriptor: RasterAsset;
  } | null>(null);
  const [request, setRequest] = useState(
    "Reconstruct the attached image as editable text, shapes and layout. Update the content as requested and rebalance spacing for readable text.",
  );
  const [proposalText, setProposalText] = useState("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("Preparing your local project…");
  const [error, setError] = useState("");
  const referenceURL = useBlobURL(reference?.blob);
  const currentURL = useBlobURL(snapshot?.output?.png);
  const candidateURL = useBlobURL(snapshot?.preview?.output.png);

  function sync(resetDraft = false) {
    const state = controller.current?.snapshot();
    if (!state) return;
    if (
      motion.current.bind(
        JSON.stringify([state.projectId, state.generation, state.revision]),
      )
    ) {
      motionTicket.current++;
      setMotionBusy(false);
      setMotionBlob(null);
      setMotionMessage("");
    }
    sharing.current?.notifyLocalChange();
    setSnapshot(state);
    if (resetDraft && state.scene) {
      if(localTimer.current)clearTimeout(localTimer.current);localTimer.current=null;localTicket.current++;controller.current?.discardLocalEdit();
      setDraft(structuredClone(state.scene));
      setSelected((id) =>
        state.scene!.nodes.some((n) => n.id === id)
          ? id
          : (state.scene!.nodes[0]?.id ?? ""),
      );
    }
    setApproved(assets.current.descriptors());
  }
  function begin(invalidate = false) {
    if(localTimer.current)clearTimeout(localTimer.current);localTimer.current=null;localTicket.current++;controller.current?.discardLocalEdit();
    pending.current?.abort();
    const abort = new AbortController();
    pending.current = abort;
    const ticket = ++epoch.current;
    setBusy(true);
    setError("");
    if (invalidate) {
      controller.current?.revoke();
      sync();
    }
    return { abort, ticket };
  }
  function finish(ticket: number) {
    if (ticket === epoch.current) {
      setBusy(false);
      pending.current = null;
    }
  }
  function report(cause: unknown, ticket?: number) {
    if (ticket !== undefined && ticket !== epoch.current) return;
    const reason = cause instanceof Error ? cause.message : "";
    const messages: Record<string, string> = {
      INVALID_SCENE_DATA:
        "Invalid scene data. Check the downloaded schema, canvas bounds and approved asset IDs.",
      INVALID_RASTER: "Choose a valid PNG/JPEG under 10 MB and 16 megapixels.",
      ASSET_LIMIT:
        "This project has reached its asset limit. Open a new project to use a different asset set.",
      ASSET_PIXEL_LIMIT:
        "Approved assets exceed the 32-megapixel limit. Use smaller crops.",
      ASSET_NOT_APPROVED:
        "The proposal references an asset that is not approved in this project.",
      REQUEST_ID_CONFLICT:
        "That request ID was already used with different content. Ask the agent for a fresh request ID.",
      FIX_LAYOUT_BEFORE_EXPORT:
        "Fix the applied image layout errors before exporting a PNG.",
    };
    setMessage("Operation failed. Your last applied image is preserved.");
    setError(
      cause instanceof SyntaxError
        ? "Could not read JSON. Import a JSON object without markdown fences."
        : messages[reason] ||
            reason ||
            "This local operation failed. Your last applied image is unchanged.",
    );
  }
  useEffect(() => {
    const c = new VisualRemixController(renderScene),
      store = new LocalAssets();
    controller.current = c;
    assets.current = store;
    // Default-off build gate. No capability probe, fetch or auto-connect at mount.
    const remote = sceneRemoteEnabled ? new VisualRemixTransport(c, true, setSharingState, () => sync()) : null;
    sharing.current = remote;
    const wake = () => { if (document.visibilityState === "visible") remote?.refresh(); };
    window.addEventListener("focus",wake);document.addEventListener("visibilitychange",wake);
    const ticket = ++epoch.current;
    void c
      .open(crypto.randomUUID(), 0, emptyScene(), store)
      .then(() => {
        if (ticket !== epoch.current) return;
        const s = c.snapshot();
        setSnapshot(s);
        if (remote) setSharingState(remote.snapshot());
        setDraft(s.scene);
        setBusy(false);
        setMessage("Ready. Select a reference or open a saved project.");
      })
      .catch((e) => {
        if (ticket === epoch.current) {
          setError(String(e));
          setBusy(false);
        }
      });
    const urls = downloadURLs.current;
    const video = motion.current;
    // Invalidate the latest async ticket, not the ticket captured at mount.
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      epoch.current++;
      pending.current?.abort();
      if(localTimer.current)clearTimeout(localTimer.current);localTicket.current++;
      video.cancel();
      window.removeEventListener("focus",wake);document.removeEventListener("visibilitychange",wake);
      remote?.dispose();
      sharing.current = null;
      c.dispose();
      for (const [url, timer] of urls) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      urls.clear();
    };
  // The remote callback reads current refs; keep one owner per controller lifecycle.
  }, []);

  async function exportMotion() {
    const c = controller.current;
    if (!c || motionBusy) return;
    const state = c.snapshot();
    motion.current.bind(
      JSON.stringify([state.projectId, state.generation, state.revision]),
    );
    const ticket = ++motionTicket.current;
    setMotionBusy(true);
    setMotionProgress(0);
    setMotionMessage("Loading the local video processor…");
    try {
      const png = c.exportPNG();
      const completed = await motion.current.render(
        png,
        state.scene!.background,
        async (...args) => {
          const { renderRemixMotion } =
            await import("@/lib/visual-remix-motion-browser");
          args[2].throwIfAborted();
          return renderRemixMotion(...args);
        },
        (percent) => {
          setMotionProgress(percent);
          setMotionMessage("Encoding and verifying your five-second MP4…");
        },
      );
      if (ticket !== motionTicket.current) return;
      if (completed) {
        setMotionBlob(motion.current.output);
        setMotionMessage(
          "MP4 ready: 1080 × 1440, 5 seconds. Preview before downloading.",
        );
      }
    } catch (cause) {
      if (ticket === motionTicket.current)
        setMotionMessage(
          `${cause instanceof Error ? cause.message : "Video export failed."} Your applied PNG is preserved.`,
        );
    } finally {
      if (ticket === motionTicket.current) setMotionBusy(false);
    }
  }
  function cancelMotion() {
    motionTicket.current++;
    motion.current.cancel();
    setMotionBusy(false);
    setMotionMessage("Motion export cancelled. Your applied PNG is preserved.");
  }

  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url);
      downloadURLs.current.delete(url);
    }, 30_000);
    downloadURLs.current.set(url, timer);
  }
  function jsonDownload(value: unknown, name: string) {
    download(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
      name,
    );
  }
  async function selectReference(file: File) {
    const { abort, ticket } = begin(true);
    setMessage("Checking reference pixels locally…");
    try {
      const store = new LocalAssets();
      const descriptor = await store.add("reference", file, abort.signal);
      if (ticket !== epoch.current) return;
      setReference({
        blob: store.blob(descriptor),
        name: file.name,
        descriptor,
      });
      setMessage(
        "Reference ready locally. Attach it yourself to your chosen vision agent; this tool has not sent it.",
      );
    } catch (e) {
      report(e, ticket);
    } finally {
      finish(ticket);
    }
  }
  async function approveAsset(file: File) {
    const { abort, ticket } = begin(true);
    setMessage("Validating this explicitly approved local asset…");
    try {
      const descriptor = await assets.current.add(
        `asset-${crypto.randomUUID()}`,
        file,
        abort.signal,
      );
      if (ticket !== epoch.current) return;
      sync();
      setMessage(
        `Approved ${descriptor.id}. Only its descriptor appears in the agent brief; used pixels may be embedded in a saved local project.`,
      );
    } catch (e) {
      report(e, ticket);
    } finally {
      finish(ticket);
    }
  }
  async function approveCrop(blob: Blob, crop: RasterCrop, kind: string) {
    if (!reference) return;
    const { abort, ticket } = begin(true);
    setMessage("Approving selected crop pixels and preparing a local placement preview…");
    try {
      const c = controller.current!, state = c.snapshot();
      if (!state.scene || state.scene.nodes.length >= REMIX_LIMITS.nodes) throw new Error("ASSET_LIMIT");
      const descriptor = await assets.current.add(`${kind}-${crypto.randomUUID()}`, blob, abort.signal);
      abort.signal.throwIfAborted();
      if (ticket !== epoch.current) return;
      // Already-used descriptors cross MCP. Insert locally under explicit Apply
      // rather than widening remote access to unused approved assets.
      const scene = structuredClone(state.scene);
      const scale = Math.min(1080/reference.descriptor.width, 1440/reference.descriptor.height);
      const width = Math.max(1,crop.width*scale), height = Math.max(1,crop.height*scale);
      scene.assets.push(descriptor);
      scene.nodes.push({id:descriptor.id,type:"image",assetId:descriptor.id,x:Math.min(1080-width,crop.x*scale),y:Math.min(1440-height,crop.y*scale),width,height,rotation:0,opacity:1,crop:{x:0,y:0,width:descriptor.width,height:descriptor.height}});
      const result = await c.propose({schemaVersion:1,requestId:`crop-${crypto.randomUUID()}`,projectId:state.projectId,generation:state.generation,baseRevision:state.revision,scene,explanation:`Explicitly approved ${kind} crop placement. Review and Apply before downloading a fresh brief or connecting. No full reference pixels are included.`});
      if (ticket !== epoch.current) return;
      sync();
      setMessage(result === "preview" ? "Crop placement preview ready. Apply this candidate to make its asset available to the agent. Repeat for other identity assets, then download a fresh brief and connect." : `Crop placement ${result}; current Scene unchanged.`);
    } catch(e) { report(e,ticket); } finally {finish(ticket);}
  }
  async function openProject(file: File) {
    const { abort, ticket } = begin(true);
    setMessage("Checking and rendering saved project…");
    try {
      if (file.size > REMIX_LIMITS.projectBytes)
        throw new Error("Project exceeds the 20 MB limit.");
      const loaded = await loadPortableProject(await file.text(), abort.signal);
      if (ticket !== epoch.current) return;
      await controller.current!.open(
        loaded.project.projectId,
        loaded.project.revision,
        loaded.project.scene,
        loaded.assets,
      );
      if (ticket !== epoch.current) return;
      assets.current = loaded.assets;
      setReference(null);
      setProposalText("");
      sync(true);
      setMessage(
        "Project reopened with fresh approval identity. Edit or request the next post without the original reference.",
      );
    } catch (e) {
      report(e, ticket);
    } finally {
      finish(ticket);
    }
  }
  async function newProject() {
    const { ticket } = begin(true);
    const store = new LocalAssets();
    setMessage("Creating a blank local project…");
    try {
      await controller.current!.open(
        crypto.randomUUID(),
        0,
        emptyScene(),
        store,
      );
      if (ticket !== epoch.current) return;
      assets.current = store;
      setReference(null);
      setProposalText("");
      sync(true);
      setMessage("New blank project ready.");
    } catch (e) {
      report(e, ticket);
    } finally {
      finish(ticket);
    }
  }
  async function previewJSON(raw: string) {
    const { abort, ticket } = begin();
    setMessage("Validating and rendering proposal — not applied…");
    try {
      const p = importProposal(raw),
        c = controller.current!;
      abort.signal.addEventListener("abort", () => c.cancel(p.requestId), {
        once: true,
      });
      const result = await c.propose(p);
      if (ticket !== epoch.current) return;
      sync();
      setMessage(
        result === "preview"
          ? "Proposal preview ready. Compare the candidate, then explicitly Apply or Cancel."
          : `Proposal ${p.requestId}: ${result}. Current image unchanged.`,
      );
      if (result === "failed")
        setError(
          "Proposal could not render. Check approved asset IDs and the scene data; current image is unchanged.",
        );
    } catch (e) {
      report(e, ticket);
    } finally {
      finish(ticket);
    }
  }
  async function proposalFile(file: File) {
    const { abort, ticket } = begin();
    try {
      if (file.size > REMIX_LIMITS.proposalBytes)
        throw new Error("Proposal exceeds the 250 KB limit.");
      const raw = await file.text();
      abort.signal.throwIfAborted();
      if (ticket !== epoch.current) return;
      setProposalText(raw);
      await previewJSON(raw);
    } catch (e) {
      report(e, ticket);
    } finally {
      finish(ticket);
    }
  }
  function editDraft(change: (scene: Scene) => Scene) {
    const c = controller.current;
    if (!c || !draft) return;
    const next = change(draft), ticket = ++localTicket.current;
    setDraft(next);setError("");
    if (localTimer.current) clearTimeout(localTimer.current);
    motion.current.cancel();motionTicket.current++;setMotionBusy(false);setMotionBlob(null);setMotionMessage("");
    const edit = c.stageLocalEdit();sync();
    setMessage("Updating local edit… Exports wait for the latest rendered parameters.");
    localTimer.current = setTimeout(() => {
      localTimer.current = null;
      void c.renderLocalEdit(next,edit).then(result => {
        if (ticket !== localTicket.current) return;
        sync();
        setMessage(result === "applied" ? `Local edit applied automatically · revision ${c.snapshot().revision}. Save project to keep it for reuse.` : "Local edit was superseded; current Scene preserved.");
      }).catch(() => {
        if (ticket !== localTicket.current) return;
        sync();setError("These parameters could not render. Correct them or discard the local draft. The last applied Scene is preserved; exports wait for valid parameters.");
      });
    },250);
  }
  function discardLocalDraft() {
    if(localTimer.current)clearTimeout(localTimer.current);localTimer.current=null;localTicket.current++;
    controller.current?.discardLocalEdit();sync(true);setError("");setMessage("Local draft discarded. Last applied Scene preserved.");
  }
  function apply() {
    const id = snapshot?.preview?.requestId;
    if (!id) return;
    try {
      const result = controller.current!.apply(id);
      sync(true);
      setError("");
      setMessage(`Proposal ${id}: ${result}.`);
    } catch (e) {
      report(e);
    }
  }
  function cancel() {
    const id = snapshot?.preview?.requestId;
    if (id) {
      controller.current!.cancel(id);
      sync();
      setMessage(`Proposal ${id}: canceled. Current image unchanged.`);
    }
  }
  function revoke() {
    pending.current?.abort();
    if(localTimer.current)clearTimeout(localTimer.current);localTimer.current=null;localTicket.current++;
    pending.current = null;
    epoch.current++;
    controller.current?.revoke();
    setBusy(false);
    setError("");
    sync();
    setMessage(
      "Pending work revoked. Old agent briefs cannot apply; download a fresh brief to continue.",
    );
  }
  async function save() {
    const c = controller.current,
      s = c?.snapshot();
    if (!s?.scene) return;
    if(s.editing){setError("Wait for the latest local parameters to apply, or discard the draft.");return;}
    const { ticket } = begin();
    try {
      const text = await savePortableProject(
        s.projectId,
        s.revision,
        s.scene,
        assets.current,
      );
      if (ticket !== epoch.current) return;
      download(
        new Blob([text], { type: "application/json" }),
        "visual-remix.project.json",
      );
      setMessage(
        "Saved applied scene and its used approved assets locally. Reference is excluded unless you explicitly approved it as an asset.",
      );
    } catch (e) {
      report(e, ticket);
    } finally {
      finish(ticket);
    }
  }
  function brief() {
    const s = controller.current?.snapshot();
    if (!s?.scene) throw new Error("Project is not ready.");
    if(s.editing)throw new Error("LOCAL_EDIT_PENDING");
    return agentBrief(
      { ...s, scene: s.scene },
      assets.current.descriptors(),
      request,
    );
  }
  function downloadBrief() {
    try {
      download(
        new Blob([brief()], { type: "application/json" }),
        "visual-remix.agent-brief.json",
      );
      setMessage(
        "Brief downloaded locally. Attach it and, for first reconstruction, the reference image to your chosen agent.",
      );
    } catch (e) {
      report(e);
    }
  }
  async function copyBrief() {
    try {
      await navigator.clipboard.writeText(brief());
      setMessage(
        "Agent brief copied. Images and asset bytes were not included.",
      );
    } catch {
      setError("Clipboard unavailable. Download the agent brief instead.");
    }
  }
  function updateNode(patch: Partial<SceneNode>) {
    editDraft(s => ({...s,nodes:s.nodes.map(n=>n.id===selected?({...n,...patch} as SceneNode):n)}));
  }
  function addText() {
    const id = `text-${crypto.randomUUID()}`;
    editDraft((s) => ({
            ...s,
            nodes: [
              ...s.nodes,
              {
                id,
                type: "text",
                x: 80,
                y: 80,
                width: 900,
                height: 160,
                rotation: 0,
                opacity: 1,
                text: "Your text",
                font: "sans",
                fontSize: 48,
                fontWeight: "normal",
                lineHeight: 1.3,
                align: "left",
                wrap: "word",
                fill: "#111111",
              },
            ],
          }));
    setSelected(id);
  }
  function moveNode(direction: number) {
    editDraft((s) => {
      const nodes = [...s.nodes],
        at = nodes.findIndex((n) => n.id === selected),
        to = at + direction;
      if (at < 0 || to < 0 || to >= nodes.length) return s;
      [nodes[at], nodes[to]] = [nodes[to], nodes[at]];
      return { ...s, nodes };
    });
  }
  const node = draft?.nodes.find((n) => n.id === selected);
  const ready = !!snapshot?.scene && !busy;
  const exportable =
    ready &&
    !!snapshot?.scene?.nodes.length && !snapshot.editing &&
    !snapshot?.output?.diagnostics.some((d) => d.severity === "error");
  const changes =
    snapshot?.preview && snapshot.scene
      ? [
          ...new Set([
            ...snapshot.scene.nodes.map((n) => n.id),
            ...snapshot.preview.scene.nodes.map((n) => n.id),
          ]),
        ].filter(
          (id) =>
            JSON.stringify(snapshot.scene!.nodes.find((n) => n.id === id)) !==
            JSON.stringify(
              snapshot.preview!.scene.nodes.find((n) => n.id === id),
            ),
        )
      : [];

  return (
    <ToolsLayout>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-orange-700">
            Reference → editable scene → next post
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Visual Remix
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-600">
            Keep the design. Change the story. Use your chosen vision agent to
            rebuild a flattened image, review its proposal, then save an
            editable project and a 1080×1440 PNG.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className={button}
            disabled={!ready}
            onClick={() => void newProject()}
          >
            New blank project
          </button>
          <label className={`${button} cursor-pointer`}>
            Open project
            <input
              aria-label="Open project"
              className="sr-only"
              type="file"
              accept=".json,application/json"
              disabled={!ready}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void openProject(f);
              }}
            />
          </label>
        </div>
      </div>
      <div className="mb-5 rounded-xl bg-orange-50 px-4 py-3 text-sm leading-6 text-orange-950">
        <strong>Local by default.</strong> Selecting an image does not upload it
        or run AI. You separately attach it to your chosen agent, which may
        process it remotely. No model key, social login or automatic posting
        here.
      </div>
      {sceneRemoteEnabled && snapshot?.scene && (
        <div className="mb-5">
          <SceneSharingPanel
            key={`${snapshot.generation}:${sharingState.phase === "disconnected" && sharingState.revocationConfirmed ? "revoked" : "current"}`}
            state={sharingState}
            onConnect={() => { void sharing.current?.connect(true).catch(() => setError("Scene sharing could not start. Check the Scene size and current project; local exports are preserved.")); }}
            onDisconnect={() => { void sharing.current?.disconnect(); }}
          />
        </div>
      )}
      <div
        aria-live="polite"
        role="status"
        className="mb-3 text-sm text-zinc-700"
      >
        {busy && (
          <span className="mr-2 inline-block animate-pulse" aria-hidden="true">
            ●
          </span>
        )}
        {message}
      </div>
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900"
        >
          {error}
        </div>
      )}
      <div className="grid items-start gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section className={panel}>
            <h2 className="font-semibold">1. Choose your starting point</h2>
            <p className="mt-2 text-xs leading-5 text-zinc-600">
              Select a flattened PNG/JPG, or open yesterday’s saved project.
              Images stay on this device.
            </p>
            <label className="mt-3 block text-sm font-medium">
              Reference image
              <input
                aria-label="Reference image"
                type="file"
                accept="image/png,image/jpeg"
                disabled={!ready}
                className="mt-2 block w-full text-xs file:mr-2 file:rounded-md file:border-0 file:bg-zinc-100 file:px-2 file:py-2"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void selectReference(f);
                }}
              />
            </label>
            {reference && (
              <p className="mt-2 break-all text-xs text-zinc-500">
                {reference.name} · {reference.descriptor.width}×
                {reference.descriptor.height}. Reference only; not an approved
                scene asset.
              </p>
            )}
            <details className="mt-4 border-t border-zinc-100 pt-3">
              <summary className="cursor-pointer text-sm font-medium">
                Approve local raster assets ({approved.length}/10)
              </summary>
              <p className="my-2 text-xs leading-5 text-zinc-600">
                Choose a cropped photo/logo you own or may reuse. Approval lets
                proposals reference its ID. Saved projects embed the entire
                approved PNG/JPG file for each referenced asset, including
                pixels outside any crop. Asset bytes are never included in the
                agent brief.
              </p>
              {reference && referenceURL && <ReferenceCrop key={referenceURL} source={reference.blob} url={referenceURL} descriptor={reference.descriptor} disabled={!ready} approve={approveCrop} />}
              <p className="my-2">Or approve a separate PNG/JPG you already cropped:</p>
              <input
                aria-label="Approve local asset"
                type="file"
                accept="image/png,image/jpeg"
                disabled={!ready}
                className="w-full text-xs"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void approveAsset(f);
                }}
              />
              <ul className="mt-2 space-y-2 text-xs">
                {approved.map((a) => (
                  <li key={a.id} className="break-all rounded bg-zinc-50 p-2">
                    <code>{a.id}</code>
                    <br />
                    {a.width}×{a.height} · {a.mime}
                  </li>
                ))}
              </ul>
            </details>
          </section>
          <section className={panel}>
            <h2 className="font-semibold">2. Give your agent a brief</h2>
            <label className="mt-3 block text-sm">
              What should change?
              <textarea
                aria-label="Agent request"
                className={`${input} mt-2`}
                rows={4}
                maxLength={4000}
                value={request}
                onChange={(e) => setRequest(e.target.value)}
              />
            </label>
            <p className="my-3 text-xs leading-5 text-zinc-600">
              First time: attach the image plus this brief to a vision-capable
              agent. For reuse, the brief includes your current scene; no
              reference image is needed. Ask for proposal JSON, then return
              here.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                className={primary}
                disabled={!ready}
                onClick={downloadBrief}
              >
                Download agent brief
              </button>
              <button
                className={button}
                disabled={!ready}
                onClick={() => void copyBrief()}
              >
                Copy brief
              </button>
              <button
                className={button}
                onClick={() =>
                  jsonDownload(
                    proposalSchema,
                    "visual-remix.proposal-schema.json",
                  )
                }
              >
                Download schema
              </button>
            </div>
          </section>
          <section className={panel}>
            <h2 className="font-semibold">3. Import a proposal</h2>
            <p className="mt-2 text-xs leading-5 text-zinc-600">
              Data-only JSON, up to 250 KB. Importing renders a separate
              preview; it does not change your applied image.
            </p>
            <label className="mt-3 block text-sm">
              Proposal JSON
              <textarea
                aria-label="Proposal JSON"
                spellCheck={false}
                className={`${input} mt-2 font-mono text-xs`}
                rows={5}
                value={proposalText}
                maxLength={REMIX_LIMITS.proposalBytes}
                onChange={(e) => setProposalText(e.target.value)}
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className={primary}
                disabled={!ready || !proposalText.trim()}
                onClick={() => void previewJSON(proposalText)}
              >
                Preview proposal
              </button>
              <label className={`${button} cursor-pointer`}>
                Import JSON file
                <input
                  aria-label="Import proposal file"
                  className="sr-only"
                  type="file"
                  accept=".json,application/json"
                  disabled={!ready}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void proposalFile(f);
                  }}
                />
              </label>
            </div>
          </section>
        </aside>
        <div className="min-w-0 space-y-5">
          <section className={panel}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">Compare before you apply</h2>
              <span
                className="rounded-full bg-zinc-100 px-3 py-1 text-xs"
                data-testid="revision"
              >
                Applied revision {snapshot?.revision ?? "—"}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Preview
                title="Reference · local only"
                url={referenceURL}
                empty="Select a reference image, or reuse your saved project."
              />
              <Preview
                title="Applied image"
                url={currentURL}
                empty="Your applied scene appears here."
              />
              <Preview
                title="Candidate · not applied"
                url={candidateURL}
                empty="Import agent JSON or preview your edits."
              />
            </div>
            {snapshot?.preview && (
              <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-4">
                <p className="text-sm font-medium">
                  {snapshot.preview.explanation}
                </p>
                <p className="mt-1 break-words text-xs text-zinc-600">
                  Changed nodes: {changes.join(", ") || "none"} ·{" "}
                  {snapshot.preview.scene.nodes.length} candidate nodes.
                  Background, stacking order and captions may also change.
                </p>
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer font-medium">
                    Inspect content and layout changes
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-white p-3">
                    {JSON.stringify(
                      {
                        nodes: changes.map((id) => ({
                          id,
                          before:
                            snapshot.scene?.nodes.find((n) => n.id === id) ??
                            null,
                          after:
                            snapshot.preview!.scene.nodes.find(
                              (n) => n.id === id,
                            ) ?? null,
                        })),
                        background: {
                          before: snapshot.scene?.background,
                          after: snapshot.preview.scene.background,
                        },
                        order: {
                          before: snapshot.scene?.nodes.map((n) => n.id),
                          after: snapshot.preview.scene.nodes.map((n) => n.id),
                        },
                        captions: {
                          before: snapshot.scene?.captions,
                          after: snapshot.preview.scene.captions,
                        },
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
                <div className="mt-3">
                  <Diagnostics items={snapshot.preview.output.diagnostics} />
                </div>
                <div className="mt-3 flex gap-2">
                  <button className={primary} disabled={!ready} onClick={apply}>
                    Apply candidate
                  </button>
                  <button className={button} disabled={!ready} onClick={cancel}>
                    Cancel candidate
                  </button>
                </div>
                <p className="mt-2 text-xs text-zinc-600">
                  Apply may retain layout errors for editing; PNG export stays
                  blocked until you fix them.
                </p>
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className={button}
                disabled={!ready || !snapshot?.canUndo}
                onClick={() => {
                  if(localTimer.current)clearTimeout(localTimer.current);localTimer.current=null;localTicket.current++;
                  controller.current!.undo();
                  sync(true);
                  setError("");
                  setMessage(
                    "Undo completed. Revision advanced; pending proposals are stale.",
                  );
                }}
              >
                Undo last apply
              </button>
              <button className={button} disabled={!snapshot} onClick={revoke}>
                Revoke pending work
              </button>
            </div>
            {snapshot?.output && (
              <details
                className="mt-4"
                open={snapshot.output.diagnostics.some(
                  (d) => d.severity === "error",
                )}
              >
                <summary className="cursor-pointer text-sm font-medium">
                  Applied image checks ({snapshot.output.diagnostics.length})
                </summary>
                <div className="mt-2">
                  <Diagnostics items={snapshot.output.diagnostics} />
                </div>
              </details>
            )}
          </section>
          <section className={panel}>
            <h2 className="font-semibold">Edit content and layout</h2>
            <p className="mt-2 text-xs text-zinc-600">
              Local parameter edits render and apply automatically after a short pause. Undo restores earlier changes. Remote agent candidates still require Apply. Coordinates use the 1080×1440 canvas.
            </p>
            <fieldset disabled={!ready} className="mt-4 space-y-4">
              <div className="flex flex-wrap gap-2">
                <button
                  className={button}
                  disabled={!ready || (draft?.nodes.length ?? 0) >= 100}
                  onClick={addText}
                >
                  Add text block
                </button>
                <button
                  className={button}
                  disabled={!node}
                  onClick={() => {
                    editDraft(s => ({...s,nodes:s.nodes.filter(n=>n.id!==selected)}));
                    setSelected("");
                  }}
                >
                  Remove selected
                </button>
                <button
                  className={button}
                  disabled={!node}
                  onClick={() => moveNode(-1)}
                >
                  Move backward
                </button>
                <button
                  className={button}
                  disabled={!node}
                  onClick={() => moveNode(1)}
                >
                  Move forward
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  Layer
                  <select
                    aria-label="Layer"
                    className={`${input} mt-1`}
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    <option value="">Choose a layer</option>
                    {draft?.nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.type}: {n.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Background
                  <input
                    aria-label="Background"
                    className={`${input} mt-1`}
                    value={draft?.background ?? ""}
                    onChange={(e) =>
                      editDraft(s => ({...s,background:e.target.value}))
                    }
                  />
                </label>
              </div>
              {node && (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {(
                      [
                        "x",
                        "y",
                        "width",
                        "height",
                        "rotation",
                        "opacity",
                      ] as const
                    ).map((key) => (
                      <label key={key} className="text-sm">
                        {key}
                        <input
                          aria-label={`Node ${key}`}
                          className={`${input} mt-1`}
                          type="number"
                          step={key === "opacity" ? "0.05" : "1"}
                          value={Number.isFinite(node[key]) ? node[key] : ""}
                          onChange={(e) =>
                            updateNode({ [key]: e.target.valueAsNumber })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  {node.type !== "image" && (
                    <label className="block text-sm">
                      Fill
                      <input
                        aria-label="Node fill"
                        className={`${input} mt-1`}
                        value={node.fill}
                        onChange={(e) => updateNode({ fill: e.target.value })}
                      />
                    </label>
                  )}
                  {node.type === "rect" && (
                    <label className="block text-sm">
                      Corner radius
                      <input
                        aria-label="Corner radius"
                        className={`${input} mt-1`}
                        type="number"
                        value={node.cornerRadius}
                        onChange={(e) =>
                          updateNode({ cornerRadius: e.target.valueAsNumber })
                        }
                      />
                    </label>
                  )}
                  {node.type === "image" && (
                    <p className="break-all text-xs text-zinc-600">
                      Approved asset: {node.assetId}. Crop changes can be
                      requested through agent JSON.
                    </p>
                  )}
                  {node.type === "text" && (
                    <>
                      <label className="block text-sm">
                        Text content
                        <textarea
                          aria-label="Text content"
                          className={`${input} mt-1`}
                          rows={4}
                          maxLength={20_000}
                          value={node.text}
                          onChange={(e) => updateNode({ text: e.target.value })}
                        />
                      </label>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <label className="text-sm">
                          Font size
                          <input
                            aria-label="Font size"
                            type="number"
                            className={`${input} mt-1`}
                            value={
                              Number.isFinite(node.fontSize)
                                ? node.fontSize
                                : ""
                            }
                            onChange={(e) =>
                              updateNode({ fontSize: e.target.valueAsNumber })
                            }
                          />
                        </label>
                        <label className="text-sm">
                          Line height
                          <input
                            aria-label="Line height"
                            type="number"
                            step="0.1"
                            className={`${input} mt-1`}
                            value={
                              Number.isFinite(node.lineHeight)
                                ? node.lineHeight
                                : ""
                            }
                            onChange={(e) =>
                              updateNode({ lineHeight: e.target.valueAsNumber })
                            }
                          />
                        </label>
                        {(["font", "fontWeight", "align", "wrap"] as const).map(
                          (key) => (
                            <label key={key} className="text-sm">
                              {key}
                              <select
                                aria-label={key}
                                className={`${input} mt-1`}
                                value={node[key]}
                                onChange={(e) =>
                                  updateNode({ [key]: e.target.value })
                                }
                              >
                                {{
                                  font: ["sans", "serif", "mono"],
                                  fontWeight: ["normal", "bold"],
                                  align: ["left", "center", "right"],
                                  wrap: ["word", "char"],
                                }[key].map((v) => (
                                  <option key={v}>{v}</option>
                                ))}
                              </select>
                            </label>
                          ),
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  Chinese / English publishing captions
                </summary>
                <p className="my-2 text-xs text-zinc-600">
                  Editable titles and copy for manual WeChat / Xiaohongshu
                  handoff. Review translations and facts yourself.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    ["titleCN", "captionCN", "titleEN", "captionEN"] as const
                  ).map((key) => (
                    <label key={key} className="text-sm">
                      {key}
                      <textarea
                        aria-label={key}
                        className={`${input} mt-1`}
                        rows={key.startsWith("title") ? 2 : 4}
                        maxLength={key.startsWith("title") ? 200 : 4000}
                        value={draft?.captions[key] ?? ""}
                        onChange={(e) =>
                          editDraft(s => ({...s,captions:{...s.captions,[key]:e.target.value}}))
                        }
                      />
                    </label>
                  ))}
                </div>
              </details>
              {snapshot?.editing && <button className={button} onClick={discardLocalDraft}>Discard local draft</button>}
              <p role="status" className="text-xs text-zinc-600">{snapshot?.editing ? "Local edit pending · downloads paused" : `Applied locally · revision ${snapshot?.revision ?? 0}`}</p>
            </fieldset>
          </section>
          <section className={panel}>
            <h2 className="font-semibold">
              Save this post. Reuse it tomorrow.
            </h2>
            <p className="my-3 text-xs leading-5 text-zinc-600">
              Downloads use the applied scene only. PNG is the same image shown
              above. Project JSON retains editable layers and used approved
              raster assets; the reference is excluded by default.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                className={primary}
                disabled={!exportable}
                onClick={() => {
                  try {
                    download(
                      controller.current!.exportPNG(),
                      "visual-remix.png",
                    );
                    setMessage("Applied PNG downloaded locally.");
                  } catch (e) {
                    report(e);
                  }
                }}
              >
                Download PNG
              </button>
              <button
                className={button}
                disabled={!ready || snapshot?.editing}
                onClick={() => void save()}
              >
                Save project
              </button>
              <button
                className={button}
                disabled={!ready || snapshot?.editing}
                onClick={() =>
                  jsonDownload(
                    {
                      captions: snapshot!.scene!.captions,
                      provenance: snapshot!.scene!.provenance,
                      limitations: snapshot!.scene!.limitations,
                    },
                    "visual-remix.captions.json",
                  )
                }
              >
                Download captions
              </button>
            </div>
            <div className="mt-5 border-t border-zinc-100 pt-4">
              <h3 className="text-sm font-semibold">A little motion</h3>
              <p className="my-2 text-xs leading-5 text-zinc-600">
                Fade in from your background, then hold the applied image. Five
                seconds, 1080 × 1440. Processing stays on this device and may
                take up to two minutes. Current desktop Chrome is recommended.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  className={button}
                  disabled={!exportable || motionBusy}
                  onClick={() => void exportMotion()}
                >
                  Export MP4
                </button>
                {motionBusy && (
                  <button className={button} onClick={cancelMotion}>
                    Cancel motion export
                  </button>
                )}
                {motionBlob && (
                  <button
                    className={button}
                    disabled={!exportable}
                    onClick={() => download(motionBlob, "visual-remix.mp4")}
                  >
                    Download MP4
                  </button>
                )}
              </div>
              {motionBusy && (
                <progress
                  className="mt-3 w-full"
                  aria-label="Motion export progress"
                  max={100}
                  value={motionProgress}
                />
              )}
              <p
                role="status"
                data-testid="motion-status"
                className="mt-2 text-xs"
              >
                {motionMessage}
              </p>
              {motionURL && (
                <video
                  aria-label="Applied scene motion preview"
                  className="mt-3 max-h-96 w-full"
                  controls
                  playsInline
                  src={motionURL}
                />
              )}
              <a
                className="mt-2 inline-block text-xs underline"
                href="/tools/third-party-notices/ffmpeg-runtime.txt"
              >
                Video processor licenses and source
              </a>
            </div>
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium">
                Inspect applied scene and fidelity notes
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-sm">
                {snapshot?.scene?.limitations ||
                  "No fidelity notes yet. Ask your agent to disclose approximations."}
              </p>
              <pre
                data-testid="applied-scene"
                className="mt-3 max-h-80 overflow-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-100"
              >
                {snapshot?.scene ? JSON.stringify(snapshot.scene, null, 2) : ""}
              </pre>
            </details>
          </section>
        </div>
        <p className="mt-6 text-sm text-zinc-500">
          Canvas rendering uses Konva.{" "}
          <a
            className="underline"
            href="/tools/third-party-notices/konva-LICENSE.txt"
          >
            Konva license and attribution
          </a>
        </p>
      </div>
    </ToolsLayout>
  );
}
