import type { TeamTemplate } from "../../domain/model";
import { createCodexAcpProvider } from "../acp";
import { DEFAULT_CODEX_MODEL_PROFILE_ID } from "../provider-model-profiles";

const ROOM_PROGRESS_PROMPT =
  "如果处理不会在一个短回合内结束，先发一条简短进度，再在关键里程碑、阻塞或计划变化时继续同步，避免让用户长时间等待。";
export const ROLE_COMMAND_PERMISSION_PROMPT =
  "默认不允许使用岗位员工命令。只有当你的 prompt 被明确改成已授权你管理岗位员工时，你才能使用 `/role-add`、`/role-remove`、`/role-rename`。";

export function ensureRoleCommandDenyPrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (trimmed.includes("默认不允许使用岗位员工命令")) {
    return trimmed;
  }

  return `${trimmed}${ROLE_COMMAND_PERMISSION_PROMPT}`;
}

export const defaultTemplates: TeamTemplate[] = [
  {
    id: "template-product-pod",
    name: "Product Pod",
    description: "入口协调、研究、实现和归档四个成员，适合产品探索和 coding agent 协作。",
    accentTone: "postit",
    defaultVisibleMemberBlueprintIds: ["lead", "researcher", "builder", "scribe"],
    members: [
      {
        id: "lead",
        name: "Lead Koi",
        handle: "lead",
        summary: "入口成员，接住用户消息并拆解到其他成员。",
        prompt:
          ensureRoleCommandDenyPrompt(
            `你是团队入口成员。先理解用户意图，再按需要用 @>其他成员派活；只提到成员时用 @其他成员。顺序协作时只委派当前该行动的成员，不要把后续成员一次性全叫上，也不要用重复 DM 催办已经清楚的 room 任务。你可以打断自己当前任务去响应最新群消息。${ROOM_PROGRESS_PROMPT}`,
          ),
        accentTone: "postit",
        modelProfileId: DEFAULT_CODEX_MODEL_PROFILE_ID,
        provider: createCodexAcpProvider(),
        isEntryMember: true,
        skills: [
          {
            id: "send-group",
            name: "群消息发送",
            description: "向当前 room 发送群消息。",
            command: "./bin/oa-room-send --scope group",
          },
          {
            id: "delegate",
            name: "委派成员",
            description: "通过 @>handle 委派给其他成员。",
            command: "./bin/oa-room-send --scope group --text \"@>builder 请实现这个方案\"",
          },
        ],
      },
      {
        id: "researcher",
        name: "Reed Otter",
        handle: "research",
        summary: "负责调研、信息汇总和提出备选方案。",
        prompt: ensureRoleCommandDenyPrompt(`你专注于调研和信息整理，优先总结事实、风险和备选路径。收到清晰任务后只回复一次完成你自己的部分，不要额外催其他成员。${ROOM_PROGRESS_PROMPT}`),
        accentTone: "blueprint",
        modelProfileId: DEFAULT_CODEX_MODEL_PROFILE_ID,
        provider: createCodexAcpProvider(),
        skills: [
          {
            id: "search",
            name: "搜索资料",
            description: "搜索外部资料或内部文档。",
            command: "./bin/oa-room-state --room \"$ROOM\"",
          },
        ],
        watch: {
          intervalMinutes: 15,
          enabledByDefault: true,
        },
      },
      {
        id: "builder",
        name: "Forge Crab",
        handle: "builder",
        summary: "负责把方案落成代码或自动化步骤。",
        prompt: ensureRoleCommandDenyPrompt(`你只关心可执行实现、模块边界、测试和回归风险。收到清晰任务后只回复一次完成你自己的部分，不要额外催其他成员。${ROOM_PROGRESS_PROMPT}`),
        accentTone: "paper",
        modelProfileId: DEFAULT_CODEX_MODEL_PROFILE_ID,
        provider: createCodexAcpProvider(),
        skills: [
          {
            id: "exec",
            name: "执行命令",
            description: "在项目里执行工具命令。",
            command: "pwd",
          },
          {
            id: "patch",
            name: "提交补丁",
            description: "生成代码补丁。",
            command: "./bin/oa-room-send --scope group",
          },
        ],
      },
      {
        id: "scribe",
        name: "Tack Finch",
        handle: "scribe",
        summary: "记录决策、监控群聊变化，并在有增量时补发 digest。",
        prompt: ensureRoleCommandDenyPrompt(`你负责记录、归档和周期性回看群消息，仅在有增量时动作。需要汇总时，先等上游要求的 room 回复实际出现，再统一收口；不要提前下场，也不要主动催办其他成员，除非当前任务明确要求你这么做。${ROOM_PROGRESS_PROMPT}`),
        accentTone: "correction",
        modelProfileId: DEFAULT_CODEX_MODEL_PROFILE_ID,
        provider: createCodexAcpProvider(),
        skills: [
          {
            id: "digest",
            name: "汇总变更",
            description: "生成自上次消费以来的 digest。",
            command: "./bin/oa-room-watch",
          },
        ],
        watch: {
          intervalMinutes: 10,
          enabledByDefault: true,
        },
      },
    ],
  },
  {
    id: "template-incident-pod",
    name: "Incident Pod",
    description: "偏排障和调试，适合稳定性问题跟进。",
    accentTone: "blueprint",
    defaultVisibleMemberBlueprintIds: ["dispatcher", "investigator", "recorder"],
    members: [
      {
        id: "dispatcher",
        name: "Dispatch Gull",
        handle: "dispatch",
        summary: "入口成员，负责把告警和用户反馈分配出去。",
        prompt: ensureRoleCommandDenyPrompt(`你是事故处理入口成员。优先明确影响范围、时间线和当前 owner。${ROOM_PROGRESS_PROMPT}`),
        accentTone: "blueprint",
        modelProfileId: DEFAULT_CODEX_MODEL_PROFILE_ID,
        provider: createCodexAcpProvider(),
        isEntryMember: true,
        skills: [
          {
            id: "triage",
            name: "问题分诊",
            description: "分配排障 owner。",
            command: "./bin/oa-room-send --scope group --text \"@investigator 开始排查\"",
          },
        ],
      },
      {
        id: "investigator",
        name: "Probe Fox",
        handle: "investigator",
        summary: "查看日志、指标和配置差异。",
        prompt: ensureRoleCommandDenyPrompt(`你聚焦排障证据链，避免拍脑袋结论。${ROOM_PROGRESS_PROMPT}`),
        accentTone: "paper",
        modelProfileId: DEFAULT_CODEX_MODEL_PROFILE_ID,
        provider: createCodexAcpProvider(),
        skills: [
          {
            id: "logs",
            name: "查看日志",
            description: "拉取日志或调试输出。",
            command: "pwd",
          },
        ],
      },
      {
        id: "recorder",
        name: "Tape Mole",
        handle: "recorder",
        summary: "写时间线和状态播报。",
        prompt: ensureRoleCommandDenyPrompt(`你负责结构化记录事故时间线和对外播报。${ROOM_PROGRESS_PROMPT}`),
        accentTone: "postit",
        modelProfileId: DEFAULT_CODEX_MODEL_PROFILE_ID,
        provider: createCodexAcpProvider(),
        skills: [
          {
            id: "timeline",
            name: "时间线",
            description: "按时间线整理房间消息。",
            command: "./bin/oa-room-state --room \"$ROOM\"",
          },
        ],
        watch: {
          intervalMinutes: 5,
          enabledByDefault: true,
        },
      },
    ],
  },
];
