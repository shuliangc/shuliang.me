#!/usr/bin/env node

/**
 * =============================================================================
 * md-to-html 同步工具
 * =============================================================================
 *
 * 功能说明：
 *   读取 Markdown 简历文件，同步内容到 www/index.html。
 *   支持结构变化检测——仅内容变化时快速更新，结构变化时完整重建 HTML。
 *
 * 使用方式：
 *   node sync.js              单次同步（自动检测结构变化）
 *   node sync.js --watch      监听模式（文件变化时自动同步）
 *   node sync.js --rebuild    强制完整重建 HTML
 *   node sync.js --help       显示帮助信息
 *
 * 工作原理：
 *   1. 解析 Markdown 文件，提取结构化数据
 *   2. 计算"结构哈希"（基于 section 数量、名称、关键字段）
 *   3. 与缓存文件 .sync-cache.json 中的哈希对比
 *      - 哈希一致 → 仅通过 data-md-slot 更新内容（快速）
 *      - 哈希不同 → 完整重建 HTML（结构同步）
 *   4. 更新缓存文件
 *
 * 依赖：
 *   - cheerio（HTML 解析/操作）
 *   - crypto（内置，用于计算哈希）
 * =============================================================================
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cheerio = require("cheerio");

// =============================================================================
// 路径常量
// =============================================================================

/** Markdown 源文件路径 */
const MD_PATH = path.resolve(__dirname, "曹书良-前端开发工程师.md");

/** HTML 输出文件路径 */
const HTML_PATH = path.resolve(__dirname, "www", "index.html");

/** 缓存文件路径（存储结构哈希，用于检测结构变化） */
const CACHE_PATH = path.resolve(__dirname, ".sync-cache.json");

// =============================================================================
// Markdown 解析器
// =============================================================================

/**
 * 将 Markdown 文本解析为结构化 section 数组。
 *
 * @param {string} md - Markdown 原始文本
 * @returns {Array<{type: string, name: string, content: string[]}>} section 数组
 *
 * 每个 section 的结构：
 *   - type: "header" | "section" | "subsection"
 *   - name: 标题文本（不含 # 前缀）
 *   - content: 该标题下的原始行内容数组
 */
function parseMarkdown(md) {
  const lines = md.split("\n");
  const sections = [];
  let currentSection = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    // 跳过分隔线 ---
    if (trimmed === "---") continue;

    // H1 - 姓名（一级标题）
    if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
      if (currentSection) sections.push(currentSection);
      currentSection = {
        type: "header",
        name: trimmed.replace(/^#\s*/, ""),
        content: [],
      };
      continue;
    }

    // H2 - 大段标题（二级标题）
    if (trimmed.startsWith("## ")) {
      if (currentSection) sections.push(currentSection);
      currentSection = {
        type: "section",
        name: trimmed.replace(/^##\s*/, ""),
        content: [],
      };
      continue;
    }

    // H3 - 子段标题（三级标题，如工作经历中的公司名、项目名）
    if (trimmed.startsWith("### ")) {
      if (currentSection) sections.push(currentSection);
      currentSection = {
        type: "subsection",
        name: trimmed.replace(/^###\s*/, ""),
        content: [],
      };
      continue;
    }

    // 收集当前 section 下的内容行
    if (currentSection && trimmed.length > 0) {
      currentSection.content.push(rawLine);
    }
  }
  if (currentSection) sections.push(currentSection);

  return sections;
}

/**
 * 解析 Markdown 列表项（去掉 "- " 前缀）。
 *
 * @param {string} line - 原始行文本
 * @returns {string} 去掉前缀后的纯文本
 */
function parseListItem(line) {
  return line.replace(/^-\s*/, "").trim();
}

/**
 * 去除文本中的 Markdown 加粗标记 **...**。
 *
 * @param {string} text - 可能包含加粗标记的文本
 * @returns {string} 去除标记后的纯文本
 */
function stripBold(text) {
  return text.replace(/\*\*(.+?)\*\*/g, "$1");
}

// =============================================================================
// 数据提取器
// =============================================================================

/**
 * 从解析后的 sections 中提取头部信息（姓名、联系方式、求职意向等）。
 *
 * @param {Array} sections - parseMarkdown 返回的 section 数组
 * @returns {{name, gender, phone, email, experience, intent, salary, city}}
 */
function extractHeader(sections) {
  const headerSection = sections.find((s) => s.type === "header");
  const name = headerSection ? headerSection.name : "曹书良";

  // 第一个包含 "男"、"|"、"@" 的 ## 段为联系方式段
  const contactSection = sections.find(
    (s) =>
      s.type === "section" &&
      s.name.includes("男") &&
      s.name.includes("|") &&
      s.name.includes("@"),
  );

  // 包含 "工作经验" 或 "求职意向" 的 ## 段为求职意向段
  const intentSection = sections.find(
    (s) =>
      s.type === "section" &&
      (s.name.includes("工作经验") || s.name.includes("求职意向")),
  );

  let phone = "",
    email = "",
    gender = "男";

  if (contactSection) {
    const nameLine = contactSection.name;
    const parts = nameLine.split("|").map((s) => s.trim());
    for (const part of parts) {
      if (part.includes("男")) gender = "男";
      const phoneMatch = part.match(/(\d{11})/);
      if (phoneMatch) phone = phoneMatch[1];
      const emailMatch = part.match(/([\w.-]+@[\w.-]+\.\w+)/);
      if (emailMatch) email = emailMatch[1];
    }
  }

  let experience = "",
    intent = "",
    salary = "",
    city = "";

  if (intentSection) {
    const nameLine = intentSection.name;
    const expMatch = nameLine.match(/(\d+)年/);
    if (expMatch) experience = expMatch[1];
    const salaryMatch = nameLine.match(/(\d+[Kk]-?\d*[Kk]?)/);
    if (salaryMatch) salary = salaryMatch[1];
    const cityMatch = nameLine.match(/期望城市[：:]\s*(\S+)/);
    if (cityMatch) city = cityMatch[1];
    const intentMatch = nameLine.match(/求职意向[：:]\s*([^\s|]+)/);
    if (intentMatch) intent = intentMatch[1];
  }

  return { name, gender, phone, email, experience, intent, salary, city };
}

/**
 * 从 sections 中提取个人优势信息（仅列表项，不再渲染技能标签）。
 *
 * @param {Array} sections - section 数组
 * @returns {{items: string[]}}
 */
function extractPersonalAdvantages(sections) {
  const section = sections.find(
    (s) => s.type === "section" && s.name.includes("个人优势"),
  );
  if (!section) return { items: [] };

  const items = [];
  for (const line of section.content) {
    const t = line.trim();
    if (t.startsWith("- ")) {
      items.push(parseListItem(t));
    }
  }

  return { items };
}

/**
 * 从 sections 中提取工作经历信息。
 *
 * @param {Array} sections - section 数组
 * @returns {Array<{title, company, role, date, duties: string[], achievements: string[]}>}
 */
function extractWorkExperience(sections) {
  const items = [];
  let inWork = false;

  for (const section of sections) {
    // 定位到 "工作经历" 段
    if (section.type === "section" && section.name.includes("工作经历")) {
      inWork = true;
      continue;
    }
    // 遇到下一个同级 section 则退出
    if (
      inWork &&
      section.type === "section" &&
      !section.name.includes("工作经历")
    ) {
      break;
    }
    if (!inWork || section.type !== "subsection") continue;

    const titleLine = section.name;

    // 提取日期：如 （2022.11-2025.12）
    const dateMatch = titleLine.match(
      /[（(](\d{4}\.\d{1,2}\s*-\s*\d{4}\.\d{1,2})[）)]/,
    );
    const dateStr = dateMatch ? dateMatch[1] : "";

    // 清理标题：去掉日期部分
    const cleanTitle = titleLine
      .replace(/[（(]\d{4}\.\d{1,2}\s*-\s*\d{4}\.\d{1,2}[）)]/, "")
      .trim();
    const companyMatch = cleanTitle.match(/^(.+?)\s*[–—]\s*(.+)$/);
    const company = companyMatch ? companyMatch[1].trim() : cleanTitle;
    const role = companyMatch ? companyMatch[2].trim() : "";

    // 解析内容块：**工作职责** 和 **工作业绩** 下的列表项
    const duties = [];
    const achievements = [];
    let currentCategory = null;

    for (const rawLine of section.content) {
      const t = rawLine.trim();
      // 剥离行首列表/引用前缀，便于识别形如 "- **工作职责**" 的小节标题
      const stripped = t.replace(/^[->]\s*/, "");
      const strippedDecoded = stripBold(stripped);

      if (
        stripped.startsWith("**工作职责**") ||
        strippedDecoded.startsWith("工作职责")
      ) {
        currentCategory = "duties";
        continue;
      }
      if (
        stripped.startsWith("**工作业绩**") ||
        strippedDecoded.startsWith("工作业绩")
      ) {
        currentCategory = "achievements";
        continue;
      }

      if (t.startsWith("- ") && currentCategory === "duties") {
        duties.push(stripBold(parseListItem(t)));
      } else if (t.startsWith("- ") && currentCategory === "achievements") {
        achievements.push(stripBold(parseListItem(t)));
      }
    }

    items.push({
      title: cleanTitle,
      company,
      role,
      date: dateStr,
      duties,
      achievements,
    });
  }

  return items;
}

/**
 * 从 sections 中提取项目经验信息。
 *
 * @param {Array} sections - section 数组
 * @returns {Array<{title, date, bg, techs: string[], duties: string[], achievements: string[], others: string[]}>}
 */
function extractProjects(sections) {
  const items = [];
  let inProjects = false;

  for (const section of sections) {
    // 定位到 "项目经验" 段
    if (section.type === "section" && section.name.includes("项目经验")) {
      inProjects = true;
      continue;
    }
    // 遇到下一个同级 section 则退出
    if (
      inProjects &&
      section.type === "section" &&
      !section.name.includes("项目经验")
    ) {
      break;
    }
    if (!inProjects || section.type !== "subsection") continue;

    const titleLine = section.name;
    const content = section.content;

    // 提取日期：支持 "| 2022.12-2025.10" 或 "（2022.12-2025.10）" 格式
    let dateStr = "";
    const pipeDateMatch = titleLine.match(
      /\|\s*(\d{4}\.\d{1,2}\s*-\s*\d{4}\.\d{1,2})/,
    );
    const parenDateMatch = titleLine.match(
      /[（(](\d{4}\.\d{1,2}\s*-\s*\d{4}\.\d{1,2})[）)]/,
    );
    if (pipeDateMatch) dateStr = pipeDateMatch[1];
    else if (parenDateMatch) dateStr = parenDateMatch[1];

    // 清理标题：去掉日期部分
    const cleanTitle = titleLine
      .replace(/\s*\|\s*\d{4}\.\d{1,2}\s*-\s*\d{4}\.\d{1,2}/, "")
      .replace(/[（(]\d{4}\.\d{1,2}\s*-\s*\d{4}\.\d{1,2}[）)]/, "")
      .trim();

    // 项目数据容器
    const blocks = {
      bg: [],
      tech: null,
      duties: [],
      achievements: [],
      others: [],
    };

    let currentBlock = null;

    // 已知的小节关键字，仅当加粗标题命中以下关键字之一时才切换 currentBlock
    const SECTION_KEYWORDS = [
      { key: "业务背景", block: "bg" },
      { key: "背景", block: "bg" },
      { key: "技术栈", block: "tech" },
      { key: "技术选型", block: "tech" },
      { key: "技术挑战", block: "duties" },
      { key: "技术方案", block: "duties" },
      { key: "我的职责", block: "duties" },
      { key: "职责", block: "duties" },
      { key: "项目成果", block: "achievements" },
      { key: "成果", block: "achievements" },
    ];

    /**
     * 检测加粗标题，允许行首存在 "- " 或 "> " 前缀。
     * @param {string} line - 原始行文本（已 trim）
     * @returns {{headerText: string, after: string} | null}
     */
    function matchSectionHeader(line) {
      // 允许行首前缀：可选的 - 或 >，以及空白
      const m = line.match(/^(?:[->]\s*)?\*\*([^*]+?)\*\*(.*)$/);
      if (!m) return null;
      const headerText = m[1].trim();
      // 仅当命中已知关键字时才视为小节标题
      const hit = SECTION_KEYWORDS.find((s) => headerText.startsWith(s.key));
      if (!hit) return null;
      const after = m[2]
        .replace(/^[：:]\s*/, "")
        .replace(/^[（(]\s*/, "")
        .trim();
      return { block: hit.block, after };
    }

    for (const rawLine of content) {
      const t = rawLine.trim();
      const decoded = stripBold(t);

      // 检测加粗小节标题（支持 "- **xxx**:..." / "> **xxx**：..." / "**xxx**:..."）
      const section = matchSectionHeader(t);
      if (section) {
        currentBlock = section.block;
        if (section.after) {
          if (section.block === "bg") blocks.bg.push(section.after);
          else if (section.block === "tech") blocks.tech = section.after;
          else if (section.block === "duties")
            blocks.duties.push(section.after);
          else if (section.block === "achievements")
            blocks.achievements.push(section.after);
        }
        continue;
      }

      // 空行跳过
      if (!t) continue;

      // 列表项（包括带加粗前缀的子项，如 "- **微前端架构**：xxx"）
      if (t.startsWith("- ")) {
        const item = parseListItem(t);
        const itemClean = stripBold(item);
        if (currentBlock === "duties") blocks.duties.push(itemClean);
        else if (currentBlock === "achievements")
          blocks.achievements.push(itemClean);
        else if (currentBlock === "bg") blocks.bg.push(itemClean);
        else if (currentBlock === "others") blocks.others.push(itemClean);
        continue;
      }

      // 引用块文本行（"> xxx"），归入背景或当前块
      if (t.startsWith("> ")) {
        const quoted = stripBold(t.replace(/^>\s*/, "")).trim();
        if (!quoted) continue;
        if (currentBlock === "bg" || currentBlock == null) {
          // 默认引用块文本视为业务背景
          if (currentBlock == null) currentBlock = "bg";
          blocks.bg.push(quoted);
        } else if (currentBlock === "tech") {
          blocks.tech = blocks.tech ? blocks.tech + " " + quoted : quoted;
        } else if (currentBlock === "achievements") {
          blocks.achievements.push(quoted);
        } else if (currentBlock === "duties") {
          blocks.duties.push(quoted);
        } else {
          blocks.others.push(quoted);
        }
        continue;
      }

      // 纯文本行（当前块的延续）
      if (currentBlock === "bg") {
        blocks.bg.push(decoded);
      } else if (currentBlock === "tech") {
        blocks.tech = blocks.tech ? blocks.tech + " " + decoded : decoded;
      } else if (currentBlock === "achievements") {
        blocks.achievements.push(decoded);
      } else if (currentBlock === "duties") {
        blocks.duties.push(decoded);
      } else {
        blocks.others.push(decoded);
      }
    }

    // 将技术栈字符串拆分为数组
    const techs = blocks.tech
      ? blocks.tech
          .split(/[+、,，]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    // 背景文本（合并多行）
    const bgText = blocks.bg.join(" ").trim();

    items.push({
      title: cleanTitle,
      date: dateStr,
      bg: bgText,
      techs,
      duties: blocks.duties,
      achievements: blocks.achievements,
      others: blocks.others.filter((s) => !s.startsWith("---")),
    });
  }

  return items;
}

/**
 * 从 sections 中提取教育经历信息。
 *
 * @param {Array} sections - section 数组
 * @returns {{school, degree, major, date}}
 */
function extractEducation(sections) {
  const section = sections.find(
    (s) => s.type === "section" && s.name.includes("教育经历"),
  );
  if (!section) return { school: "", degree: "", major: "", date: "" };

  const line = section.content.map((l) => l.trim()).filter(Boolean)[0] || "";
  const parts = line.split(/[–—]/).map((s) => s.trim());

  const school = parts[0] || "";
  const degree = parts[1] || "";

  // 专业：从最后一部分中提取（去掉日期）
  let major = "";
  const majorMatch = line.match(/(.+?专业)/);
  if (majorMatch) {
    major = majorMatch[1].trim();
  } else if (parts[2]) {
    major = parts[2].replace(/[（(]\d{4}-\d{4}[）)]/, "").trim();
  }

  const dateMatch = line.match(/(\d{4}-\d{4})/);
  const date = dateMatch ? dateMatch[1] : "";

  return { school, degree, major, date };
}

// =============================================================================
// 结构哈希计算
// =============================================================================

/**
 * 从解析后的 sections 中提取"结构特征"，用于判断文档结构是否变化。
 *
 * 结构特征包括：
 *   - 各 section 的 type 和 name
 *   - 工作经历的数量、公司名、职位、日期
 *   - 项目经验的数量、标题、日期
 *   - 个人优势的列表项数量
 *
 * @param {Array} sections - parseMarkdown 返回的 section 数组
 * @returns {string} SHA-256 哈希值（十六进制）
 */
function computeStructureHash(sections) {
  // 提取结构特征对象
  const structure = {
    // 所有 section 的类型和名称（用于检测段落增删）
    sectionOutline: sections.map((s) => ({ type: s.type, name: s.name })),

    // 工作经历的关键字段
    workExperience: extractWorkExperience(sections).map((exp) => ({
      company: exp.company,
      role: exp.role,
      date: exp.date,
      dutyCount: exp.duties.length,
      achievementCount: exp.achievements.length,
    })),

    // 项目经验的关键字段
    projects: extractProjects(sections).map((proj) => ({
      title: proj.title,
      date: proj.date,
      techCount: proj.techs.length,
      dutyCount: proj.duties.length,
      achievementCount: proj.achievements.length,
    })),

    // 个人优势列表项数量
    advantageCount: extractPersonalAdvantages(sections).items.length,
  };

  // 计算 SHA-256 哈希
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify(structure));
  return hash.digest("hex");
}

// =============================================================================
// 缓存管理
// =============================================================================

/**
 * 读取缓存文件中的结构哈希值。
 *
 * @returns {string|null} 缓存的结构哈希，如果文件不存在或解析失败则返回 null
 */
function readCachedHash() {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      const data = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
      return data.structureHash || null;
    }
  } catch {
    // 缓存文件损坏时忽略
  }
  return null;
}

/**
 * 将当前的结构哈希写入缓存文件。
 *
 * @param {string} hash - 当前的结构哈希值
 */
function writeCache(hash) {
  const cache = {
    structureHash: hash,
    lastSynced: new Date().toISOString(),
  };
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8");
}

// =============================================================================
// HTML 更新器（基于 data-md-slot 属性更新内容，不改变结构）
// =============================================================================

/**
 * 通过 data-md-slot 属性更新 HTML 中的文本内容。
 * 此函数不会改变 HTML 的 DOM 结构，仅更新已有元素的文本。
 *
 * @param {cheerio.CheerioAPI} $ - cheerio 实例
 * @param {string} slot - data-md-slot 的属性值
 * @param {string} value - 要设置的新文本
 */
function updateText($, slot, value) {
  const el = $(`[data-md-slot="${slot}"]`);
  if (el.length > 0) {
    el.text(value);
  }
}

/**
 * 使用 cheerio 更新 HTML 内容（仅更新文本，不改变 DOM 结构）。
 * 适用于文档结构未变化时的快速同步。
 *
 * @param {string} html - 原始 HTML 字符串
 * @param {Array} sections - 解析后的 section 数组
 * @returns {string} 更新后的 HTML 字符串
 */
function updateHtml(html, sections) {
  const $ = cheerio.load(html);
  const headerData = extractHeader(sections);
  const personalAdvantages = extractPersonalAdvantages(sections);
  const workExperience = extractWorkExperience(sections);
  const projects = extractProjects(sections);
  const education = extractEducation(sections);

  // --- 头部信息 ---
  updateText($, "name", headerData.name);
  updateText($, "subtitle", "前端开发工程师");
  updateText($, "gender", headerData.gender);
  updateText($, "phone", headerData.phone);
  updateText($, "email", headerData.email);
  updateText($, "experience", headerData.experience + "年经验");
  updateText($, "intent", headerData.intent || "前端开发工程师");
  updateText($, "salary", headerData.salary);
  updateText($, "city", headerData.city);
  updateText($, "footer-name", headerData.name);
  updateText($, "footer-email", headerData.email);

  // --- 个人优势 ---
  const advantageItems = personalAdvantages.items;
  for (let i = 0; i < advantageItems.length; i++) {
    updateText($, `advantage-${i}`, advantageItems[i]);
  }
  // 如果 markdown 中的项比 HTML 少，清空多余的
  const allAdvantageEls = $('[data-md-slot^="advantage-"]');
  allAdvantageEls.each((_, el) => {
    const slot = $(el).attr("data-md-slot");
    const idx = parseInt(slot.replace("advantage-", ""), 10);
    if (idx >= advantageItems.length) {
      $(el).text("");
    }
  });

  // --- 工作经历 ---
  for (let expIdx = 0; expIdx < workExperience.length; expIdx++) {
    const exp = workExperience[expIdx];
    updateText($, `exp-${expIdx}-company`, exp.company);
    updateText($, `exp-${expIdx}-role`, exp.role);
    updateText($, `exp-${expIdx}-date`, exp.date);

    for (let d = 0; d < exp.duties.length; d++) {
      updateText($, `exp-${expIdx}-duty-${d}`, exp.duties[d]);
    }

    for (let a = 0; a < exp.achievements.length; a++) {
      updateText($, `exp-${expIdx}-achievement-${a}`, exp.achievements[a]);
    }
  }

  // --- 项目经验 ---
  for (let projIdx = 0; projIdx < projects.length; projIdx++) {
    const proj = projects[projIdx];
    updateText($, `proj-${projIdx}-name`, proj.title);
    updateText($, `proj-${projIdx}-date`, proj.date);

    if (proj.bg) {
      updateText($, `proj-${projIdx}-bg`, "背景：" + proj.bg);
    }

    for (let t = 0; t < proj.techs.length; t++) {
      updateText($, `proj-${projIdx}-tech-${t}`, proj.techs[t]);
    }

    for (let d = 0; d < proj.duties.length; d++) {
      updateText($, `proj-${projIdx}-duty-${d}`, proj.duties[d]);
    }

    for (let a = 0; a < proj.achievements.length; a++) {
      updateText($, `proj-${projIdx}-achievement-${a}`, proj.achievements[a]);
    }
  }

  // --- 教育经历 ---
  updateText($, "edu-school", education.school);
  updateText($, "edu-degree", education.degree);
  updateText($, "edu-major", education.major);
  updateText($, "edu-date", education.date);

  return $.html();
}

// =============================================================================
// HTML 重建器（根据 markdown 数据完整生成 HTML）
// =============================================================================

/**
 * 从现有 HTML 中提取 <style> 内容。
 * 用于 rebuild 时保留样式和页面框架。
 *
 * @param {string} html - 原始 HTML 字符串
 * @returns {{styles: string}} 提取的样式
 */
function extractTemplate(html) {
  const $ = cheerio.load(html);

  // 提取所有 <style> 内容
  const styles = [];
  $("style").each((_, el) => {
    styles.push($(el).html());
  });

  return {
    styles: styles.join("\n"),
  };
}

/**
 * 根据 markdown 数据完整重建 HTML 文件。
 * 当文档结构发生变化时（如新增/删除工作经历或项目），调用此函数。
 *
 * @param {Array} sections - 解析后的 section 数组
 * @param {string} existingHtml - 现有的 HTML 内容（用于提取样式）
 * @returns {string} 完整生成的 HTML 字符串
 */
function rebuildHtml(sections, existingHtml) {
  const headerData = extractHeader(sections);
  const personalAdvantages = extractPersonalAdvantages(sections);
  const workExperience = extractWorkExperience(sections);
  const projects = extractProjects(sections);
  const education = extractEducation(sections);

  // 从现有 HTML 中提取样式
  const { styles } = extractTemplate(existingHtml);

  // 构建 HTML 各部分
  const headerHtml = buildHeaderHtml(headerData);
  const advantagesHtml = buildAdvantagesHtml(personalAdvantages);
  const workHtml = buildWorkHtml(workExperience);
  const projectsHtml = buildProjectsHtml(projects);
  const educationHtml = buildEducationHtml(education);
  const footerHtml = buildFooterHtml(headerData);

  return `<!DOCTYPE html><html lang="zh-CN"><head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${headerData.name} - 前端开发工程师</title>
    <link rel="stylesheet" href="https://unpkg.com/terminal.css@0.7.4/dist/terminal.min.css">
    <style>
        ${styles}
    </style>
</head>

<body>
    <div class="terminal">
        <div class="container">

            ${headerHtml}

            <div class="terminal-card">
                <div class="header">
                    <span class="prompt">$</span> cat ~/个人优势.md
                </div>
                <div class="content">
                    ${advantagesHtml}
                </div>
            </div>

            <div class="terminal-card">
                <div class="header">
                    <span class="prompt">$</span> ls -la /工作经历/
                </div>
                <div class="content">
                    ${workHtml}
                </div>
            </div>

            <div class="terminal-card">
                <div class="header">
                    <span class="prompt">$</span> ./projects --list
                </div>
                <div class="content">
                    ${projectsHtml}
                </div>
            </div>

            <div class="terminal-card">
                <div class="header">
                    <span class="prompt">$</span> cat /教育经历
                </div>
                <div class="content">
                    ${educationHtml}
                </div>
            </div>

            ${footerHtml}
        </div>
    </div>

</body></html>`;
}

/**
 * 构建头部 HTML。
 *
 * @param {Object} data - extractHeader 返回的数据
 * @returns {string} HTML 字符串
 */
function buildHeaderHtml(data) {
  return `
            <div class="header-section">
                <h1>
                    <div class="typing-wrapper"><span class="typing-line" data-md-slot="name">${data.name}</span></div>
                </h1>
                <div class="subtitle" data-md-slot="subtitle">前端开发工程师</div>
                <div class="contact-info">
                    <span><span class="label">[性别]</span> <span data-md-slot="gender">${data.gender}</span></span>
                    <span><span class="label">[电话]</span> <span data-md-slot="phone">${data.phone}</span></span>
                    <span><span class="label">[邮箱]</span> <span data-md-slot="email">${data.email}</span></span>
                </div>
                <div class="job-intent">
                    <span class="tag" data-md-slot="experience">${data.experience}年经验</span>
                    <span class="tag" data-md-slot="intent">${data.intent || "前端开发工程师"}</span>
                    <span class="tag" data-md-slot="salary">${data.salary}</span>
                    <span class="tag" data-md-slot="city">${data.city}</span>
                </div>
            </div>`;
}

/**
 * 构建个人优势 HTML。
 *
 * @param {Object} data - extractPersonalAdvantages 返回的数据
 * @returns {string} HTML 字符串
 */
function buildAdvantagesHtml(data) {
  let html = `<div class="item-desc">
                        <ul>`;

  data.items.forEach((item, i) => {
    html += `\n                            <li data-md-slot="advantage-${i}">${item}</li>`;
  });

  html += `
                        </ul>
                    </div>`;

  return html;
}

/**
 * 构建工作经历 HTML。
 *
 * @param {Array} items - extractWorkExperience 返回的数组
 * @returns {string} HTML 字符串
 */
function buildWorkHtml(items) {
  let html = "";

  items.forEach((exp, expIdx) => {
    html += `
                    <div class="experience-item">
                        <div class="item-title">
                            <span class="company" data-md-slot="exp-${expIdx}-company">${exp.company}</span>
                            <span class="item-meta">
                                <span data-md-slot="exp-${expIdx}-role">${exp.role}</span> | <span class="date" data-md-slot="exp-${expIdx}-date">${exp.date}</span>
                            </span>
                        </div>

                        <div class="block-label">工作职责</div>
                        <div class="item-desc">
                            <ul>`;

    exp.duties.forEach((duty, d) => {
      html += `\n                                <li data-md-slot="exp-${expIdx}-duty-${d}">${duty}</li>`;
    });

    html += `
                            </ul>
                        </div>

                        <div class="block-label">工作业绩</div>
                        <div class="item-desc">
                            <ul>`;

    exp.achievements.forEach((achievement, a) => {
      html += `\n                                <li data-md-slot="exp-${expIdx}-achievement-${a}">${achievement}</li>`;
    });

    html += `
                            </ul>
                        </div>
                    </div>`;
  });

  return html;
}

/**
 * 构建项目经验 HTML。
 *
 * @param {Array} items - extractProjects 返回的数组
 * @returns {string} HTML 字符串
 */
function buildProjectsHtml(items) {
  let html = "";

  items.forEach((proj, projIdx) => {
    html += `
                    <div class="project-item">
                        <div class="item-title">
                            <span class="project-name" data-md-slot="proj-${projIdx}-name">${proj.title}</span>
                            <span class="item-meta">
                                <span class="date" data-md-slot="proj-${projIdx}-date">${proj.date}</span>
                            </span>
                        </div>`;

    if (proj.bg) {
      html += `
                        <div class="project-bg" data-md-slot="proj-${projIdx}-bg">
                            背景：${proj.bg}
                        </div>`;
    }

    if (proj.duties.length > 0) {
      html += `
                        <div class="block-label">技术方案 / 职责</div>
                        <div class="item-desc">
                            <ul>`;

      proj.duties.forEach((duty, d) => {
        html += `\n                                <li data-md-slot="proj-${projIdx}-duty-${d}">${duty}</li>`;
      });

      html += `
                            </ul>
                        </div>`;
    }

    if (proj.achievements.length > 0) {
      html += `
                        <div class="block-label">项目成果</div>
                        <div class="item-desc">
                            <ul>`;

      proj.achievements.forEach((achievement, a) => {
        html += `\n                                <li data-md-slot="proj-${projIdx}-achievement-${a}">${achievement}</li>`;
      });

      html += `
                            </ul>
                        </div>`;
    }

    // 技术栈：渲染在项目卡片最底部，使用与个人优势一致的 .tag 样式（去除标题，仅保留标签）
    if (proj.techs.length > 0) {
      html += `
                        <div class="project-tech">`;

      proj.techs.forEach((tech, t) => {
        const highlight = [
          "Vue",
          "React",
          "TypeScript",
          "Node.js",
          "JavaScript",
        ].includes(tech)
          ? " highlight"
          : "";
        html += `\n                            <span class="tag${highlight}" data-md-slot="proj-${projIdx}-tech-${t}">${tech}</span>`;
      });

      html += `
                        </div>`;
    }

    html += `
                    </div>`;
  });

  return html;
}

/**
 * 构建教育经历 HTML。
 *
 * @param {Object} data - extractEducation 返回的数据
 * @returns {string} HTML 字符串
 */
function buildEducationHtml(data) {
  return `
                    <div class="education-item">
                        <span class="school" data-md-slot="edu-school">${data.school}</span>
                        <span class="meta">
                            <span data-md-slot="edu-degree">${data.degree}</span> ·
                            <span data-md-slot="edu-major">${data.major}</span> ·
                            <span class="date" data-md-slot="edu-date">${data.date}</span>
                        </span>
                    </div>`;
}

/**
 * 构建页脚 HTML。
 *
 * @param {Object} data - extractHeader 返回的数据
 * @returns {string} HTML 字符串
 */
function buildFooterHtml(data) {
  return `
            <div class="footer">
                <span class="cursor-blink">_</span>
                <span data-md-slot="footer-name">${data.name}</span> · 前端开发工程师 ·
                <span data-md-slot="footer-email">${data.email}</span>
                <span class="cursor-blink">_</span>
            </div>`;
}

// =============================================================================
// 主逻辑
// =============================================================================

/**
 * 执行同步操作。
 *
 * 流程：
 *   1. 读取并解析 Markdown 文件
 *   2. 计算结构哈希
 *   3. 与缓存对比：
 *      - 哈希一致 → 仅更新内容（updateHtml）
 *      - 哈希不同 → 完整重建（rebuildHtml）
 *   4. 写入 HTML 文件
 *   5. 更新缓存
 *
 * @param {boolean} [forceRebuild=false] - 是否强制重建（忽略缓存）
 * @returns {boolean} 是否成功
 */
function sync(forceRebuild) {
  try {
    if (!fs.existsSync(MD_PATH)) {
      console.error(`[sync] 错误：Markdown 文件不存在 ${MD_PATH}`);
      process.exit(1);
    }

    if (!fs.existsSync(HTML_PATH)) {
      console.error(`[sync] 错误：HTML 模板不存在 ${HTML_PATH}`);
      process.exit(1);
    }

    const md = fs.readFileSync(MD_PATH, "utf-8");
    const html = fs.readFileSync(HTML_PATH, "utf-8");

    const sections = parseMarkdown(md);
    const currentHash = computeStructureHash(sections);
    const cachedHash = readCachedHash();

    // 判断是否需要重建：强制重建 或 哈希不一致（结构变化）
    const needsRebuild = forceRebuild || currentHash !== cachedHash;

    let updatedHtml;
    if (needsRebuild) {
      console.log(`[sync] 检测到结构变化，执行完整重建...`);
      updatedHtml = rebuildHtml(sections, html);
    } else {
      console.log(`[sync] 结构未变化，仅同步内容...`);
      updatedHtml = updateHtml(html, sections);
    }

    fs.writeFileSync(HTML_PATH, updatedHtml, "utf-8");
    writeCache(currentHash);
    console.log(`[sync] ✓ 已同步到 ${HTML_PATH}`);
    return true;
  } catch (err) {
    console.error(`[sync] ✗ 错误：${err.message}`);
    console.error(err.stack);
    return false;
  }
}

// =============================================================================
// 命令行入口
// =============================================================================

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
  md-to-html 同步工具

  用法：
    node sync.js              单次同步（自动检测结构变化）
    node sync.js --watch      监听模式（文件变化时自动同步）
    node sync.js --rebuild    强制完整重建 HTML
    node sync.js --help       显示帮助信息

  监听文件：${MD_PATH}
  输出文件：${HTML_PATH}
  缓存文件：${CACHE_PATH}
  `);
  process.exit(0);
}

if (args.includes("--rebuild") || args.includes("-r")) {
  console.log(`[sync] 强制重建模式...`);
  sync(true);
} else if (args.includes("--watch") || args.includes("-w")) {
  console.log(`[sync] 监听模式：正在监听 ${MD_PATH}...`);
  sync(false);
  fs.watch(MD_PATH, (eventType) => {
    if (eventType === "change") {
      console.log(`[sync] 文件已变更，重新同步...`);
      sync(false);
    }
  });
} else {
  sync(false);
}
