/**
 * 扩充语言类知识点：雅思4门 + 托福3门，各补 4 条（i5~i8）
 * 运行：node _test/expand-lang.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DATA_FILE = path.join(__dirname, '..', 'miniprogram', 'data', 'courses.js');
const d = require(DATA_FILE);

const ADD = [
  // ===== 雅思听力 ielts_listening =====
  {
    id: 'ielts_listening_i5', courseId: 'ielts_listening', chapterId: 'ielts_listening_ch0', type: 'lecture',
    title: '配对题：先读选项预判改写',
    enTitle: 'Matching: Predict Paraphrases',
    body: '听力配对题选项中常有同义改写，录音里不会原词出现。做题前先把选项读一遍，预测每个选项可能被怎么改写。例如选项 "long opening hours" 可能在录音中说成 "open until midnight"。',
    enBody: 'Matching options are often paraphrased and never appear verbatim. Read the options first and predict how each might be reworded. For example, "long opening hours" may be said as "open until midnight".',
    quiz: { question: '配对题录音中的答案通常以什么形式出现？', options: ['与选项原词相同', '选项的同义改写', '更长的句子', '与题干重复'], answerIndex: 1, explanation: '配对题答案常以同义改写出现，需预判改写形式。' }
  },
  {
    id: 'ielts_listening_i6', courseId: 'ielts_listening', chapterId: 'ielts_listening_ch0', type: 'lecture',
    title: '数字与字母听写',
    enTitle: 'Numbers and Letters',
    body: '电话号码、门牌、邮编的听写高频出现。注意易混音：13 与 30（thirteen/thirty）、14 与 40。字母常按"单词拼读"给出（如 A for Apple）。听到连读的数字要先默念再写。',
    enBody: 'Phone numbers, addresses, and postcodes are common. Beware of confusable sounds: 13 vs 30, 14 vs 40. Letters are often given by spelling words (A for Apple). Repeat tricky digits mentally before writing.',
    quiz: { question: '13 和 30 易混，主要靠什么区分？', options: ['元音长短', '重音位置', '语境', '以上都是'], answerIndex: 3, explanation: 'thirteen 重音在后、30 thirty 重音在前，结合语境综合判断。' }
  },
  {
    id: 'ielts_listening_i7', courseId: 'ielts_listening', chapterId: 'ielts_listening_ch0', type: 'lecture',
    title: '否定词陷阱',
    enTitle: 'Negation Traps',
    body: '听力中先肯定后否定是常见陷阱："I\'d love to go, but I can\'t." 答案常是 but 之后的内容。注意 hardly、rarely、seldom 等隐性否定词，以及 would rather not、instead of 这类表达。',
    enBody: 'A common trap is first agreeing then contradicting: "I\'d love to go, but I can\'t." The answer is what follows "but". Watch hidden negatives like hardly, rarely, seldom, and phrases like would rather not.',
    quiz: { question: '"I\'d love to go, but I\'m busy" 中说话人的态度是？', options: ['想去', '不想去', '不确定', '无所谓'], answerIndex: 1, explanation: 'but 之后才是真实态度，实际是不去。' }
  },
  {
    id: 'ielts_listening_i8', courseId: 'ielts_listening', chapterId: 'ielts_listening_ch0', type: 'lecture',
    title: '答案词性核对',
    enTitle: 'Answer Word Form Check',
    body: '填空答案必须与题干语法匹配。如果题干是 "a ___ of water"，答案应是名词（如 glass）。写完答案快速回读，检查单复数、时态、词性是否通顺，这是最后一道保险。',
    enBody: 'Blank answers must match the grammar of the question. If the prompt reads "a ___ of water", the answer must be a noun (e.g. glass). After writing, re-read to check number, tense, and word form.',
    quiz: { question: '"a ___ of water" 的空格应填什么词性？', options: ['动词', '名词', '形容词', '副词'], answerIndex: 1, explanation: '"a ... of" 结构中间需要名词，如 a glass of water。' }
  },

  // ===== 雅思口语 ielts_speaking =====
  {
    id: 'ielts_speaking_i5', courseId: 'ielts_speaking', chapterId: 'ielts_speaking_ch0', type: 'lecture',
    title: '拓展回答的 AREA 法',
    enTitle: 'The AREA Method',
    body: '回答简短时用 AREA 法拓展：Answer（直接回答）→ Reason（给原因）→ Example（举例子）→ Alternative（换个角度补充）。这能让每个回答都充实到 15 秒以上，避免冷场。',
    enBody: 'Use AREA to expand short answers: Answer directly → Reason → Example → Alternative angle. This fills every response to over 15 seconds and avoids dead air.',
    quiz: { question: 'AREA 法中 E 代表什么？', options: ['Explanation', 'Example', 'English', 'Emotion'], answerIndex: 1, explanation: 'AREA = Answer, Reason, Example, Alternative。' }
  },
  {
    id: 'ielts_speaking_i6', courseId: 'ielts_speaking', chapterId: 'ielts_speaking_ch0', type: 'lecture',
    title: 'Part 2 时间分配',
    enTitle: 'Part 2 Time Management',
    body: 'Part 2 要说满 2 分钟。建议结构：开头 20 秒介绍主题，中间 80 秒讲细节（who/what/where），结尾 20 秒总结感受。练习时用秒表，养成"说满不超时"的节奏感。',
    enBody: 'Part 2 needs a full 2 minutes. Structure: 20s intro, 80s of details (who/what/where), 20s closing feelings. Practise with a stopwatch to build a steady pace.',
    quiz: { question: 'Part 2 要求的时长是？', options: ['1 分钟', '1-2 分钟', '2 分钟', '3 分钟'], answerIndex: 2, explanation: 'Part 2 需要连续说 1-2 分钟，目标应说满 2 分钟。' }
  },
  {
    id: 'ielts_speaking_i7', courseId: 'ielts_speaking', chapterId: 'ielts_speaking_ch0', type: 'lecture',
    title: '争取思考时间的表达',
    enTitle: 'Buying Thinking Time',
    body: '遇到难题不要说 "I don\'t know" 就停。用 "That\'s a good question..."、"Let me think..."、"Well, I\'ve never thought about that, but..." 争取 2-3 秒组织语言，同时展示自然交流能力。',
    enBody: 'Never just say "I don\'t know" and stop. Use "That\'s a good question...", "Let me think...", "Well, I\'ve never thought about that, but..." to buy 2-3 seconds and show natural communication.',
    quiz: { question: '遇到难题时最好的做法是？', options: ['直接说不会', '沉默思考', '用过渡表达争取时间', '要求换题'], answerIndex: 2, explanation: '用自然过渡表达争取思考时间，既得体又能组织语言。' }
  },
  {
    id: 'ielts_speaking_i8', courseId: 'ielts_speaking', chapterId: 'ielts_speaking_ch0', type: 'lecture',
    title: '发音清晰度优先',
    enTitle: 'Clear Pronunciation First',
    body: '发音评分看清晰度和可理解度，不是口音。宁可说慢一点，把重音和句子节奏说清楚。注意常见发音难点：th 音、长短元音（ship/sheep）、词尾辅音不要吞掉。',
    enBody: 'Pronunciation is scored on clarity and intelligibility, not accent. Slow down and stress key words. Watch common difficulties: the th sound, long vs short vowels (ship/sheep), and final consonants.',
    quiz: { question: '发音评分主要看？', options: ['是否有英音', '清晰度和可理解度', '语速快', '词汇量'], answerIndex: 1, explanation: '评分关注清晰可懂，口音不影响。' }
  },

  // ===== 雅思阅读 ielts_reading =====
  {
    id: 'ielts_reading_i5', courseId: 'ielts_reading', chapterId: 'ielts_reading_ch0', type: 'lecture',
    title: '定位词选择技巧',
    enTitle: 'Choosing Keywords',
    body: '回文定位时选"难被改写"的词：专有名词、数字、年份、大写词。普通动词和形容词容易被同义替换，不宜作定位词。一次只带 2-3 个关键词，太多反而干扰。',
    enBody: 'Choose keywords that resist paraphrasing: proper nouns, numbers, years, capitalized words. Ordinary verbs and adjectives are easily reworded. Take only 2-3 keywords at a time.',
    quiz: { question: '最适合做定位词的是？', options: ['动词', '形容词', '专有名词和数字', '连接词'], answerIndex: 2, explanation: '专有名词和数字难被改写，定位最稳。' }
  },
  {
    id: 'ielts_reading_i6', courseId: 'ielts_reading', chapterId: 'ielts_reading_ch0', type: 'lecture',
    title: '主旨题：概括 vs 细节',
    enTitle: 'Main Idea vs Detail',
    body: '主旨题选"概括性"答案，排除"只覆盖部分"或"过于宽泛"的选项。干扰项常是文中的某个细节。判断标准：正确选项能统领全段，而不是某一句。',
    enBody: 'For main idea questions, choose a general answer, not one covering only part or being too broad. Distractors are often details. The correct option governs the whole paragraph.',
    quiz: { question: '主旨题的正确答案通常？', options: ['是文中某个细节', '能概括全段', '最长的选项', '包含数字的选项'], answerIndex: 1, explanation: '主旨题答案要能统领全段，而非某一句细节。' }
  },
  {
    id: 'ielts_reading_i7', courseId: 'ielts_reading', chapterId: 'ielts_reading_ch0', type: 'lecture',
    title: '信息匹配题：扫读 + 精读',
    enTitle: 'Information Matching',
    body: '信息匹配题（which paragraph contains...）先用题干关键词扫读定位段落，再精读该段确认。这类题乱序出现，不要按顺序找。一个段落可能对应多题。',
    enBody: 'For "which paragraph contains..." questions, scan for keywords to locate the paragraph, then read it carefully to confirm. Answers are out of order, and one paragraph may match several items.',
    quiz: { question: '信息匹配题的答案是？', options: ['按文章顺序', '乱序出现', '只在首段', '只在末段'], answerIndex: 1, explanation: '这类题答案乱序，需逐题定位。' }
  },
  {
    id: 'ielts_reading_i8', courseId: 'ielts_reading', chapterId: 'ielts_reading_ch0', type: 'lecture',
    title: '时间分配策略',
    enTitle: 'Time Allocation',
    body: '阅读 60 分钟 40 题，建议每篇 20 分钟。难的文章放到最后，先做简单题型的分数。不要在某一题卡太久，超过 1 分钟先跳过，做完回头再想。',
    enBody: '60 minutes for 40 questions means about 20 minutes per passage. Do easy question types first, save hard passages for last. If stuck for over a minute, skip and return later.',
    quiz: { question: '雅思阅读每篇建议用时？', options: ['10 分钟', '15 分钟', '20 分钟', '25 分钟'], answerIndex: 2, explanation: '三篇共 60 分钟，平均每篇 20 分钟。' }
  },

  // ===== 雅思写作 ielts_writing =====
  {
    id: 'ielts_writing_i5', courseId: 'ielts_writing', chapterId: 'ielts_writing_ch0', type: 'lecture',
    title: 'Task 1 数据选择',
    enTitle: 'Task 1 Data Selection',
    body: 'Task 1 不要罗列所有数据，选 2-3 个最显著的特征：最高/最低、最大变化、明显趋势、例外点。数据引用用 "approximately / around / just over" 等词，不要照抄精确数字。',
    enBody: 'Do not list every figure in Task 1. Select 2-3 striking features: highest/lowest, biggest change, clear trend, exceptions. Use "approximately / around / just over" rather than copying exact numbers.',
    quiz: { question: 'Task 1 应该？', options: ['罗列所有数据', '选 2-3 个显著特征', '写个人观点', '只写标题'], answerIndex: 1, explanation: '选最显著特征概述，而非穷举数据。' }
  },
  {
    id: 'ielts_writing_i6', courseId: 'ielts_writing', chapterId: 'ielts_writing_ch0', type: 'lecture',
    title: 'Task 2 论点展开',
    enTitle: 'Task 2 Argument Development',
    body: '每个主体段用 PEEL 结构：Point（论点）→ Explanation（解释）→ Example（例子）→ Link（回扣题旨）。例子要具体，可以是个人经历或常识，但必须支撑论点而非另起炉灶。',
    enBody: 'Develop each body paragraph with PEEL: Point → Explanation → Example → Link back to the question. Examples should be concrete and support the point, not start a new one.',
    quiz: { question: 'PEEL 中 L 代表？', options: ['Language', 'Link', 'Length', 'Logic'], answerIndex: 1, explanation: 'PEEL = Point, Explanation, Example, Link。' }
  },
  {
    id: 'ielts_writing_i7', courseId: 'ielts_writing', chapterId: 'ielts_writing_ch0', type: 'lecture',
    title: '审题与偏题风险',
    enTitle: 'Understanding the Prompt',
    body: '大作文失分大头是偏题。先圈出题目的"任务词"：discuss、agree/disagree、advantages/disadvantages、cause/solution。确定要写几方观点、是否要给立场，再动笔。',
    enBody: 'The biggest Task 2 risk is going off-topic. Circle the task words first: discuss, agree/disagree, advantages/disadvantages, cause/solution. Decide how many views to cover and whether to state a position.',
    quiz: { question: '"Discuss both views and give your opinion" 要求？', options: ['只写一方', '讨论双方并给立场', '只写观点', '只写例子'], answerIndex: 1, explanation: '需讨论双方观点并明确给出自己的立场。' }
  },
  {
    id: 'ielts_writing_i8', courseId: 'ielts_writing', chapterId: 'ielts_writing_ch0', type: 'lecture',
    title: '词汇升级：避免重复',
    enTitle: 'Lexical Resource',
    body: '避免反复用同一个词。给高频词建立同义库：important → crucial/vital/significant；show → illustrate/demonstrate；many → numerous/a variety of。但前提是用得准，别为换词而换词。',
    enBody: 'Avoid repeating the same word. Build synonym banks: important → crucial/vital/significant; show → illustrate/demonstrate; many → numerous/a variety of. But prioritize accuracy over novelty.',
    quiz: { question: '提升词汇分的正确做法是？', options: ['堆砌生僻词', '准确使用同义替换', '重复同一个词', '全部用短词'], answerIndex: 1, explanation: '准确使用同义替换，而非堆砌或重复。' }
  },

  // ===== 托福基础 toefl_b1 =====
  {
    id: 'toefl_b1_i5', courseId: 'toefl_b1', chapterId: 'toefl_b1_ch0', type: 'lecture',
    title: '听力细节题：笔记定位',
    enTitle: 'Listening Detail Questions',
    body: '细节题答案来自讲座中的具体事实。记笔记时用缩写和符号记关键数字、人名、定义。答题时先看题干关键词，回到笔记对应位置找答案，而不是凭记忆猜。',
    enBody: 'Detail questions test specific facts. Take notes with abbreviations for key numbers, names, and definitions. Match the question keyword to your notes rather than guessing from memory.',
    quiz: { question: '细节题的最佳应对是？', options: ['凭记忆作答', '回笔记定位', '选最长选项', '跳过'], answerIndex: 1, explanation: '用题干关键词回笔记定位，比凭记忆可靠。' }
  },
  {
    id: 'toefl_b1_i6', courseId: 'toefl_b1', chapterId: 'toefl_b1_ch0', type: 'lecture',
    title: '阅读词汇题：上下文猜词',
    enTitle: 'Vocabulary in Context',
    body: '词汇题考"单词在文中的意思"，不是默写。做法：定位该词所在句 → 看前后逻辑（对比、因果、举例）→ 用上下文推断。即使不认识单词也能做对。',
    enBody: 'Vocabulary questions test meaning in context, not memorization. Locate the sentence, examine the surrounding logic (contrast, cause, example), and infer. You can answer even without knowing the word.',
    quiz: { question: '词汇题的正确做法是？', options: ['直接背词义', '看上下文推断', '选最熟悉的词', '跳过'], answerIndex: 1, explanation: '词汇题考语境义，需结合上下文推断。' }
  },
  {
    id: 'toefl_b1_i7', courseId: 'toefl_b1', chapterId: 'toefl_b1_ch0', type: 'lecture',
    title: '口语 Task 2：校园场景',
    enTitle: 'Speaking Task 2: Campus',
    body: 'Task 2 是读一则校园通知 + 听对话表态。回答结构：先概括通知内容，再说说话者的态度（支持/反对），最后给 1-2 个理由。注意用自己的话转述，不要照读。',
    enBody: 'Task 2 combines a campus announcement and a conversation. Structure: summarize the announcement, state the speaker\'s attitude (for/against), then give 1-2 reasons. Paraphrase, do not read verbatim.',
    quiz: { question: 'Task 2 回答应包含？', options: ['只概括通知', '通知+态度+理由', '只讲个人观点', '只复述对话'], answerIndex: 1, explanation: '需概括通知、说明态度并给理由。' }
  },
  {
    id: 'toefl_b1_i8', courseId: 'toefl_b1', chapterId: 'toefl_b1_ch0', type: 'lecture',
    title: '阅读主旨题：首段定位',
    enTitle: 'Reading Main Idea',
    body: '托福阅读主旨题答案常在首段，尤其是首段最后一句的 thesis statement。注意转折词 however 之后往往是真正主旨。段落主旨题则看该段首句和尾句。',
    enBody: 'Main idea answers usually sit in the first paragraph, often the thesis statement at its end. Watch for the real point after "however". For paragraph-level questions, check the first and last sentences.',
    quiz: { question: '阅读主旨常出现在？', options: ['末段', '首段 thesis statement', '中间段', '标题'], answerIndex: 1, explanation: '主旨常在首段，尤其是 thesis statement。' }
  },

  // ===== 托福进阶 toefl_b2 =====
  {
    id: 'toefl_b2_i5', courseId: 'toefl_b2', chapterId: 'toefl_b2_ch0', type: 'lecture',
    title: '讲座重听题',
    enTitle: 'Replay Questions',
    body: '重听题会重放一段话，问说话者意图或态度。关键是听"语气"而非字面意思：重音、停顿、反问都暗示态度。注意 "Actually / Well / I mean" 这类修正性开头的真实意图。',
    enBody: 'Replay questions replay a segment and ask about intent or attitude. Listen to tone, not just words: stress, pauses, and rhetorical questions reveal attitude. Note corrective openings like "Actually / Well / I mean".',
    quiz: { question: '重听题重点听什么？', options: ['字面意思', '语气和意图', '语法', '词汇'], answerIndex: 1, explanation: '重听题考意图态度，语气是关键线索。' }
  },
  {
    id: 'toefl_b2_i6', courseId: 'toefl_b2', chapterId: 'toefl_b2_ch0', type: 'lecture',
    title: '推断题：言外之意',
    enTitle: 'Inference Questions',
    body: '推断题答案不直接出现在文中，要基于信息合理推出。原则：推断必须"往前一小步"，不能过度引申。排除"文中明说"和"毫无根据"的选项，选最贴近原文逻辑的那个。',
    enBody: 'Inference answers are not stated directly but follow from the text. Infer one small step, not a leap. Eliminate options that are stated outright or unfounded, and choose the one closest to the passage logic.',
    quiz: { question: '推断题的原则是？', options: ['大胆联想', '基于原文往前一小步', '选最极端的', '选文中原句'], answerIndex: 1, explanation: '推断要基于原文做合理的小步推导。' }
  },
  {
    id: 'toefl_b2_i7', courseId: 'toefl_b2', chapterId: 'toefl_b2_ch0', type: 'lecture',
    title: '组织结构题',
    enTitle: 'Organization Questions',
    body: '组织结构题问"教授为什么提到某个例子/观点"。答案通常是"为了说明/支持/对比前文某个概念"。定位该内容在文中的位置，看它服务的论点是哪个。',
    enBody: 'Organization questions ask why the professor mentions an example or idea. The answer is usually "to illustrate/support/contrast a prior concept". Locate the item and identify which argument it serves.',
    quiz: { question: '"为什么提到某个例子"这类题考的是？', options: ['例子的细节', '例子的功能', '例子的词义', '例子的长度'], answerIndex: 1, explanation: '考例子在文中的作用，而非例子本身细节。' }
  },
  {
    id: 'toefl_b2_i8', courseId: 'toefl_b2', chapterId: 'toefl_b2_ch0', type: 'lecture',
    title: '综合口语 Task 4',
    enTitle: 'Integrated Speaking Task 4',
    body: 'Task 4 是学术讲座复述。结构：先复述教授讲的概念定义，再讲例子说明。笔记要抓"概念 + 例子"两条线，复述时用自己的话串联，60 秒内讲清楚。',
    enBody: 'Task 4 retells an academic lecture. Structure: restate the concept\'s definition, then the example. Note both the "concept" and "example" lines, and link them in your own words within 60 seconds.',
    quiz: { question: 'Task 4 复述的重点是？', options: ['只讲例子', '概念+例子', '只讲概念', '个人观点'], answerIndex: 1, explanation: '需完整复述概念定义并用例子说明。' }
  },

  // ===== 托福冲刺 toefl_adv =====
  {
    id: 'toefl_adv_i5', courseId: 'toefl_adv', chapterId: 'toefl_adv_ch0', type: 'lecture',
    title: '独立写作立论',
    enTitle: 'Independent Writing Thesis',
    body: '独立写作开头段要点：背景句引入 + 明确立场 thesis statement。立场要清晰可辩，不要骑墙。常用结构：While some argue X, I believe Y for two reasons. 明确预告主体段内容。',
    enBody: 'A strong intro has a hook and a clear thesis. Take a clear, arguable stance — no fence-sitting. Use: "While some argue X, I believe Y for two reasons" and preview your body paragraphs.',
    quiz: { question: '好的 thesis statement 应该？', options: ['骑墙不定', '清晰可辩', '越长越好', '只提问题'], answerIndex: 1, explanation: '立场要明确、可辩论，并预告论证方向。' }
  },
  {
    id: 'toefl_adv_i6', courseId: 'toefl_adv', chapterId: 'toefl_adv_ch0', type: 'lecture',
    title: '例子充分性',
    enTitle: 'Adequate Examples',
    body: '每个论点都要有具体例子支撑，泛泛而谈会扣分。例子可以是个人经历、历史事件、常识，但必须具体：谁、做了什么、结果如何。一个具体例子胜过三个空泛观点。',
    enBody: 'Every point needs concrete support; vague statements lose points. Examples can be personal, historical, or common knowledge, but must be specific: who, what, and the result. One specific example beats three vague claims.',
    quiz: { question: '论证充分的关键是？', options: ['观点越多越好', '每个论点配具体例子', '用高级词汇', '写长句'], answerIndex: 1, explanation: '具体例子支撑论点才是论证充分的关键。' }
  },
  {
    id: 'toefl_adv_i7', courseId: 'toefl_adv', chapterId: 'toefl_adv_ch0', type: 'lecture',
    title: '让步与反驳',
    enTitle: 'Concession and Rebuttal',
    body: '高分作文常含让步段：先承认对方观点有道理（Admittedly, ...），再用 however 反驳。这展示辩证思维，但让步要简短，反驳要占主体，不能让让步削弱自己的立场。',
    enBody: 'High-scoring essays include a concession: acknowledge the counterargument (Admittedly, ...), then rebut with "however". This shows balanced thinking, but keep the concession brief so it does not weaken your position.',
    quiz: { question: '让步段的正确写法是？', options: ['只写对方观点', '承认对方+反驳', '完全不提对方', '全部让步'], answerIndex: 1, explanation: '先承认对方有道理，再反驳，展示辩证思维。' }
  },
  {
    id: 'toefl_adv_i8', courseId: 'toefl_adv', chapterId: 'toefl_adv_ch0', type: 'lecture',
    title: '结尾段：升华不重复',
    enTitle: 'Conclusion: Elevate, Don\'t Repeat',
    body: '结尾段不要逐字重复正文。做法：paraphrase 重申立场 + 升华意义（展望、呼吁、总结价值）。简短有力，2-3 句即可，切忌引入新论点。',
    enBody: 'Do not repeat the body verbatim. Instead, paraphrase your position and elevate it (look ahead, call to action, or summarize value). Keep it to 2-3 strong sentences and introduce no new arguments.',
    quiz: { question: '结尾段应该？', options: ['逐字重复正文', '重申立场+升华', '引入新论点', '写越长越好'], answerIndex: 1, explanation: '结尾要重申立场并升华，不重复、不引入新论点。' }
  }
];

const existingIds = new Set(d.knowledge.map(k => k.id));
const dup = ADD.filter(a => existingIds.has(a.id));
if (dup.length) { console.error('id 冲突:', dup.map(a => a.id).join(', ')); process.exit(1); }

const courseIds = new Set(d.courses.map(c => c.id));
const chapterIds = new Set(d.chapters.map(c => c.id));
const bad = ADD.filter(a => !courseIds.has(a.courseId) || !chapterIds.has(a.chapterId));
if (bad.length) { console.error('courseId/chapterId 无效:', bad.map(a => a.id).join(', ')); process.exit(1); }

const knowledge = d.knowledge.concat(ADD);
const chapters = d.chapters.map(ch => {
  const items = knowledge.filter(k => k.courseId === ch.courseId).map(k => ({
    id: k.id, title: k.title, learned: false, videoUrl: k.videoUrl || '', enBody: k.enBody || ''
  }));
  return Object.assign({}, ch, { items });
});
const countByCourse = {};
knowledge.forEach(k => { countByCourse[k.courseId] = (countByCourse[k.courseId] || 0) + 1; });
const courses = d.courses.map(c => Object.assign({}, c, { desc: (countByCourse[c.id] || 0) + ' 个知识点' }));

const header = `/**
 * 课程知识点数据全集（对象版）
 * knowledge: ${knowledge.length}条知识点 | courses: ${courses.length}门 | chapters: ${chapters.length}章
 * course.js 读 courses/chapters，teach.js 读 knowledge
 * 数据一致性（由 _test/check-data.js 校验）
 */
`;
const body = [
  `const knowledge = ${JSON.stringify(knowledge, null, 2)};`, '',
  `const courses = ${JSON.stringify(courses, null, 2)};`, '',
  `const chapters = ${JSON.stringify(chapters, null, 2)};`, '',
  `const systems = ${JSON.stringify(d.systems, null, 2)};`, '',
  'module.exports = { courses, chapters, knowledge, systems };', ''
].join('\n');
fs.writeFileSync(DATA_FILE, header + '\n' + body, 'utf8');

console.log('=== 语言类扩充完成 ===');
console.log('新增:', ADD.length, '条 | 总知识点:', knowledge.length);
