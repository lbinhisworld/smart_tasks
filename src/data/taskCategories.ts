/**
 * @fileoverview 任务大类 / 子类规则（与日报计划生成任务时注入 LLM 的口径一致）。
 */

export interface TaskCategoryLevel2Rule {
  name: string;
  extraction_guide: string;
}

export interface TaskCategoryLevel1Group {
  level_1: string;
  level_2: TaskCategoryLevel2Rule[];
}

export interface TaskCategoryRulesDoc {
  task_categories: TaskCategoryLevel1Group[];
}

/** 与产品约定一致的任务分类规则（level_1 = 大类，level_2.name = 子类） */
export const TASK_CATEGORY_RULES: TaskCategoryRulesDoc = {
  task_categories: [
    {
      level_1: "安全环保管控类 (HSE)",
      level_2: [
        {
          name: "隐患整改项",
          extraction_guide:
            "关注：器材损坏、消防栓、灭火器、定置混乱、漏浆喷溅、防护缺失。关键词：检查发现、隐患、整改、更换。",
        },
        {
          name: "违章行为纠偏",
          extraction_guide:
            "关注：不戴护目镜、未等静止操作、依靠护栏、脱岗。关键词：教育、考核、制止、不规范动作、三三制。",
        },
        {
          name: "季节性防御",
          extraction_guide:
            "关注：杨柳絮、蚊虫、防汛、清淤、风灾。关键词：洒水、滤袋、排水沟、大风预警、纱网。",
        },
        {
          name: "合规性核查",
          extraction_guide:
            "关注：危化品领用、监控联网、排放指标。关键词：环保局、取样、检测、在线监测、污水外排。",
        },
      ],
    },
    {
      level_1: "生产能效对标类 (Production)",
      level_2: [
        {
          name: "产量达标跟踪",
          extraction_guide:
            "关注：实际完成吨数、计划吨数对比、车速。关键词：计划产量、实际完成、欠产、超产、车速提升。",
        },
        {
          name: "能效单耗压降",
          extraction_guide:
            "关注：吨纸电耗、水耗、汽耗的具体数值和对比。关键词：电耗、耗汽、吨耗、比计划高/低、摊薄单耗。",
        },
        {
          name: "损纸消纳专项",
          extraction_guide:
            "关注：损纸的回用量、时间节点。关键词：损纸均匀使用、回抄、每池用量、20日前消纳、清零。",
        },
        {
          name: "成本控制分析",
          extraction_guide:
            "关注：变动成本具体金额。关键词：变动成本、降本增利、财务对撞、超支、节约。",
        },
      ],
    },
    {
      level_1: "质量专项攻坚类 (Quality)",
      level_2: [
        {
          name: "纸病消除专项",
          extraction_guide:
            "关注：成纸表面的缺陷治理。关键词：水印辊纤维束、油点、洞眼、暗杠、斑马纹、黑点。",
        },
        {
          name: "工艺指标优化",
          extraction_guide:
            "关注：具体的物理实测数据及偏差。关键词：克重、平滑度、灰分、干/湿拉力、透气度、合格率。",
        },
        {
          name: "客户反馈闭环",
          extraction_guide:
            "关注：销售部回传的客户意见。关键词：广西铭鸿、客户反馈、试纸、纵向波纹、漏胶、建议。",
        },
        {
          name: "新品/实验跟踪",
          extraction_guide:
            "关注：非标品种的参数摸索。关键词：预浸渍纸、试验新品、改产调试、渗透率、新配方。",
        },
      ],
    },
    {
      level_1: "设备本质安全类 (Maintenance)",
      level_2: [
        {
          name: "预防性维护",
          extraction_guide:
            "关注：日常维保、润滑、测温。关键词：轴承测温、润滑油、冷却风机、异响、振动、定期清理。",
        },
        {
          name: "技术改造攻坚",
          extraction_guide:
            "关注：设备升级、SOP优化。关键词：拉绳法、DCS名称修改、不锈钢门整改、波纹管、技改。",
        },
        {
          name: "备件及资产管理",
          extraction_guide:
            "关注：物资申请、利旧、清理。关键词：报件、申报、机封备件、木托盘利旧、回库备用、废铁倒运。",
        },
        {
          name: "外部干扰防护",
          extraction_guide:
            "关注：公用工程波动及其对设备影响。关键词：电网波动、电压降、闪跳、变频器欠压、供电所。",
        },
      ],
    },
    {
      level_1: "管理作风与赋能类 (Management)",
      level_2: [
        {
          name: "标准执行闭环",
          extraction_guide:
            "关注：对公司安排事项的响应和反思。关键词：安排不落地、反思、闭环态度、转变作风、经手经眼。",
        },
        {
          name: "技能培训考核",
          extraction_guide: "关注：人员素质提升。关键词：晨会提问、背诵规程、现场教育、技能考核、宣贯。",
        },
        {
          name: "精益标准化",
          extraction_guide:
            "关注：现场目视化与规范。关键词：手势推广、标准化操作、定置化、标杆车间、作业手册。",
        },
      ],
    },
  ],
};

/** 供大模型阅读的完整规则 JSON（字符串） */
export function formatTaskCategoryRulesForLlm(): string {
  return JSON.stringify(TASK_CATEGORY_RULES, null, 2);
}

export const TASK_CATEGORY_LEVEL1_LIST = TASK_CATEGORY_RULES.task_categories.map((g) => g.level_1);

/** 任务编号中「大类」三位字母，与 {@link TASK_CATEGORY_LEVEL1_LIST} 逐项对应 */
export const TASK_CATEGORY_LEVEL1_CODE3: Record<string, string> = {
  "安全环保管控类 (HSE)": "HSE",
  "生产能效对标类 (Production)": "PRO",
  "质量专项攻坚类 (Quality)": "QUA",
  "设备本质安全类 (Maintenance)": "MNT",
  "管理作风与赋能类 (Management)": "MAN",
};

/** 大类 → 三位字母码；未知大类时取括号内英文前 3 位或 `GEN` */
export function taskCategoryLevel1Code3(level1: string): string {
  const key = level1.trim();
  const fixed = TASK_CATEGORY_LEVEL1_CODE3[key];
  if (fixed) return fixed;
  const m = /\(([A-Za-z]+)\)/.exec(key);
  if (m) {
    const w = m[1].toUpperCase().replace(/[^A-Z]/g, "");
    if (w.length >= 3) return w.slice(0, 3);
    return w.padEnd(3, "X");
  }
  return "GEN";
}

const DEFAULT_GROUP = TASK_CATEGORY_RULES.task_categories[0]!;

export function getDefaultCategoryPair(): { categoryLevel1: string; categoryLevel2: string } {
  return {
    categoryLevel1: DEFAULT_GROUP.level_1,
    categoryLevel2: DEFAULT_GROUP.level_2[0]!.name,
  };
}

export function level2RulesForLevel1(level1: string): TaskCategoryLevel2Rule[] {
  const g = TASK_CATEGORY_RULES.task_categories.find((c) => c.level_1 === level1);
  return g ? g.level_2 : DEFAULT_GROUP.level_2;
}

export function level2NamesForLevel1(level1: string): string[] {
  return level2RulesForLevel1(level1).map((s) => s.name);
}

/** 旧版单字段「类别」→ 新大类/子类（用于本地数据迁移） */
export const LEGACY_FLAT_CATEGORY_MAP: Record<string, { categoryLevel1: string; categoryLevel2: string }> = {
  安全生产: {
    categoryLevel1: "安全环保管控类 (HSE)",
    categoryLevel2: "隐患整改项",
  },
  技改项目: {
    categoryLevel1: "设备本质安全类 (Maintenance)",
    categoryLevel2: "技术改造攻坚",
  },
  "质量与环保": {
    categoryLevel1: "质量专项攻坚类 (Quality)",
    categoryLevel2: "纸病消除专项",
  },
};

/**
 * 将模型或用户输入的大类/子类归一到规则表中的合法组合；无法匹配时落到默认首项。
 */
export function coerceTaskCategoryPair(
  level1Raw: string,
  level2Raw: string,
): { categoryLevel1: string; categoryLevel2: string } {
  const l1 = level1Raw.trim();
  const l2 = level2Raw.trim();
  const def = getDefaultCategoryPair();

  let group = TASK_CATEGORY_RULES.task_categories.find((c) => c.level_1 === l1);
  if (!group && l1) {
    group = TASK_CATEGORY_RULES.task_categories.find(
      (c) => c.level_1.includes(l1) || l1.includes(c.level_1.split(" ")[0] ?? ""),
    );
  }
  if (!group) {
    const byL2 = TASK_CATEGORY_RULES.task_categories.find((c) =>
      c.level_2.some((s) => s.name === l2 || (l2 && (s.name.includes(l2) || l2.includes(s.name)))),
    );
    if (byL2) group = byL2;
  }
  if (!group) return def;

  const subExact = group.level_2.find((s) => s.name === l2);
  if (subExact) return { categoryLevel1: group.level_1, categoryLevel2: subExact.name };

  if (l2) {
    const subFuzzy = group.level_2.find((s) => l2.includes(s.name) || s.name.includes(l2));
    if (subFuzzy) return { categoryLevel1: group.level_1, categoryLevel2: subFuzzy.name };
  }

  const globalL2 = TASK_CATEGORY_RULES.task_categories.flatMap((c) =>
    c.level_2.map((s) => ({ c, s })),
  ).find(({ s }) => s.name === l2);
  if (globalL2) return { categoryLevel1: globalL2.c.level_1, categoryLevel2: globalL2.s.name };

  return { categoryLevel1: group.level_1, categoryLevel2: group.level_2[0]!.name };
}
