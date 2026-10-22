import {
  createRequestLane,
  isImmediateLocalRequest,
} from "./request-lanes.mjs";
import { createService } from "../core/service.mjs";
import { createOnboarding } from "../core/onboarding.mjs";
import { createRecycleBin } from "../core/recycle-bin.mjs";
import { searchContext } from "../core/search-index.mjs";
import { fail } from "../core/store.mjs";
import path from "../platform/path.js";
import { Buffer } from "buffer";

export function createGateway({ root, aiOverride } = {}) {
  const mainService = createService({
    dataDir: path.join(root, "data"),
    vaultDir: path.join(root, "vault"),
    aiOverride,
  });
  const onboarding = createOnboarding({
    dataDir: path.join(root, "data"),
    mainService,
    serviceFactory: (options) =>
      createService({
        ...options,
        aiOverride: options.aiOverride ?? aiOverride,
      }),
  });
  const lane = createRequestLane();
  let closed = false,
    paused = false;
  const exclusive = (fn, immediate = false) =>
    lane.run(() => {
      if (closed) throw Error("资料库已关闭");
      return fn();
    }, immediate);
  function publicSearch(result, query, service) {
    result.results = result.results.map((n) => {
      const clean = service.publicNote(n),
        context = searchContext(
          clean,
          query,
          n.location?.type === "semantic" ? n.location.offset : undefined,
        );
      return { ...clean, ...context, body: context.snippet };
    });
    return result;
  }
  async function dispatch(
    urlPath,
    { method = "GET", body = {}, practiceId = "" } = {},
  ) {
    if (!urlPath.startsWith("/api/") || urlPath.includes("://"))
      fail("只允许本地业务接口");
    const url = new URL(urlPath, "https://local.invalid"),
      parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent),
      query = Object.fromEntries(url.searchParams);
    if (parts[1] === "onboarding") {
      if (method === "GET" && parts[2] === "state") return onboarding.state();
      if (method !== "POST") fail("引导接口不存在");
      switch (parts[2]) {
        case "start":
          return onboarding.start(body.materialId, body.customMaterial);
        case "resume":
          return onboarding.resume(body.practiceId);
        case "pause":
          return onboarding.pause(body.practiceId);
        case "reset":
          return onboarding.reset(
            body.practiceId,
            body.materialId,
            body.customMaterial,
          );
        case "select-knowledge":
          return onboarding.selectKnowledge(body.practiceId, body);
        case "advance":
          return onboarding.advance(body.practiceId, body.action);
        case "case":
          return onboarding.caseAction(body.practiceId, body.caseId);
        case "abandon":
          return onboarding.abandon(body.practiceId, body.sessionId);
        case "checkpoint":
          return onboarding.checkpoint(body.practiceId, body);
        case "event":
          return onboarding.clientEvent(body.practiceId, body.event);
        case "test":
          return onboarding.test(body.capability);
        case "dismiss":
          return onboarding.dismiss();
        default:
          fail("引导接口不存在");
      }
    }
    if (parts[1] === "draft-work") {
      const id = String(body.id || query.id || "");
      if (!id || id.length > 300) fail("草稿身份无效");
      const ns = "nativeDrafts";
      const draftScope = id === "appearance" ? "" : practiceId;
      if (method === "GET")
        return mainService.store.get(ns, draftScope + ":" + id, {});
      if (method === "DELETE") {
        mainService.store.remove(ns, draftScope + ":" + id);
        return { removed: true };
      }
      if (method === "PUT") {
        if (JSON.stringify(body.value).length > 1000000) fail("草稿过大");
        return mainService.store.put(ns, draftScope + ":" + id, body.value);
      }
    }
    if (parts[1] === "capture-undo") {
      if (method === "GET") return mainService.chatgptUndo.list();
      const f = {
        confirm: "confirmUndo",
        "restore-preview": "previewRestore",
        "restore-confirm": "confirmRestore",
      }[parts[2]];
      if (f && method === "POST") return mainService.chatgptUndo[f](body);
      fail("本机撤销接口不存在");
    }
    const route = parts.slice(1),
      [resource, id, action] = route;
    const lease = practiceId
      ? onboarding.acquire(practiceId, { resource, method, query })
      : null;
    try {
      const service = lease?.service || mainService;
      let result;
      if (
        resource === "settings" &&
        method === "PUT" &&
        (body.vaultDir || body.dataDir)
      )
        fail(
          "手机资料库使用 App 私有目录，请通过备份文件协作。",
          "MOBILE_DIRECTORY",
        );
      if (
        resource === "settings" &&
        body.mcp &&
        Object.values(body.mcp).some(Boolean)
      )
        fail("MCP 服务在电脑知序启用。手机通过文件协作。", "DESKTOP_ONLY");
      if (resource === "recycle-bin" && !id && method === "GET")
        result = {
          ...createRecycleBin(service.store).list(),
          purgeEnabled: false,
        };
      else if (
        resource === "recycle-bin" &&
        id &&
        action === "restore" &&
        method === "POST"
      )
        result = createRecycleBin(service.store).restore(id, body.versionId);
      else if (resource === "recycle-bin" && !action && method === "DELETE") {
        // Both single-item purge and clear require the same independent owner capability.
        if (true)
          fail(
            "永久删除未启用。恢复功能仍可使用。",
            "RECYCLE_PURGE_DISABLED",
            403,
          );

        if (route.length > 2) fail("回收站接口不存在。", "NOT_FOUND", 404);
        const bin = createRecycleBin(service.store);
        result = id ? bin.purge(id, body.versionId, body) : bin.clear(body);
      } else if (resource === "uploads" && !id && method === "POST")
        result = service.uploadFile({
          name: query.name,
          mime: body.mime || "",
          uploadId: query.uploadId,
          bytes: Buffer.from(body.base64 || "", "base64"),
        });
      else if (resource === "uploads" && !id && method === "GET")
        result = { uploads: service.pendingUploads() };
      else if (resource === "uploads" && id && method === "DELETE")
        result = service.revertUpload(id);
      else if (resource === "file-import" && method === "POST")
        result = await service.commitFile(body);
      else if (
        resource === "notes" &&
        action === "attachments" &&
        method === "GET"
      ) {
        const file = service.readFile(id, query.asset);
        result = {
          descriptor: file.descriptor,
          base64: file.bytes.toString("base64"),
        };
      } else if (resource === "bootstrap" && method === "GET") {
        result = service.bootstrap();
        if (practiceId)
          result.conflicts.push(
            ...service.store.records("onboardingConflicts"),
          );
      } else if (resource === "library" && method === "GET")
        result = service.library(query);
      else if (resource === "notes" && !id && method === "GET")
        result = {
          notes: service
            .listNotes(query)
            .filter((n) => !n.meta.excerptOnly)
            .map(service.publicNote),
        };
      else if (resource === "notes" && id === "merge" && method === "POST")
        result = service.merge(body);
      else if (resource === "notes" && id && !action && method === "GET")
        result = service.readPublicNote(id);
      else if (resource === "notes" && id && !action && method === "PUT")
        result = service.editNote(id, body);
      else if (resource === "notes" && id && !action && method === "DELETE") {
        result = service.store.delete(id, body.expectedHash);
        for (const j of service.store.records("jobs"))
          if (
            j.payload.noteId === id &&
            ["queued", "waiting", "running"].includes(j.state)
          )
            service.jobAction(j.id, { action: "cancel" });
      } else if (
        resource === "notes" &&
        action === "extract" &&
        method === "POST"
      )
        result = service.extractNote(id, body);
      else if (
        resource === "notes" &&
        action === "process" &&
        method === "POST"
      )
        result = service.processNote(id, body);
      else if (
        resource === "notes" &&
        action === "structure" &&
        method === "PUT"
      )
        result = service.editSourceStructure(id, body);
      else if (
        resource === "notes" &&
        action === "structure" &&
        method === "POST"
      )
        result = service.requestSourceStructure(id);
      else if (
        resource === "notes" &&
        action === "promote" &&
        method === "POST"
      )
        result = service.promote(id, body);
      else if (
        resource === "notes" &&
        action === "confirm" &&
        method === "POST"
      )
        result = service.confirmNote(id, body);
      else if (
        resource === "notes" &&
        action === "evidence" &&
        method === "GET"
      )
        result = service.noteEvidence(id);
      else if (resource === "notes" && action === "relate" && method === "POST")
        result = service.requestRelations(id, body);
      else if (
        resource === "notes" &&
        action === "links-preview" &&
        method === "GET"
      )
        result = service.linksPreview(id);
      else if (
        resource === "notes" &&
        action === "links-sync" &&
        method === "POST"
      )
        result = service.syncLinks(id, body);
      else if (resource === "recommendations" && !id && method === "GET")
        result = service.recommendations();
      else if (
        resource === "recommendations" &&
        action === "action" &&
        method === "POST"
      )
        result = service.recommendationAction(id, body);
      else if (resource === "import" && method === "POST")
        result = service.importItems(body);
      else if (resource === "search" && method === "GET") {
        result = publicSearch(
          await service.search(query.q, { ...query, browse: true }),
          query.q,
          service,
        );
      } else if (resource === "ask" && method === "POST")
        result = await service.ask(body);
      else if (resource === "drafts" && !id && method === "GET")
        result = { drafts: service.store.records("drafts") };
      else if (resource === "drafts" && id && !action && method === "PUT")
        result = service.updateDraft(id, body);
      else if (
        resource === "drafts" &&
        action === "capture" &&
        method === "POST"
      ) {
        if (!service.store.get("drafts", id))
          fail("草稿不存在。", "NOT_FOUND", 404);
        result = service.importItems({
          items: [{ ...body, platform: "应用内 AI 草稿（用户选取）" }],
        }).notes[0];
      } else if (resource === "today" && (!id || id === "generate"))
        result = service.today({ regenerate: method === "POST" });
      else if (resource === "today" && action === "action" && method === "POST")
        result = service.planAction(id, body);
      else if (resource === "study" && id === "start" && method === "POST")
        result = service.startStudy(body);
      else if (resource === "study" && !id && method === "GET") {
        const offset = Number(query.offset ?? 0),
          limit = Number(query.limit ?? 50);
        if (
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          !Number.isSafeInteger(limit) ||
          limit < 1 ||
          limit > 100
        )
          fail("学习历史分页范围无效。");
        const sessions = service.store.records("sessions");
        result = {
          sessions: sessions.slice(offset, offset + limit),
          total: sessions.length,
          offset,
          limit,
        };
      } else if (resource === "study" && id && !action && method === "GET")
        result = service.session(id);
      else if (resource === "study" && action === "answer" && method === "POST")
        result = service.answerStudy(id, body);
      else if (resource === "study" && action === "hint" && method === "POST")
        result = service.hintStudy(id);
      else if (
        resource === "study" &&
        action === "confirm" &&
        method === "POST"
      )
        result = service.confirmStudy(id, body);
      else if (resource === "study" && action === "finish" && method === "POST")
        result = service.finishStudy(id);
      else if (resource === "mistakes" && !id && method === "GET")
        result = { mistakes: service.listNotes({ kind: "mistake" }) };
      else if (
        resource === "mistakes" &&
        action === "action" &&
        method === "POST"
      )
        result = service.mistakeAction(id, body);
      else if (resource === "topics" && !id && method === "GET")
        result = { topics: service.topics() };
      else if (resource === "topics" && id === "suggest" && method === "POST")
        result = service.queue("topics", {}, "topics:manual");
      else if (resource === "topics" && !id && method === "POST")
        result = service.createTopic(body);
      else if (resource === "topics" && id && !action && method === "PUT")
        result = service.updateTopic(id, body);
      else if (
        resource === "topics" &&
        action === "action" &&
        method === "POST"
      )
        result = service.topicAction(id, body);
      else if (resource === "relations" && !id && method === "GET")
        result = service.relationReview();
      else if (
        resource === "relations" &&
        action === "action" &&
        method === "POST"
      )
        result = service.relationAction(id, body);
      else if (resource === "discover" && method === "POST")
        result = service.queue(
          "discover",
          { useAI: body.useAI === true },
          `discovery:manual:${new Date().toISOString().slice(0, 10)}:${body.useAI === true}`,
        );
      else if (resource === "jobs" && !id && method === "GET")
        result =
          query.view === "status"
            ? service.jobStatuses()
            : { jobs: service.store.records("jobs").map(service.publicJob) };
      else if (resource === "jobs" && action === "action" && method === "POST")
        result = service.jobAction(id, body);
      else if (resource === "prompts" && method === "GET")
        result = service.getPrompts();
      else if (resource === "prompts" && method === "PUT")
        result = service.updatePrompts(body);
      else if (resource === "settings" && !id && method === "GET")
        result = service.settings();
      else if (resource === "settings" && !id && method === "PUT") {
        if (!practiceId && body.vaultDir)
          onboarding.assertVaultIsolation(body.vaultDir);
        result = service.updateSettings(body);
        if (!practiceId) onboarding.settingsChanged(body);
      } else if (
        resource === "settings" &&
        id === "models" &&
        !action &&
        method === "POST"
      ) {
        if (practiceId)
          fail(
            "请返回正式设置获取共享 API 模型目录。",
            "PRACTICE_SETTINGS_LOCKED",
            409,
          );
        result = await mainService.ai.discoverModels(
          body.capability,
          body.config,
        );
      } else if (
        resource === "settings" &&
        id === "test" &&
        method === "POST"
      ) {
        if (body.config === undefined)
          result = (await onboarding.test(body.capability)).testResult;
        else {
          if (practiceId)
            fail(
              "请返回正式设置测试并保存共享 API 配置。",
              "PRACTICE_SETTINGS_LOCKED",
              409,
            );
          result = await mainService.capabilityTests.test(
            body.capability,
            body.config,
          );
        }
      } else if (
        resource === "settings" &&
        id === "save-tested" &&
        method === "POST"
      ) {
        if (practiceId)
          fail(
            "练习空间不能更改共享 API 配置。",
            "PRACTICE_SETTINGS_LOCKED",
            409,
          );
        result = mainService.capabilityTests.save(
          body.capability,
          body.config,
          body.receipt,
        );
        try {
          onboarding.settingsChanged({
            [body.capability === "model" ? "ai" : body.capability]: {},
          });
          onboarding.tested(body.capability);
        } catch {
          result.warning =
            "配置已保存，但引导进度未更新；无需重复测试，请刷新后检查引导状态。";
        }
      } else if (resource === "usage" && !id && method === "GET") {
        result = mainService.usageReport(query);
        result.sharedUsage = Boolean(practiceId);
      } else if (resource === "usage" && id === "settings" && method === "PUT")
        result = service.updateUsageSettings(body);
      else if (resource === "call-recovery" && !id && method === "GET")
        result = mainService.callRecovery();
      else if (resource === "call-recovery" && id && method === "POST") {
        if (practiceId)
          fail(
            "请返回正式库的用量与费用页面核对调用记录。",
            "PRACTICE_SETTINGS_LOCKED",
            409,
          );
        result = mainService.recoverCall(id, body);
      } else if (resource === "diagnostics" && method === "GET") {
        result = service.diagnostics();
        if (practiceId) {
          result.usage = mainService.usage();
          result.calls = mainService.store.records("calls").slice(0, 100);
          result.sharedUsage = true;
          result.usageNotice =
            "请求上限与日常使用共用。下方调用记录来自共用 AI 服务，包含正式与练习请求；仅在此查看，不写入练习备份。";
        }
      } else if (resource === "index" && id === "local" && method === "POST")
        result = service.rebuildLocalSearch();
      else if (resource === "index" && id === "rebuild" && method === "POST")
        result = service.queue("index", {}, "index:manual");
      else if (resource === "index" && id === "update" && method === "POST")
        result = service.queue("index", { incremental: true }, "index:manual");
      else if (resource === "backup" && method === "GET") {
        result = service.backup();
        if (practiceId) {
          result.learningTime = onboarding.state().clock.now;
          onboarding.observe(practiceId, {
            resource,
            itemId: id,
            action,
            method,
            body,
            query,
            result,
          });
        }
        return result;
      } else if (resource === "restore" && method === "POST") {
        if (
          body.backup?.records?.some?.(
            (record) => record.namespace === "nativeDrafts",
          )
        )
          fail("备份不能替换设备私有草稿。", "BACKUP_DEVICE_STATE", 400);
        result = service.restore(body);
      } else if (resource === "deleted-notes" && !id && method === "GET")
        result = { items: service.store.deletedNotes() };
      else if (resource === "history" && id && !action && method === "GET")
        result = { versions: service.store.history(id) };
      else if (
        resource === "history" &&
        action === "restore" &&
        method === "POST"
      )
        result = service.store.restoreVersion(
          id,
          body.versionId,
          body.expectedHash,
        );
      else if (resource === "proposals" && !id && method === "GET")
        result = { proposals: service.store.records("proposals") };
      else if (
        resource === "proposals" &&
        action === "action" &&
        method === "POST"
      )
        result = service.proposalAction(id, body);
      else if (resource === "demo" && method === "POST")
        result = service.demo();
      else fail("接口不存在。", "NOT_FOUND", 404);
      if (practiceId)
        onboarding.observe(practiceId, {
          resource,
          itemId: id,
          action,
          method,
          body,
          query,
          result,
        });

      return result;
    } finally {
      lease?.release();
    }
  }
  return {
    request: (p, o) =>
      exclusive(() => dispatch(p, o), isImmediateLocalRequest(p, o)),
    pump: () =>
      exclusive(async () => {
        if (paused) return;
        await mainService.tick();
        await onboarding.pump();
      }),
    pause: async () => {
      paused = true;
      await mainService.pauseJobs();
      await onboarding.currentService?.pauseJobs();
    },
    resume: () => {
      paused = false;
    },
    close: async () => {
      await lane.drain();
      closed = true;
      await onboarding.close();
      await mainService.close();
    },
    get busy() {
      return (
        mainService.hasPendingOperations ||
        onboarding.currentService?.hasPendingOperations ||
        false
      );
    },
  };
}
