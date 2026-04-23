/**
 * @fileoverview 晨会议题：高管晨会讨论项，可手工新建或从日报摘录创建；可派发为任务并建立关联。
 *
 * @module types/morningTopic
 */

/** 议题业务分类 */
export const MORNING_TOPIC_CATEGORIES = [
  "安全",
  "质量",
  "生产",
  "销售",
  "人事",
  "财务",
  "设备",
  "环保",
  "其他",
] as const;

export type MorningTopicCategory = (typeof MORNING_TOPIC_CATEGORIES)[number];

/** 议题生命周期状态 */
export const MORNING_TOPIC_STATUSES = ["未讨论", "已讨论", "已关闭"] as const;

export type MorningTopicStatus = (typeof MORNING_TOPIC_STATUSES)[number];

/**
 * 单条晨会议题记录。
 */
export interface MorningTopic {
  id: string;
  /** 展示用短编号，如 YT-20260210-a1b2 */
  code: string;
  /** 议题描述（正文） */
  description: string;
  category: MorningTopicCategory;
  /** 参与人姓名列表 */
  participants: string[];
  /** 讨论日期 `YYYY-MM-DD` */
  discussionDate: string;
  /** 创建日期 `YYYY-MM-DD` */
  createdAt: string;
  /** 晨会讨论后的最终结论 */
  finalConclusion: string;
  /** 可沉淀、复用的经验要点 */
  reusableExperience: string;
  status: MorningTopicStatus;
  /** 备注 */
  notes: string;
  /** 操作人/录入人展示名（空则界面可回退为视角名） */
  operatorName: string;
  /** 可选：从日报摘录时的原文片段说明 */
  sourceExcerpt?: string;
  /** 由本议题派发生成的任务编号 */
  linkedTaskCodes?: string[];
}
