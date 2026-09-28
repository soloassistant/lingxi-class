/**
 * 课程知识点数据全集（对象版）
 * knowledge: 176条知识点 | courses: 22门 | chapters: 22章
 * course.js 读 courses/chapters，teach.js 读 knowledge
 * 数据一致性（由 _test/check-data.js 校验）
 */

const knowledge = [
  {
    "id": "ielts_listening_basics",
    "courseId": "ielts_listening",
    "title": "雅思听力基础：定位词",
    "enTitle": "IELTS Listening: Locating Words",
    "body": "定位词（locating words）用于在听力录音中快速锁定答案所在的句子。最适合做定位词的通常是专有名词（人名、地名、机构名）和数字，因为它们不容易被同义替换。听到定位词就要提高警觉，答案往往紧随其后。",
    "enBody": "Locating words help you quickly find the sentence that contains the answer. The best locating words are proper nouns (names, places, institutions) and numbers, because they are rarely paraphrased. When you hear a locating word, be alert: the answer usually follows immediately.",
    "quiz": {
      "question": "以下哪类词最适合做定位词？",
      "options": [
        "介词",
        "专有名词",
        "动名词",
        "形容词"
      ],
      "answerIndex": 1,
      "explanation": "专有名词如人名、地名在听力中不容易被同义替换，最适合做定位词。"
    },
    "videoUrl": "",
    "poster": "",
    "chapterId": "ielts_listening_ch0",
    "type": "lecture"
  },
  {
    "id": "toefl_b2_i1",
    "chapterId": "toefl_b2_ch0",
    "title": "Cornell 笔记法",
    "type": "lecture",
    "body": "托福听力讲座信息密度高，推荐 Cornell 笔记法：把纸分成主栏（右侧记录要点）、副栏（左侧写提示词）、底部总结栏。听时快速记主栏，间歇时写提示词，讲座结束前用 10 秒做总结。注意提升笔记效率。",
    "quiz": {
      "question": "In Cornell notes, the main column is for:",
      "options": [
        "Key points",
        "Summary",
        "Keywords",
        "Questions"
      ],
      "answerIndex": 0,
      "explanation": "主栏记录讲座要点；副栏写提示词；底部是总结。",
      "remedialSection": "用 Cornell 法做一遍 TPO 讲座听力笔记。"
    },
    "courseId": "toefl_b2",
    "enTitle": "The Cornell Note-Taking Method",
    "enBody": "TOEFL lectures are information-dense, so the Cornell method helps: divide the page into a main column (right, key points), a cue column (left, keywords), and a summary bar (bottom). Take notes in the main column while listening, write cues during pauses, and spend 10 seconds summarizing at the end."
  },
  {
    "id": "toefl_b2_i2",
    "chapterId": "toefl_b2_ch0",
    "title": "信号词",
    "type": "lecture",
    "body": "听力讲座中的信号词提示结构和重点。列举型：first, besides, another. 转折型：however, but, in contrast. 因果型：therefore, as a result, consequently. 举例型：for instance, such as, take ... as an example. 听到因果型信号词时尤其要提高警惕。",
    "quiz": {
      "question": "Which word signals a cause-and-effect relationship?",
      "options": [
        "For instance",
        "Consequently",
        "In addition",
        "Meanwhile"
      ],
      "answerIndex": 1,
      "explanation": "consequently 表示结果，是因果关系的信号词。",
      "remedialSection": "把讲座中听到的信号词按类型整理成表，每天听一篇标记一次。"
    },
    "courseId": "toefl_b2",
    "enTitle": "Signal Words",
    "enBody": "Signal words in lectures reveal structure and emphasis. Listing: first, besides, another. Contrast: however, but, in contrast. Cause-effect: therefore, as a result, consequently. Examples: for instance, such as, take ... as an example. Be especially alert when you hear cause-effect signals."
  },
  {
    "id": "toefl_b2_i3",
    "chapterId": "toefl_b2_ch0",
    "title": "讲座结构",
    "type": "lecture",
    "body": "托福学术讲座结构稳定：引入主题 → 背景铺垫 → 核心概念定义 → 分点展开 → 举例说明 → 教授评价与总结。预判结构能在听力中提前定位：听到 \"let's define\" 就知道这是概念定义部分。",
    "quiz": {
      "question": "A professor says: \"Let me give you an example of this process.\" What comes next?",
      "options": [
        "Definition",
        "Example",
        "Evaluation",
        "Conclusion"
      ],
      "answerIndex": 1,
      "explanation": "give you an example 指示接下来是举例部分。",
      "remedialSection": "听 3 篇讲座，在笔记中标注结构转换点。"
    },
    "courseId": "toefl_b2",
    "enTitle": "Lecture Structure",
    "enBody": "Academic lectures follow a stable structure: introduce the topic, give background, define the core concept, develop points, give examples, then the professor evaluates and summarizes. Predicting this structure lets you locate information early — hearing \"let's define\" tells you a definition is coming."
  },
  {
    "id": "toefl_b2_i4",
    "chapterId": "toefl_b2_ch0",
    "title": "速记符号",
    "type": "lecture",
    "body": "听力笔记用符号代替整词：箭头 → 表示导致，← 表示来源于，↑ 上升/增加，↓ 下降/减少，∵ 因为，∴ 所以，= 等于/意味着，× 不是/错误，≠ 不同于。符号能帮你跟上语速。",
    "quiz": {
      "question": "In listening notes, \"∵\" usually means:",
      "options": [
        "Therefore",
        "Because",
        "However",
        "In addition"
      ],
      "answerIndex": 1,
      "explanation": "∵ 表示 because（因为）；∴ 表示 therefore（所以）。",
      "remedialSection": "用这套符号系统重写一篇讲座笔记。"
    },
    "courseId": "toefl_b2",
    "enTitle": "Note-Taking Symbols",
    "enBody": "Use symbols instead of full words in notes: an arrow (→) means \"leads to\", (←) \"comes from\", (↑) increase, (↓) decrease, (∵) because, (∴) therefore, (=) equals or means, (×) not or wrong, (≠) different. Symbols help you keep up with the speaker's pace."
  },
  {
    "id": "toefl_adv_i1",
    "chapterId": "toefl_adv_ch0",
    "title": "整合框架",
    "type": "lecture",
    "body": "综合写作是\"阅读 vs 听力\"的对比框架。阅读提出三个论点，听力逐点反驳。写作基本结构：首段总述阅读与听力关系 + 三个主体段（每段先说明阅读观点，再说明听力反驳）。",
    "quiz": {
      "question": "In integrated writing, the listening passage typically:",
      "options": [
        "Supports the reading",
        "Challenges the reading",
        "Summarizes the reading",
        "Is unrelated to the reading"
      ],
      "answerIndex": 1,
      "explanation": "听力通常对阅读中的论点提出质疑或反驳。",
      "remedialSection": "用框架图画出综合写作的结构骨：阅读论点 vs 听力反驳。"
    },
    "courseId": "toefl_adv",
    "enTitle": "Integrated Writing Framework",
    "enBody": "Integrated writing is a \"reading vs. listening\" contrast framework. The reading presents three points, and the lecture rebuts them one by one. Basic structure: an introduction summarizing the relationship, then three body paragraphs (each stating a reading point, then the lecture's counterargument)."
  },
  {
    "id": "toefl_adv_i2",
    "chapterId": "toefl_adv_ch0",
    "title": "模板句式",
    "type": "lecture",
    "body": "高频模板句式：The reading passage argues that ... However, the lecturer challenges this by explaining that ... The professor contradicts the point by emphasizing ... 注意模板只搭骨架，70% 以上内容必须是自己的语言和细节，不能整篇套用。",
    "quiz": {
      "question": "Which sentence best introduces a contrast?",
      "options": [
        "The reading states that X, and the lecturer agrees.",
        "The reading states that X. However, the lecturer challenges this.",
        "The reading states that X, so the lecturer listens.",
        "The reading states that X because the lecturer responds."
      ],
      "answerIndex": 1,
      "explanation": "However, the lecturer challenges 是标准的对比表达。",
      "remedialSection": "用 3 组对比模板写综合写作开头段。"
    },
    "courseId": "toefl_adv",
    "enTitle": "Template Sentences",
    "enBody": "High-frequency templates: \"The reading passage argues that ... However, the lecturer challenges this by explaining that ...\" Remember that templates only build the skeleton; over 70% of your essay must be your own language and details, not copied verbatim."
  },
  {
    "id": "toefl_adv_i3",
    "chapterId": "toefl_adv_ch0",
    "title": "阅读预判",
    "type": "lecture",
    "body": "综合写作前 3 分钟阅读环节，要用笔标出三个论点：找 \"firstly / secondly / finally\" 或段落首句。提前用一句话概括每个论点，为定位听力反驳做准备。",
    "quiz": {
      "question": "During the reading phase, you should mainly:",
      "options": [
        "Memorize every detail",
        "Identify the three main arguments",
        "Write your full outline",
        "Check grammar"
      ],
      "answerIndex": 1,
      "explanation": "阅读阶段核心任务是识别阅读中的三个分论点。",
      "remedialSection": "拿 3 篇综合写作真题练阅读预判，只写三个分论点。"
    },
    "courseId": "toefl_adv",
    "enTitle": "Reading Prediction",
    "enBody": "During the 3-minute reading phase, mark the three arguments with your pencil: look for \"firstly / secondly / finally\" or topic sentences. Summarize each point in one sentence in advance, which prepares you to locate the lecture's rebuttals."
  },
  {
    "id": "toefl_adv_i4",
    "chapterId": "toefl_adv_ch0",
    "title": "评分标准",
    "type": "lecture",
    "body": "综合写作评分维度：信息完整性（是否覆盖阅读和听力所有要点）、准确性（是否歪曲信息）、清晰度（逻辑和语言清晰）。丢掉一个要点基本就告别 28 分以上。所以宁可少修饰，不能漏要点。",
    "quiz": {
      "question": "Which factor most seriously hurts your integrated writing score?",
      "options": [
        "Missing a key point",
        "Using simple words",
        "Long sentences",
        "Handwriting"
      ],
      "answerIndex": 0,
      "explanation": "遗漏要点比语言简单更致命。",
      "remedialSection": "按评分标准给你的综合写作作文打 3 项分。"
    },
    "courseId": "toefl_adv",
    "enTitle": "Scoring Criteria",
    "enBody": "Integrated writing is scored on completeness (covering all reading and listening points), accuracy (not distorting information), and clarity. Missing one point usually rules out a 28+ score. So prefer less ornamentation over omitting key points."
  },
  {
    "id": "igcse_math_i1",
    "chapterId": "igcse_math_ch0",
    "title": "一元二次方程",
    "type": "lecture",
    "body": "一元二次方程 ax² + bx + c = 0 的解法三种：因式分解法（最快）、配方法（变形严谨）、求根公式 x = [-b ± √(b²-4ac)] / (2a)。判别式 Δ = b² - 4ac：Δ > 0 两个实根，Δ = 0 一个重根，Δ < 0 无实根。",
    "quiz": {
      "question": "What is the discriminant of x² - 5x + 6 = 0?",
      "options": [
        "1",
        "25",
        "36",
        "49"
      ],
      "answerIndex": 0,
      "explanation": "Δ = b² - 4ac = (-5)² - 4×1×6 = 25 - 24 = 1。",
      "remedialSection": "复习求根公式和完全平方式，算出 Δ 后判断根的类型。"
    },
    "courseId": "igcse_math",
    "enTitle": "Quadratic Equations",
    "enBody": "The quadratic ax² + bx + c = 0 can be solved three ways: factoring (fastest), completing the square (rigorous), and the quadratic formula x = [-b ± √(b²-4ac)] / (2a). The discriminant Δ = b² - 4ac: Δ > 0 gives two real roots, Δ = 0 one repeated root, Δ < 0 no real roots."
  },
  {
    "id": "igcse_math_i2",
    "chapterId": "igcse_math_ch0",
    "title": "因式分解",
    "type": "lecture",
    "body": "因式分解是把多项式写成因式乘积。常见题型：提公因式 ax + bx = x(a+b)；平方差 a² - b² = (a+b)(a-b)；完全平方 a² ± 2ab + b² = (a±b)²。先看是否有公因式，再看是否特殊形式。",
    "quiz": {
      "question": "Factor x² - 9:",
      "options": [
        "(x-3)²",
        "(x+3)(x-3)",
        "(x+9)(x-1)",
        "x(x-9)"
      ],
      "answerIndex": 1,
      "explanation": "x² - 9 是平方差形式：x² - 3² = (x+3)(x-3)。",
      "remedialSection": "练习 5 题平方差和完全平方的因式分解。"
    },
    "courseId": "igcse_math",
    "enTitle": "Factorisation",
    "enBody": "Factorisation writes a polynomial as a product of factors. Common cases: taking a common factor ax + bx = x(a+b); difference of squares a² - b² = (a+b)(a-b); perfect square a² ± 2ab + b² = (a±b)². First look for a common factor, then for a special form."
  },
  {
    "id": "igcse_math_i3",
    "chapterId": "igcse_math_ch0",
    "title": "完全平方",
    "type": "lecture",
    "body": "完全平方三项式：a² + 2ab + b² = (a+b)²；a² - 2ab + b² = (a-b)²。关键检测法：首尾加括号能否写成某式平方，中项是否为两倍乘。例如 x² + 6x + 9 = (x+3)²。",
    "quiz": {
      "question": "Which is a perfect square trinomial?",
      "options": [
        "x² + 6x + 9",
        "x² + 5x + 6",
        "x² - 4x + 8",
        "x² - x + 1"
      ],
      "answerIndex": 0,
      "explanation": "x² + 6x + 9 = (x+3)²，其中 6x = 2×x×3。",
      "remedialSection": "判断五个三项式是否是完全平方，写出因式分解。"
    },
    "courseId": "igcse_math",
    "enTitle": "Completing the Square",
    "enBody": "Perfect-square trinomials: a² + 2ab + b² = (a+b)² and a² - 2ab + b² = (a-b)². The key check: can the first and last terms form a square, and is the middle term twice the product? For example, x² + 6x + 9 = (x+3)²."
  },
  {
    "id": "igcse_math_i4",
    "chapterId": "igcse_math_ch0",
    "title": "解不等式",
    "type": "lecture",
    "body": "解不等式与解方程类似，但乘除以负数时方向反转。例如 -2x < 6 → x > -3。解集可用数轴表示，实心点表示含等号，空心点表示不含等号。注意文字题的\"at least\"和\"more than\"的区别。",
    "quiz": {
      "question": "Solve: -3x ≤ 12",
      "options": [
        "x ≥ -4",
        "x ≤ -4",
        "x ≥ 4",
        "x ≤ 4"
      ],
      "answerIndex": 0,
      "explanation": "两边除以 -3，不等号方向反转：-3x ≤ 12 → x ≥ -4。",
      "remedialSection": "回顾不等式方向法则，做 5 道含负数系数的练习题。"
    },
    "courseId": "igcse_math",
    "enTitle": "Solving Inequalities",
    "enBody": "Solving inequalities is like solving equations, but multiplying or dividing by a negative reverses the direction. Example: -2x < 6 → x > -3. Show solution sets on a number line with a closed dot for inclusive and an open dot for exclusive. Note the difference between \"at least\" and \"more than\"."
  },
  {
    "id": "igcse_am_i1",
    "chapterId": "igcse_addmath_ch0",
    "title": "微分基本规则",
    "type": "lecture",
    "body": "微分是求变化率。幂函数求导：d/dx (xⁿ) = nxⁿ⁻¹。常数求导为 0。例如 y = x³ 的导数是 3x²。导数的几何意义是曲线在该点的切线斜率。",
    "quiz": {
      "question": "What is dy/dx for y = x⁴?",
      "options": [
        "x³",
        "3x³",
        "4x³",
        "x⁵/5"
      ],
      "answerIndex": 2,
      "explanation": "用幂函数求导法则：d/dx(xⁿ) = nxⁿ⁻¹，所以 d/dx(x⁴) = 4x³。",
      "remedialSection": "回顾幂函数求导法则，练习 8 题基础求导。"
    },
    "courseId": "igcse_addmath",
    "enTitle": "Basic Differentiation Rules",
    "enBody": "Differentiation finds a rate of change. Power rule: d/dx (xⁿ) = nxⁿ⁻¹. The derivative of a constant is 0. For example, the derivative of y = x³ is 3x². Geometrically, the derivative is the slope of the tangent at that point."
  },
  {
    "id": "igcse_am_i2",
    "chapterId": "igcse_addmath_ch0",
    "title": "切线斜率",
    "type": "lecture",
    "body": "求曲线上一点的切线斜率：先求导函数，再代入该点的 x 坐标。例如 y = x² 在 x = 3 处斜率为 dy/dx = 2x = 6。斜率大于 0 表示递增，小于 0 表示递减。",
    "quiz": {
      "question": "The slope of y = x² at x = 3 is:",
      "options": [
        "2",
        "3",
        "6",
        "9"
      ],
      "answerIndex": 2,
      "explanation": "y' = 2x，代入 x = 3 得 6。",
      "remedialSection": "求 y = x² + 1 在 x = 2 处的切线方程。"
    },
    "courseId": "igcse_addmath",
    "enTitle": "Tangent Slope",
    "enBody": "To find the tangent slope at a point on a curve, first differentiate, then substitute the point's x-coordinate. For example, y = x² at x = 3 has slope dy/dx = 2x = 6. A positive slope means increasing, negative means decreasing."
  },
  {
    "id": "igcse_am_i3",
    "chapterId": "igcse_addmath_ch0",
    "title": "定积分",
    "type": "lecture",
    "body": "定积分表示曲线与 x 轴围成的面积。∫ₐᵇ f(x) dx = F(b) - F(a)，其中 F 是 f 的反导函数。例如 ∫₁³ x² dx = [x³/3]₁³ = 27/3 - 1/3 = 26/3。面积为正时要注意取绝对值。",
    "quiz": {
      "question": "What is ∫₀¹ 2x dx?",
      "options": [
        "0",
        "1",
        "2",
        "3"
      ],
      "answerIndex": 1,
      "explanation": "∫₀¹ 2x dx = [x²]₀¹ = 1 - 0 = 1。",
      "remedialSection": "复习反导函数概念，练习计算 5 个定积分。"
    },
    "courseId": "igcse_addmath",
    "enTitle": "Definite Integrals",
    "enBody": "A definite integral represents the area between a curve and the x-axis: ∫ₐᵇ f(x) dx = F(b) - F(a), where F is an antiderivative of f. For example, ∫₁³ x² dx = [x³/3]₁³ = 27/3 - 1/3 = 26/3. Take absolute values when the area is below the axis."
  },
  {
    "id": "igcse_am_i4",
    "chapterId": "igcse_addmath_ch0",
    "title": "积分应用",
    "type": "lecture",
    "body": "积分可用于求变速运动的位移（速度函数积分）、求曲线间面积（上曲线减下曲线积分）、求体积。实际问题中先画图确定积分上下限，再判断哪条曲线在上方。",
    "quiz": {
      "question": "The area between y = x² and the x-axis from x=0 to x=2 is:",
      "options": [
        "2/3",
        "4/3",
        "8/3",
        "16/3"
      ],
      "answerIndex": 2,
      "explanation": "∫₀² x² dx = [x³/3]₀² = 8/3。",
      "remedialSection": "把题目图形画出来，确认曲线位置后再积分。"
    },
    "courseId": "igcse_addmath",
    "enTitle": "Applications of Integration",
    "enBody": "Integration finds displacement from a velocity function, area between curves (upper curve minus lower curve), and volume. In applications, draw the graph first to fix the limits of integration, then determine which curve is on top."
  },
  {
    "id": "alevel_p3_i1",
    "chapterId": "alevel_pure3_ch0",
    "title": "分离变量法",
    "type": "lecture",
    "body": "可分离变量的微分方程形如 dy/dx = f(x)g(y)。解法：把 y 项移到左边、x 项移到右边，两边积分。例如 dy/dx = x/y，则 y dy = x dx，两边积分得 y²/2 = x²/2 + C，即 y² = x² + C。",
    "quiz": {
      "question": "Which equation can be solved by separation of variables?",
      "options": [
        "dy/dx = x + y",
        "dy/dx = x²y",
        "dy/dx = x - 2y",
        "dy/dx = y"
      ],
      "answerIndex": 1,
      "explanation": "dy/dx = x²y 可分离：dy/y = x² dx，然后两边积分。",
      "remedialSection": "回顾分离变量法的两个步骤：分离和积分。"
    },
    "courseId": "alevel_pure3",
    "enTitle": "Separation of Variables",
    "enBody": "A separable differential equation has the form dy/dx = f(x)g(y). Method: move all y-terms to one side and x-terms to the other, then integrate both sides. Example: dy/dx = x/y gives y dy = x dx, so y²/2 = x²/2 + C, i.e. y² = x² + C."
  },
  {
    "id": "alevel_p3_i2",
    "chapterId": "alevel_pure3_ch0",
    "title": "积分因子法",
    "type": "lecture",
    "body": "一阶线性微分方程 dy/dx + P(x)y = Q(x) 用积分因子 I = e^∫P dx 求解。两边乘 I 后左边变成 (Iy)'，两边积分即得通解。例如 dy/dx + y = sin x，P(x) = 1，I = eˣ。",
    "quiz": {
      "question": "For dy/dx + 2y = x, the integrating factor is:",
      "options": [
        "x²",
        "e²ˣ",
        "x",
        "eˣ"
      ],
      "answerIndex": 1,
      "explanation": "I = e^∫2 dx = e²ˣ。",
      "remedialSection": "复习 e 的积分规则，再练 2 道积分因子题。"
    },
    "courseId": "alevel_pure3",
    "enTitle": "Integrating Factor Method",
    "enBody": "For a first-order linear equation dy/dx + P(x)y = Q(x), use the integrating factor I = e^∫P dx. Multiplying through by I makes the left side equal to (Iy)', so integrating gives the general solution. Example: dy/dx + y = sin x has P(x) = 1 and I = eˣ."
  },
  {
    "id": "alevel_p3_i3",
    "chapterId": "alevel_pure3_ch0",
    "title": "二阶常系数方程",
    "type": "lecture",
    "body": "二阶常系数齐次方程 ay'' + by' + cy = 0，解特征方程 aλ² + bλ + c = 0。两个不同实根 λ₁, λ₂ 时通解为 y = A e^(λ₁x) + B e^(λ₂x)。重根时 y = (A + Bx)e^(λx)。根为复数时用三角形式。",
    "quiz": {
      "question": "The characteristic equation of y'' + 5y' + 6y = 0 is:",
      "options": [
        "λ² + 5λ + 6 = 0",
        "λ² - 5λ + 6 = 0",
        "λ² + 5λ - 6 = 0",
        "λ² - 5λ - 6 = 0"
      ],
      "answerIndex": 0,
      "explanation": "把 y'' 换成 λ²，y' 换成 λ，y 换成 1，得 λ² + 5λ + 6 = 0。",
      "remedialSection": "解特征方程 (λ+2)(λ+3)=0 后写出通解。"
    },
    "courseId": "alevel_pure3",
    "enTitle": "Second-Order Constant-Coefficient Equations",
    "enBody": "For ay'' + by' + cy = 0, solve the characteristic equation aλ² + bλ + c = 0. With two distinct real roots λ₁, λ₂, the general solution is y = A e^(λ₁x) + B e^(λ₂x). For a repeated root use y = (A + Bx)e^(λx). Complex roots give trig form."
  },
  {
    "id": "alevel_p3_i4",
    "chapterId": "alevel_pure3_ch0",
    "title": "初始条件",
    "type": "lecture",
    "body": "通解含任意常数，需要初始条件确定唯一特解。例如 y' = y，初值 y(0) = 1，通解 y = Ceˣ，代入得 C = 1，特解为 y = eˣ。注意代初值要在求导和整理之后。",
    "quiz": {
      "question": "If dy/dx = y and y(0) = 2, what is the particular solution?",
      "options": [
        "y = 2eˣ",
        "y = e²ˣ",
        "y = eˣ + 2",
        "y = 2e⁻ˣ"
      ],
      "answerIndex": 0,
      "explanation": "通解 y = Ceˣ，代入 y(0) = 2 得 C = 2。",
      "remedialSection": "解 dy/dx = 2y，初值 y(0) = 3。"
    },
    "courseId": "alevel_pure3",
    "enTitle": "Initial Conditions",
    "enBody": "A general solution contains arbitrary constants; initial conditions pin down a unique particular solution. Example: y' = y with y(0) = 1 gives the general solution y = Ceˣ, so C = 1 and the particular solution is y = eˣ. Substitute initial values only after differentiating and simplifying."
  },
  {
    "id": "alevel_mech_i1",
    "chapterId": "alevel_mech_ch0",
    "title": "牛顿第二定律",
    "type": "lecture",
    "body": "牛顿第二定律 F = ma。力单位牛顿 N，质量 1N = 1 kg·m/s²。解题步骤：画受力分析图 → 合成净外力 → 套 F = ma。注意方向：以运动方向为正。",
    "quiz": {
      "question": "A 3 kg object accelerates at 2 m/s². The net force is:",
      "options": [
        "1.5 N",
        "5 N",
        "6 N",
        "9 N"
      ],
      "answerIndex": 2,
      "explanation": "F = ma = 3 × 2 = 6 N。",
      "remedialSection": "画一个受力分析图，标出所有力再计算合力。"
    },
    "courseId": "alevel_mech",
    "enTitle": "Newton's Second Law",
    "enBody": "Newton's second law is F = ma. Force is in newtons (N), where 1 N = 1 kg·m/s². Steps: draw a free-body diagram, resolve the net force, then apply F = ma. Take the direction of motion as positive."
  },
  {
    "id": "alevel_mech_i2",
    "chapterId": "alevel_mech_ch0",
    "title": "匀加速运动",
    "type": "lecture",
    "body": "匀加速运动的五个关系式：v = u + at、s = ut + ½at²、v² = u² + 2as、s = (u+v)t/2。每个公式含 4 个变量，已知 3 个求第 4 个。",
    "quiz": {
      "question": "A car accelerates from rest at 2 m/s² for 3 s. The distance is:",
      "options": [
        "3 m",
        "6 m",
        "9 m",
        "18 m"
      ],
      "answerIndex": 2,
      "explanation": "s = ut + ½at² = 0 + ½×2×9 = 9 m。",
      "remedialSection": "列出五个匀加速公式，标明每个公式中缺哪个变量。"
    },
    "courseId": "alevel_mech",
    "enTitle": "Uniformly Accelerated Motion",
    "enBody": "The five SUVAT equations: v = u + at, s = ut + ½at², v² = u² + 2as, s = (u+v)t/2, and s = vt - ½at². Each involves four variables — given three, solve for the fourth."
  },
  {
    "id": "alevel_mech_i3",
    "chapterId": "alevel_mech_ch0",
    "title": "连接体问题",
    "type": "lecture",
    "body": "连接体问题：两个物体用绳子连接，整体加速度相同。列两个方程：整体方程（外部拉力）和单体方程（绳张力）。例如 A 和 B 用绳连接，拉力 F 拉 A，则 F - T = mA·a，T = mB·a。",
    "quiz": {
      "question": "In a connected-body problem, the tension in the rope:",
      "options": [
        "Is always zero",
        "Equals the applied force",
        "Is an internal force",
        "Cannot be calculated"
      ],
      "answerIndex": 2,
      "explanation": "绳张力是连接体之间的内力，通过隔离单体计算。",
      "remedialSection": "画 A、B 连接体的受力图，标出张力和加速度方向。"
    },
    "courseId": "alevel_mech",
    "enTitle": "Connected Particles",
    "enBody": "In connected-particle problems, two bodies joined by a string share the same acceleration. Write two equations: an overall equation (external force) and a single-body equation (tension). Example: force F pulls A linked to B, so F - T = mA·a and T = mB·a."
  },
  {
    "id": "alevel_mech_i4",
    "chapterId": "alevel_mech_ch0",
    "title": "能量守恒",
    "type": "lecture",
    "body": "无摩擦时机械能守恒：动能 + 势能 = 常量。EK = ½mv²，EGP = mgh。例：物体从高度 h 自由下落，到底部 v = √(2gh)。有摩擦时用功能原理：外力做功 = 机械能变化。",
    "quiz": {
      "question": "A 1 kg ball drops from 5 m. What is its speed just before hitting the ground? (g=10 m/s²)",
      "options": [
        "5 m/s",
        "10 m/s",
        "15 m/s",
        "50 m/s"
      ],
      "answerIndex": 1,
      "explanation": "v = √(2gh) = √(2×10×5) = √100 = 10 m/s。",
      "remedialSection": "回顾动能和势能公式，列出能量守恒方程。"
    },
    "courseId": "alevel_mech",
    "enTitle": "Conservation of Energy",
    "enBody": "Without friction, mechanical energy is conserved: kinetic + potential = constant. KE = ½mv² and GPE = mgh. Example: an object dropped from height h reaches v = √(2gh). With friction, use the work-energy principle: work done equals change in mechanical energy."
  },
  {
    "id": "ib_aa_i1",
    "chapterId": "ib_math_aa_ch0",
    "title": "链式法则",
    "type": "lecture",
    "body": "复合函数求导用链式法则：dy/dx = dy/du × du/dx。例：y = sin(2x)，令 u = 2x，则 dy/du = cos(2x)，du/dx = 2，所以 dy/dx = 2cos(2x)。",
    "quiz": {
      "question": "What is the derivative of sin(2x)?",
      "options": [
        "cos(2x)",
        "2cos(2x)",
        "-cos(2x)",
        "-2cos(2x)"
      ],
      "answerIndex": 1,
      "explanation": "链式法则：导数是 2cos(2x)。",
      "remedialSection": "练习求 cos(3x)、e^(2x)、ln(2x) 的导数。"
    },
    "courseId": "ib_math_aa",
    "enTitle": "The Chain Rule",
    "enBody": "Differentiate composite functions with the chain rule: dy/dx = dy/du × du/dx. Example: y = sin(2x), let u = 2x, so dy/du = cos(2x) and du/dx = 2, giving dy/dx = 2cos(2x)."
  },
  {
    "id": "ib_aa_i2",
    "chapterId": "ib_math_aa_ch0",
    "title": "分部积分",
    "type": "lecture",
    "body": "分部积分公式 ∫u dv = uv - ∫v du。用于两个不同函数的乘积。选择 u 遵循 LIATE：对数、反三角、代数、三角、指数。例：∫x eˣ dx，取 u=x，dv=eˣ dx，得 = xeˣ - eˣ + C。",
    "quiz": {
      "question": "For ∫x cos(x) dx, the best choice for u is:",
      "options": [
        "cos(x)",
        "x",
        "1",
        "cos(x)+x"
      ],
      "answerIndex": 1,
      "explanation": "LIATE 法则：代数 x 优先于三角 cos(x)，所以 u = x，dv = cos(x) dx。",
      "remedialSection": "复习 LIATE 法则，做 3 道分部积分基础题。"
    },
    "courseId": "ib_math_aa",
    "enTitle": "Integration by Parts",
    "enBody": "Integration by parts: ∫u dv = uv - ∫v du. Use it for products of two different function types. Choose u by LIATE: Logarithmic, Inverse trig, Algebraic, Trigonometric, Exponential. Example: ∫x eˣ dx with u = x, dv = eˣ dx gives xeˣ - eˣ + C."
  },
  {
    "id": "ib_aa_i3",
    "chapterId": "ib_math_aa_ch0",
    "title": "泰勒展开",
    "type": "lecture",
    "body": "泰勒展开在某点附近用多项式近似函数。公式：f(x) = f(a) + f'(a)(x-a) + f''(a)(x-a)²/2! + ... 在 x=0 处的展开又称麦克劳林展开。例：eˣ = 1 + x + x²/2! + x³/3! + ...",
    "quiz": {
      "question": "The Maclaurin series of eˣ starts with:",
      "options": [
        "1 + x",
        "1 - x",
        "x + x²",
        "1 + x²"
      ],
      "answerIndex": 0,
      "explanation": "eˣ = 1 + x + x²/2! + x³/3! + ...，前两项是 1 + x。",
      "remedialSection": "对比 eˣ 和 1+x 在 x=0 附近的大小，理解展开的逼近意义。"
    },
    "courseId": "ib_math_aa",
    "enTitle": "Taylor Expansion",
    "enBody": "A Taylor expansion approximates a function near a point with a polynomial: f(x) = f(a) + f'(a)(x-a) + f''(a)(x-a)²/2! + ... At x = 0 this is the Maclaurin series. Example: eˣ = 1 + x + x²/2! + x³/3! + ..."
  },
  {
    "id": "ib_aa_i4",
    "chapterId": "ib_math_aa_ch0",
    "title": "积分换元",
    "type": "lecture",
    "body": "换元积分是凑微分的高阶版。u 替换复杂部分，dx 用 du 表示。例：∫2x e^(x²) dx，令 u = x²，则 du = 2x dx，原式 = ∫e^u du = e^(x²) + C。完成换元后检查 dx 是否被完全替换。",
    "quiz": {
      "question": "What substitution for ∫2x cos(x²) dx?",
      "options": [
        "u = 2x",
        "u = x²",
        "u = cos(x²)",
        "u = x"
      ],
      "answerIndex": 1,
      "explanation": "u = x²，则 du = 2x dx，原式 = ∫cos(u) du = sin(x²) + C。",
      "remedialSection": "换元后一定要检查 dx 是否完全消失。练习 5 题。"
    },
    "courseId": "ib_math_aa",
    "enTitle": "Integration by Substitution",
    "enBody": "Substitution is a systematic form of the reverse chain rule. Replace the complicated part with u and express dx in terms of du. Example: ∫2x e^(x²) dx with u = x² gives du = 2x dx, so ∫e^u du = e^(x²) + C. Check that dx is fully replaced."
  },
  {
    "id": "ib_ai_i1",
    "chapterId": "ib_math_ai_ch0",
    "title": "正态分布",
    "type": "lecture",
    "body": "正态分布 N(μ, σ²)，μ 为均值，σ 为标准差。68-95-99.7 法则：68% 数据在 μ±σ 内，95% 在 μ±2σ 内，99.7% 在 μ±3σ 内。Z 分数标准化：Z = (X - μ)/σ。",
    "quiz": {
      "question": "About what percentage of data lies within 2 standard deviations of the mean?",
      "options": [
        "68%",
        "95%",
        "99.7%",
        "50%"
      ],
      "answerIndex": 1,
      "explanation": "68-95-99.7 法则：2σ 范围内约 95%。",
      "remedialSection": "画出正态分布图，标出 μ±σ、μ±2σ、μ±3σ 区间。"
    },
    "courseId": "ib_math_ai",
    "enTitle": "The Normal Distribution",
    "enBody": "The normal distribution N(μ, σ²) has mean μ and standard deviation σ. The 68-95-99.7 rule: 68% of data lie within μ±σ, 95% within μ±2σ, 99.7% within μ±3σ. Standardize with the z-score Z = (X - μ)/σ."
  },
  {
    "id": "ib_ai_i2",
    "chapterId": "ib_math_ai_ch0",
    "title": "线性回归",
    "type": "lecture",
    "body": "线性回归 y = ax + b 找到拟合数据的最佳直线。最小化残差平方和。决定系数 r² 反映模型解释能力，r 接近 1 说明线性关系强。若 |r| < 0.3 则线性模型不可靠。",
    "quiz": {
      "question": "A correlation coefficient r = -0.9 indicates:",
      "options": [
        "A strong negative linear relationship",
        "A weak negative relationship",
        "No relationship",
        "A perfect positive relationship"
      ],
      "answerIndex": 0,
      "explanation": "r = -0.9 表示很强的负相关，|r| 接近 1。",
      "remedialSection": "画散点图判断 4 组数据的相关系数正负和强弱。"
    },
    "courseId": "ib_math_ai",
    "enTitle": "Linear Regression",
    "enBody": "Linear regression y = ax + b finds the best-fit line by minimizing the sum of squared residuals. The coefficient of determination r² measures how well the model explains variation; r close to 1 means a strong linear relationship. If |r| < 0.3, the linear model is unreliable."
  },
  {
    "id": "ib_ai_i3",
    "chapterId": "ib_math_ai_ch0",
    "title": "复合增长",
    "type": "lecture",
    "body": "复合增长模型 A = P(1 + r/n)^(nt)。P 是本金，r 是年利率，n 是每年复利次数，t 是年数。r 为负时表示衰减。当 n 趋向无穷时为连续复利：A = P e^(rt)。",
    "quiz": {
      "question": "What does n represent in A = P(1 + r/n)^(nt)?",
      "options": [
        "Interest rate",
        "Number of compounding periods per year",
        "Years",
        "Initial amount"
      ],
      "answerIndex": 1,
      "explanation": "n 是每年复利计算的次数。",
      "remedialSection": "用同一个 P、r、t 分别计算按年、按月、连续复利的结果。"
    },
    "courseId": "ib_math_ai",
    "enTitle": "Compound Growth",
    "enBody": "The compound growth model is A = P(1 + r/n)^(nt), where P is principal, r the annual rate, n the compounding frequency per year, and t the years. A negative r models decay. As n → ∞ we get continuous compounding: A = P e^(rt)."
  },
  {
    "id": "ib_ai_i4",
    "chapterId": "ib_math_ai_ch0",
    "title": "误差传播",
    "type": "lecture",
    "body": "加法模型的误差传播：绝对误差相加。乘法模型的相对误差相加。例：测量长度 L=10±0.1 cm，宽度 W=5±0.1 cm，周长相对误差比面积更容易算。",
    "quiz": {
      "question": "If each measurement has a 1% relative error, multiplying them yields about:",
      "options": [
        "1% error",
        "2% error",
        "0.5% error",
        "10% error"
      ],
      "answerIndex": 1,
      "explanation": "乘法模型中相对误差相加：1% + 1% = 2%。",
      "remedialSection": "分别按加法和乘法计算两组误差传播。"
    },
    "courseId": "ib_math_ai",
    "enTitle": "Error Propagation",
    "enBody": "For additive models, absolute errors add; for multiplicative models, relative errors add. Example: measuring length L = 10±0.1 cm and width W = 5±0.1 cm, the relative error of the perimeter is easier to compute than that of the area."
  },
  {
    "id": "ap_calc_i1",
    "chapterId": "ap_calc_ch0",
    "title": "泰勒级数展开",
    "type": "lecture",
    "body": "泰勒级数在某点展开：f(x) = f(a) + f'(a)(x-a) + f''(a)(x-a)²/2! + ... 麦克劳林展开是 a=0 的特例。对于光滑函数，项数越多近似越精确。",
    "quiz": {
      "question": "The center of a Maclaurin series is:",
      "options": [
        "x = 0",
        "x = 1",
        "x = -1",
        "x = e"
      ],
      "answerIndex": 0,
      "explanation": "麦克劳林级数是以 x=0 为中心的泰勒展开。",
      "remedialSection": "菲多级数基本框架：写出前 5 项，确认系数规律。"
    },
    "courseId": "ap_calc",
    "enTitle": "Taylor Series Expansion",
    "enBody": "A Taylor series expands a function about a point: f(x) = f(a) + f'(a)(x-a) + f''(a)(x-a)²/2! + ... The Maclaurin series is the special case a = 0. For smooth functions, more terms give a more accurate approximation."
  },
  {
    "id": "ap_calc_i2",
    "chapterId": "ap_calc_ch0",
    "title": "收敛半径",
    "type": "lecture",
    "body": "收敛半径 R 决定幂级数收敛范围。比值检验：R = lim |aₙ/aₙ₊₁|。幂级数在 |x-a| < R 内绝对收敛，在 |x-a| > R 处发散，端点需要单独检验。",
    "quiz": {
      "question": "For a power series with convergence radius R = 2 centered at x = 1, the series converges when:",
      "options": [
        "-1 < x < 3",
        "x > 2",
        "x < 1",
        "x = 4"
      ],
      "answerIndex": 0,
      "explanation": "|x-1| < 2 → -1 < x < 3。",
      "remedialSection": "画数轴标出收敛区间，端点 x=-1、x=3 单独检验。"
    },
    "courseId": "ap_calc",
    "enTitle": "Radius of Convergence",
    "enBody": "The radius of convergence R determines where a power series converges. Ratio test: R = lim |aₙ/aₙ₊₁|. The series converges absolutely for |x-a| < R, diverges for |x-a| > R, and the endpoints must be tested separately."
  },
  {
    "id": "ap_calc_i3",
    "chapterId": "ap_calc_ch0",
    "title": "麦克劳林特殊展开",
    "type": "lecture",
    "body": "三个必背麦克劳林展开：eˣ = Σxⁿ/n!，sin x = Σ(-1)ⁿx^(2n+1)/(2n+1)!，cos x = Σ(-1)ⁿx^(2n)/(2n)!。展开时注意正负交错和阶乘分母。",
    "quiz": {
      "question": "The first two nonzero terms of sin x are:",
      "options": [
        "x - x³/6",
        "x + x³/6",
        "x - x²/2",
        "x - x³/3"
      ],
      "answerIndex": 0,
      "explanation": "sin x = x - x³/3! + x⁵/5! - ...，所以前两项是 x - x³/6。",
      "remedialSection": "手写推导 sin x 的前三项，对照公式检查系数。"
    },
    "courseId": "ap_calc",
    "enTitle": "Special Maclaurin Expansions",
    "enBody": "Three must-know Maclaurin expansions: eˣ = Σxⁿ/n!, sin x = Σ(-1)ⁿx^(2n+1)/(2n+1)!, cos x = Σ(-1)ⁿx^(2n)/(2n)!. Watch for alternating signs and factorial denominators."
  },
  {
    "id": "ap_calc_i4",
    "chapterId": "ap_calc_ch0",
    "title": "余项估计",
    "type": "lecture",
    "body": "泰勒余项 Rₙ(x) 衡量多项式近似误差。拉格朗日余项：Rₙ(x) = f^(n+1)(c)(x-a)^(n+1)/(n+1)!，其中 c 在 a 和 x 之间。余项估计用于判断展开截断后的误差上界。",
    "quiz": {
      "question": "To bound the error of a 3rd degree Taylor approximation, you need:",
      "options": [
        "The 4th derivative",
        "The 3rd derivative",
        "The 2nd derivative",
        "The 0th derivative"
      ],
      "answerIndex": 0,
      "explanation": "拉格朗日余项 R₃ 需要用到 n+1=4 阶导数。",
      "remedialSection": "回顾拉格朗日余项公式，代入具体值估算误差。"
    },
    "courseId": "ap_calc",
    "enTitle": "Remainder Estimation",
    "enBody": "The Taylor remainder Rₙ(x) measures the error of a polynomial approximation. Lagrange form: Rₙ(x) = f^(n+1)(c)(x-a)^(n+1)/(n+1)!, where c lies between a and x. Remainder estimates bound the truncation error."
  },
  {
    "id": "ap_stats_i1",
    "chapterId": "ap_stats_ch0",
    "title": "取样方法",
    "type": "lecture",
    "body": "统计推断依赖随机抽样。简单随机抽样每个个体等概率。分层抽样先按特征分层再各层随机抽。整群抽样随机抽若干群再全部调查。方便抽样和自愿样本容易产生偏差。",
    "quiz": {
      "question": "A biased sample is likely produced by:",
      "options": [
        "Simple random sampling",
        "Convenience sampling",
        "Stratified sampling",
        "Cluster sampling"
      ],
      "answerIndex": 1,
      "explanation": "方便抽样只取容易到达的样本，代表性差，容易偏差。",
      "remedialSection": "对比四种抽样方法，各举一个例子。"
    },
    "courseId": "ap_stats",
    "enTitle": "Sampling Methods",
    "enBody": "Statistical inference relies on random sampling. Simple random sampling gives every individual equal probability. Stratified sampling divides by characteristic, then samples each stratum. Cluster sampling randomly selects groups and surveys them entirely. Convenience and voluntary samples are biased."
  },
  {
    "id": "ap_stats_i2",
    "chapterId": "ap_stats_ch0",
    "title": "中心极限定理",
    "type": "lecture",
    "body": "中心极限定理：样本量 n 足够大时，样本均值的抽样分布近似正态，均值等于总体均值 μ，标准差 σ/√n。一般 n ≥ 30 即可满足。该定理是构建置信区间的基础。",
    "quiz": {
      "question": "The standard deviation of the sampling distribution of the mean is:",
      "options": [
        "σ",
        "σ/√n",
        "σ²",
        "nσ"
      ],
      "answerIndex": 1,
      "explanation": "标准误 = σ/√n，n 越大误差越小。",
      "remedialSection": "用中心极限定理理解为何大样本更可靠。"
    },
    "courseId": "ap_stats",
    "enTitle": "The Central Limit Theorem",
    "enBody": "The central limit theorem: when n is large enough, the sampling distribution of the sample mean is approximately normal, with mean equal to the population mean μ and standard deviation σ/√n. In practice n ≥ 30 suffices. It underpins confidence intervals."
  },
  {
    "id": "ap_stats_i3",
    "chapterId": "ap_stats_ch0",
    "title": "置信区间",
    "type": "lecture",
    "body": "置信区间估计总体参数。均值置信区间：样本均值 ± z* × σ/√n。95% 置信度对应 z* = 1.96（近似 2）。置信区间越窄说明估计越精确。",
    "quiz": {
      "question": "For a 95% confidence interval, the critical value z* is approximately:",
      "options": [
        "1.28",
        "1.645",
        "1.96",
        "2.58"
      ],
      "answerIndex": 2,
      "explanation": "95% 置信水平对应的 z* = 1.96。",
      "remedialSection": "理解置信级别的含义：重复抽样中约 95% 的区间包含真值。"
    },
    "courseId": "ap_stats",
    "enTitle": "Confidence Intervals",
    "enBody": "A confidence interval estimates a population parameter. For a mean: sample mean ± z* × σ/√n. A 95% confidence level uses z* = 1.96 (≈ 2). A narrower interval means a more precise estimate."
  },
  {
    "id": "ap_stats_i4",
    "chapterId": "ap_stats_ch0",
    "title": "显著性检验",
    "type": "lecture",
    "body": "假设检验流程：提出原假设 H₀ 和备择假设 H₁ → 计算检验统计量 → 得 p 值 → 与显著性水平 α 比较。p < α 则拒绝 H₀。p 值是\"在原假设为真时观察到此结果的概率\"。",
    "quiz": {
      "question": "If p-value = 0.03 and α = 0.05, you should:",
      "options": [
        "Reject H₀",
        "Fail to reject H₀",
        "Accept H₁",
        "Increase α"
      ],
      "answerIndex": 0,
      "explanation": "p = 0.03 < α = 0.05，结果显著，拒绝原假设。",
      "remedialSection": "区分 p 值含义和假设检验的两类错误。"
    },
    "courseId": "ap_stats",
    "enTitle": "Significance Tests",
    "enBody": "Hypothesis testing: state H₀ and H₁, compute a test statistic, obtain the p-value, and compare it to the significance level α. If p < α, reject H₀. The p-value is the probability of observing such a result if H₀ were true."
  },
  {
    "id": "sat_math_i1",
    "chapterId": "sat_math_ch0",
    "title": "一次函数",
    "type": "lecture",
    "body": "一次函数 y = mx + b，m 是斜率（slope），b 是 y 截距。斜率 = 变化量比 = (y₂-y₁)/(x₂-x₁)。平行线斜率相同，垂直线斜率乘积为 -1。",
    "quiz": {
      "question": "What is the slope of the line through (0,2) and (3,8)?",
      "options": [
        "2",
        "3",
        "6",
        "8/3"
      ],
      "answerIndex": 0,
      "explanation": "m = (8-2)/(3-0) = 6/3 = 2。",
      "remedialSection": "画两点连线，用坐标差计算斜率。"
    },
    "courseId": "sat_math",
    "enTitle": "Linear Functions",
    "enBody": "A linear function is y = mx + b, where m is the slope and b the y-intercept. Slope = change ratio = (y₂-y₁)/(x₂-x₁). Parallel lines share a slope; perpendicular lines have slopes whose product is -1."
  },
  {
    "id": "sat_math_i2",
    "chapterId": "sat_math_ch0",
    "title": "二次函数",
    "type": "lecture",
    "body": "二次函数 y = ax² + bx + c。顶点坐标 x = -b/2a。顶点式为 y = a(x-h)² + k，顶点 (h,k)。开口方向由 a 决定：正向上，负向下。判别式决定与 x 轴交点个数。",
    "quiz": {
      "question": "The vertex of y = 2(x-3)² + 5 is:",
      "options": [
        "(3, 5)",
        "(-3, 5)",
        "(2, 3)",
        "(5, 3)"
      ],
      "answerIndex": 0,
      "explanation": "顶点式 y=a(x-h)²+k 中顶点为 (h,k) = (3,5)。",
      "remedialSection": "把一次函数化成顶点式，确认 h 和 k 的符号。"
    },
    "courseId": "sat_math",
    "enTitle": "Quadratic Functions",
    "enBody": "A quadratic function is y = ax² + bx + c, with vertex x = -b/2a. Vertex form y = a(x-h)² + k has vertex (h,k). The sign of a sets the opening direction (up for positive, down for negative). The discriminant determines the number of x-intercepts."
  },
  {
    "id": "sat_math_i3",
    "chapterId": "sat_math_ch0",
    "title": "三角比",
    "type": "lecture",
    "body": "直角三角形中：sin θ = 对边/斜边，cos θ = 邻边/斜边，tan θ = 对边/邻边。记住 SOH-CAH-TOA。常见值：sin 30° = 1/2，cos 60° = 1/2，tan 45° = 1。",
    "quiz": {
      "question": "In a right triangle, if sin θ = 3/5, the opposite side is:",
      "options": [
        "3",
        "5",
        "4",
        "3/5"
      ],
      "answerIndex": 0,
      "explanation": "sin θ = 对边/斜边，2 通过对边=3，斜边=5。",
      "remedialSection": "用 SOH-CAH-TOA 口诀复习三个三角比的定义。"
    },
    "courseId": "sat_math",
    "enTitle": "Trigonometric Ratios",
    "enBody": "In a right triangle: sin θ = opposite/hypotenuse, cos θ = adjacent/hypotenuse, tan θ = opposite/adjacent. Remember SOH-CAH-TOA. Common values: sin 30° = 1/2, cos 60° = 1/2, tan 45° = 1."
  },
  {
    "id": "sat_math_i4",
    "chapterId": "sat_math_ch0",
    "title": "图表数据分析",
    "type": "lecture",
    "body": "数据分析题：读图时注意坐标轴标签、单位、趋势。平均数易受极端值影响，中位数更稳健。散点散点图关注相关性与离群点。",
    "quiz": {
      "question": "Which measure of central tendency is most affected by extreme values?",
      "options": [
        "Mean",
        "Median",
        "Mode",
        "Range"
      ],
      "answerIndex": 0,
      "explanation": "平均数对极端值敏感，中位数更稳健。",
      "remedialSection": "对比平均数/中位数/众数的适用场景。"
    },
    "courseId": "sat_math",
    "enTitle": "Data Analysis from Graphs",
    "enBody": "When reading graphs, check axis labels, units, and trends. The mean is sensitive to outliers while the median is more robust. In scatter plots, focus on correlation and outliers."
  },
  {
    "id": "sat_write_i1",
    "chapterId": "sat_write_ch0",
    "title": "主谓一致",
    "type": "lecture",
    "body": "主语与谓语单复数必须一致。注意插入语、同位语不影响主语单复数。集合名词（如 team）看作整体用单数，强调成员用复数。Neither...nor 遵循就近原则。",
    "quiz": {
      "question": "Which is correct?",
      "options": [
        "The list of items are long.",
        "The list of items is long.",
        "The list of items were long.",
        "The list, with items, are long."
      ],
      "answerIndex": 1,
      "explanation": "主语是 list（单数），of items 是修饰，谓语用 is。",
      "remedialSection": "划出真正主语再判断单复数。"
    },
    "courseId": "sat_write",
    "enTitle": "Subject-Verb Agreement",
    "enBody": "Subject and verb must agree in number. Parenthetical phrases and appositives do not change the subject's number. Collective nouns like \"team\" take singular when treated as a unit, plural when emphasizing members. \"Neither...nor\" follows the nearest subject."
  },
  {
    "id": "sat_write_i2",
    "chapterId": "sat_write_ch0",
    "title": "标点：逗号与分号",
    "type": "lecture",
    "body": "逗号连接两个独立分句需用连词（FANBOYS）。分号 ; 可直接连接两个相关独立分句，无需连词。冒号 : 引出解释/列表。破折号 —— 表插入或强调。",
    "quiz": {
      "question": "Which correctly joins two independent clauses without a conjunction?",
      "options": [
        "She ran; he walked.",
        "She ran, he walked.",
        "She ran he walked.",
        "She ran: he walked."
      ],
      "answerIndex": 0,
      "explanation": "分号可直接连接两个独立分句。",
      "remedialSection": "分号 vs 逗号+and 用法对比。"
    },
    "courseId": "sat_write",
    "enTitle": "Punctuation: Commas and Semicolons",
    "enBody": "Joining two independent clauses with a comma requires a FANBOYS conjunction. A semicolon (;) can join two related independent clauses without a conjunction. A colon (:) introduces an explanation or list. A dash (—) marks an insertion or emphasis."
  },
  {
    "id": "sat_write_i3",
    "chapterId": "sat_write_ch0",
    "title": "时态一致性",
    "type": "lecture",
    "body": "全文时态需保持一致，除非叙述时间确实改变。叙述过去事件用一般过去时；普遍真理用一般现在时。If 条件句中主将从现：If it rains, we will stay.",
    "quiz": {
      "question": "Choose correct: \"If you study hard, you ___ succeed.\"",
      "options": [
        "will",
        "would",
        "are",
        "were"
      ],
      "answerIndex": 0,
      "explanation": "第一条件句主句用 will + 原形。",
      "remedialSection": "三种条件句时态搭配总结。"
    },
    "courseId": "sat_write",
    "enTitle": "Tense Consistency",
    "enBody": "Keep tenses consistent unless the narrative time actually changes. Use past tense for past events and present for universal truths. In if-conditionals, present in the if-clause pairs with future in the main clause: If it rains, we will stay."
  },
  {
    "id": "sat_write_i4",
    "chapterId": "sat_write_ch0",
    "title": "逻辑衔接词",
    "type": "lecture",
    "body": "however/nevertheless 表转折；therefore/thus/consequently 表因果；furthermore/moreover/in addition 表递进；for example/such as 举例。选词需匹配前后逻辑关系。",
    "quiz": {
      "question": "“He failed twice; ___, he never gave up.” Best word?",
      "options": [
        "therefore",
        "however",
        "for example",
        "meanwhile"
      ],
      "answerIndex": 1,
      "explanation": "前后是转折关系，用 however。",
      "remedialSection": "整理常见衔接词与逻辑关系对应表。"
    },
    "courseId": "sat_write",
    "enTitle": "Logical Transitions",
    "enBody": "however/nevertheless signal contrast; therefore/thus/consequently signal cause-effect; furthermore/moreover/in addition signal addition; for example/such as introduce examples. Choose the transition that matches the logical relationship."
  },
  {
    "id": "igcse_math_i5",
    "chapterId": "igcse_math_ch0",
    "title": "因式分解 quadratics",
    "type": "lecture",
    "body": "二次式 ax²+bx+c 因式分解：找两数积=c、和=b（当 a=1）。例 x²+5x+6=(x+2)(x+3)。a≠1 时用分组或拆项法。",
    "quiz": {
      "question": "Factorise x² - 7x + 12 =",
      "options": [
        "(x-3)(x-4)",
        "(x+3)(x+4)",
        "(x-2)(x-6)",
        "(x-1)(x-12)"
      ],
      "answerIndex": 0,
      "explanation": "-3+(-4)=-7，(-3)(-4)=12。",
      "remedialSection": "练 10 道二次因式分解找规律。"
    },
    "courseId": "igcse_math",
    "enTitle": "Factorising Quadratics",
    "enBody": "To factor ax²+bx+c, find two numbers whose product is c and whose sum is b (when a = 1). Example: x²+5x+6 = (x+2)(x+3). When a ≠ 1, use grouping or splitting the middle term."
  },
  {
    "id": "igcse_math_i6",
    "chapterId": "igcse_math_ch0",
    "title": "三角函数基础",
    "type": "lecture",
    "body": "SOH-CAH-TOA。已知角求边用 sin/cos/tan，反三角求角。注意角度模式（degrees）。正弦定理 a/sinA=b/sinB，余弦定理 c²=a²+b²-2ab cosC。",
    "quiz": {
      "question": "Right triangle with angle 30°, hypotenuse 10, opposite side =?",
      "options": [
        "5",
        "5√3",
        "10",
        "√3"
      ],
      "answerIndex": 0,
      "explanation": "sin30°=1/2，对边=10×1/2=5。",
      "remedialSection": "画直角三角形标角标边再套公式。"
    },
    "courseId": "igcse_math",
    "enTitle": "Basic Trigonometry",
    "enBody": "SOH-CAH-TOA. Use sin/cos/tan to find sides from an angle, and inverse trig to find angles. Check the angle mode (degrees). Sine rule a/sinA = b/sinB; cosine rule c² = a²+b²-2ab cosC."
  },
  {
    "id": "igcse_math_i7",
    "chapterId": "igcse_math_ch0",
    "title": "圆与圆周角定理",
    "type": "lecture",
    "body": "圆心角=2×同弧所对圆周角。直径所对圆周角为 90°。同弧所对圆周角相等。弦心距垂直平分弦。",
    "quiz": {
      "question": "Angle subtended by diameter at circumference =",
      "options": [
        "90°",
        "180°",
        "45°",
        "varies"
      ],
      "answerIndex": 0,
      "explanation": "直径所对圆周角恒为直角。",
      "remedialSection": "画图验证直径圆周角定理。"
    },
    "courseId": "igcse_math",
    "enTitle": "Circle Theorems",
    "enBody": "The angle at the centre is twice the angle at the circumference on the same arc. An angle in a semicircle is 90°. Angles on the same arc are equal. A perpendicular from the centre to a chord bisects it."
  },
  {
    "id": "igcse_math_i8",
    "chapterId": "igcse_math_ch0",
    "title": "概率",
    "type": "lecture",
    "body": "P(A)=有利结果/总结果。互斥事件 P(A∪B)=P(A)+P(B)；独立事件 P(A∩B)=P(A)×P(B)。补事件 P(not A)=1-P(A)。",
    "quiz": {
      "question": "Two fair dice rolled, P(sum=7)=?",
      "options": [
        "6/36",
        "1/6",
        "both 6/36=1/6",
        "5/36"
      ],
      "answerIndex": 2,
      "explanation": "和为7共6种(1,6..6,1)，6/36=1/6。",
      "remedialSection": "列 36 格表确认。"
    },
    "courseId": "igcse_math",
    "enTitle": "Probability",
    "enBody": "P(A) = favourable outcomes / total outcomes. Mutually exclusive events: P(A∪B) = P(A)+P(B). Independent events: P(A∩B) = P(A)×P(B). Complement: P(not A) = 1 - P(A)."
  },
  {
    "id": "igcse_phy_i1",
    "chapterId": "igcse_phy_ch0",
    "title": "运动学公式",
    "type": "lecture",
    "body": "v=u+at，s=ut+½at²，v²=u²+2as。匀速 v=s/t。加速度 a=Δv/t。单位：米、秒、米每秒。",
    "quiz": {
      "question": "Car accelerates from rest at 2 m/s² for 5 s, final speed =",
      "options": [
        "10 m/s",
        "5 m/s",
        "2.5 m/s",
        "25 m/s"
      ],
      "answerIndex": 0,
      "explanation": "v=u+at=0+2×5=10。",
      "remedialSection": "列 SUVAT 五个量对照。"
    },
    "courseId": "igcse_phy",
    "enTitle": "Kinematics Equations",
    "enBody": "v = u + at, s = ut + ½at², v² = u² + 2as. For uniform motion v = s/t. Acceleration a = Δv/t. Units: metres, seconds, metres per second."
  },
  {
    "id": "igcse_phy_i2",
    "chapterId": "igcse_phy_ch0",
    "title": "力与牛顿定律",
    "type": "lecture",
    "body": "F=ma。合力为零则匀速或静止（第一定律）。作用力反作用力等大反向（第三定律）。重力 W=mg。摩擦力阻碍运动。",
    "quiz": {
      "question": "A 2 kg mass accelerates at 3 m/s², net force =",
      "options": [
        "6 N",
        "2/3 N",
        "5 N",
        "1.5 N"
      ],
      "answerIndex": 0,
      "explanation": "F=ma=2×3=6 N。",
      "remedialSection": "区分质量(kg)与重量(N)。"
    },
    "courseId": "igcse_phy",
    "enTitle": "Forces and Newton's Laws",
    "enBody": "F = ma. Zero net force means uniform motion or rest (first law). Action and reaction are equal and opposite (third law). Weight W = mg. Friction opposes motion."
  },
  {
    "id": "igcse_phy_i3",
    "chapterId": "igcse_phy_ch0",
    "title": "能量守恒",
    "type": "lecture",
    "body": "能量不会凭空产生消失，只在形式间转换。动能 KE=½mv²，势能 PE=mgh。功率 P=功/时间=E/t，单位瓦特。",
    "quiz": {
      "question": "Mass 1 kg dropped from 5 m, KE just before ground ≈ (g=10)",
      "options": [
        "50 J",
        "5 J",
        "10 J",
        "500 J"
      ],
      "answerIndex": 0,
      "explanation": "PE=mgh=1×10×5=50J，全转 KE。",
      "remedialSection": "能量转化守恒追踪每一步。"
    },
    "courseId": "igcse_phy",
    "enTitle": "Conservation of Energy",
    "enBody": "Energy is neither created nor destroyed, only converted between forms. Kinetic energy KE = ½mv², potential energy PE = mgh. Power P = work/time = E/t, in watts."
  },
  {
    "id": "igcse_phy_i4",
    "chapterId": "igcse_phy_ch0",
    "title": "电学基础",
    "type": "lecture",
    "body": "V=IR（欧姆定律）。串联电流相同、电压分压；并联电压相同、电流分流。功率 P=VI=I²R=V²/R。",
    "quiz": {
      "question": "Resistor 10Ω with 5V across, current =",
      "options": [
        "0.5 A",
        "2 A",
        "50 A",
        "0.2 A"
      ],
      "answerIndex": 0,
      "explanation": "I=V/R=5/10=0.5A。",
      "remedialSection": "串并联等效电阻公式复习。"
    },
    "courseId": "igcse_phy",
    "enTitle": "Basic Electricity",
    "enBody": "Ohm's law: V = IR. In series, current is the same and voltage divides; in parallel, voltage is the same and current divides. Power P = VI = I²R = V²/R."
  },
  {
    "id": "alevel_math_i1",
    "chapterId": "alevel_math_ch0",
    "title": "微积分求导法则",
    "type": "lecture",
    "body": "d/dx(xⁿ)=nxⁿ⁻¹。链式法则 (f∘g)'=f'(g)g'。乘积法则 (uv)'=u'v+uv'。商法则 (u/v)'=(u'v-uv')/v²。",
    "quiz": {
      "question": "d/dx(x²·sinx)=?",
      "options": [
        "2x·sinx + x²cosx",
        "2x·cosx",
        "x²sinx",
        "2xsinx - x²cosx"
      ],
      "answerIndex": 0,
      "explanation": "乘积法则：(x²)'sinx + x²(sinx)' = 2x sinx + x²cosx。",
      "remedialSection": "逐条默写四大求导法则。"
    },
    "courseId": "alevel_math",
    "enTitle": "Differentiation Rules",
    "enBody": "d/dx(xⁿ) = nxⁿ⁻¹. Chain rule: (f∘g)' = f'(g)g'. Product rule: (uv)' = u'v + uv'. Quotient rule: (u/v)' = (u'v - uv')/v²."
  },
  {
    "id": "alevel_math_i2",
    "chapterId": "alevel_math_ch0",
    "title": "积分技术",
    "type": "lecture",
    "body": "∫xⁿdx=xⁿ⁺¹/(n+1)+C。换元积分 u-substitution；分部积分 ∫u dv=uv-∫v du（选 u 用 LIATE）。定积分得面积。",
    "quiz": {
      "question": "∫₀¹ x² dx =",
      "options": [
        "1/3",
        "1",
        "1/2",
        "2/3"
      ],
      "answerIndex": 0,
      "explanation": "[x³/3]₀¹=1/3。",
      "remedialSection": "分部积分选 u 优先级：对数>逆三角>代数>三角>指数。"
    },
    "courseId": "alevel_math",
    "enTitle": "Integration Techniques",
    "enBody": "∫xⁿdx = xⁿ⁺¹/(n+1) + C. Substitution (u-substitution); integration by parts ∫u dv = uv - ∫v du, choosing u by LIATE. A definite integral gives area."
  },
  {
    "id": "alevel_math_i3",
    "chapterId": "alevel_math_ch0",
    "title": "微分方程",
    "type": "lecture",
    "body": "dy/dx=f(x,y)。可分离变量：移项 dy/g(y)=f(x)dx 再两边积分。解含任意常数 C，用初值确定。一阶线性可用积分因子 e^∫P dx。",
    "quiz": {
      "question": "Solve dy/dx = 2y, y(0)=1 gives:",
      "options": [
        "y=e^{2x}",
        "y=2e^x",
        "y=x²+1",
        "y=e^x"
      ],
      "answerIndex": 0,
      "explanation": "分离变量得 ln|y|=2x+C → y=Ce^{2x}，代入 y(0)=1→C=1。",
      "remedialSection": "分离变量三步：分离、积分、定常数。"
    },
    "courseId": "alevel_math",
    "enTitle": "Differential Equations",
    "enBody": "dy/dx = f(x,y). Separable: rearrange to dy/g(y) = f(x)dx and integrate both sides. The solution contains an arbitrary constant C, fixed by an initial value. First-order linear equations use the integrating factor e^∫P dx."
  },
  {
    "id": "alevel_math_i4",
    "chapterId": "alevel_math_ch0",
    "title": "复数与极坐标",
    "type": "lecture",
    "body": "z=a+bi，模 r=|z|=√(a²+b²)，辐角 θ=arg z。极坐标 z=r(cosθ+i sinθ)=re^{iθ}。棣莫弗定理 (re^{iθ})ⁿ=rⁿe^{inθ}。",
    "quiz": {
      "question": "Modulus of 3+4i =",
      "options": [
        "5",
        "7",
        "12",
        "25"
      ],
      "answerIndex": 0,
      "explanation": "√(3²+4²)=√25=5。",
      "remedialSection": "复平面画图，模=到原点距离。"
    },
    "courseId": "alevel_math",
    "enTitle": "Complex Numbers and Polar Form",
    "enBody": "z = a+bi has modulus r = |z| = √(a²+b²) and argument θ = arg z. Polar form: z = r(cosθ + i sinθ) = re^{iθ}. De Moivre's theorem: (re^{iθ})ⁿ = rⁿe^{inθ}."
  },
  {
    "id": "alevel_phy_i1",
    "chapterId": "alevel_phy_ch0",
    "title": "力学与转动",
    "type": "lecture",
    "body": "力矩 τ=Fr sinθ。转动惯量 I=Σmr²。角加速度 α。转动定律 τ=Iα（类比 F=ma）。",
    "quiz": {
      "question": "Torque from force 10N at perpendicular distance 2m =",
      "options": [
        "20 N·m",
        "5 N·m",
        "12 N·m",
        "2 N·m"
      ],
      "answerIndex": 0,
      "explanation": "τ=Fr=10×2=20（垂直 θ=90°）。",
      "remedialSection": "区分力矩与功的单位虽同为 N·m 含义不同。"
    },
    "courseId": "alevel_phy",
    "enTitle": "Mechanics and Rotation",
    "enBody": "Torque τ = Fr sinθ. Moment of inertia I = Σmr². Angular acceleration α. Rotational analogue of F = ma: τ = Iα."
  },
  {
    "id": "alevel_phy_i2",
    "chapterId": "alevel_phy_ch0",
    "title": "电磁场",
    "type": "lecture",
    "body": "洛伦兹力 F=qv×B。磁场中电荷做圆周运动半径 r=mv/qB。磁通 Φ=BA cosθ。法拉第定律 ε=-dΦ/dt。",
    "quiz": {
      "question": "Induced emf depends on rate of change of:",
      "options": [
        "Magnetic flux",
        "Current",
        "Charge",
        "Resistance"
      ],
      "answerIndex": 0,
      "explanation": "法拉第定律：电动势正比于磁通变化率。",
      "remedialSection": "右手定则与楞次定律判断感应方向。"
    },
    "courseId": "alevel_phy",
    "enTitle": "Electromagnetic Fields",
    "enBody": "Lorentz force F = qv×B. A charge in a magnetic field moves in a circle of radius r = mv/qB. Magnetic flux Φ = BA cosθ. Faraday's law: ε = -dΦ/dt."
  },
  {
    "id": "alevel_phy_i3",
    "chapterId": "alevel_phy_ch0",
    "title": "量子物理",
    "type": "lecture",
    "body": "光子能量 E=hf=hc/λ。光电效应阈值频率。德布罗意波长 λ=h/p。能级跃迁释放光子 hf=E₂-E₁。",
    "quiz": {
      "question": "Photon energy formula:",
      "options": [
        "E=hf",
        "E=mc²",
        "E=½mv²",
        "E=IR"
      ],
      "answerIndex": 0,
      "explanation": "光子能量 E=hf（普朗克关系）。",
      "remedialSection": "光电效应三条实验规律对应解释。"
    },
    "courseId": "alevel_phy",
    "enTitle": "Quantum Physics",
    "enBody": "Photon energy E = hf = hc/λ. The photoelectric effect has a threshold frequency. De Broglie wavelength λ = h/p. A transition between energy levels releases a photon hf = E₂ - E₁."
  },
  {
    "id": "alevel_phy_i4",
    "chapterId": "alevel_phy_ch0",
    "title": "核物理",
    "type": "lecture",
    "body": "α衰变放氦核，β衰变中子变质子放电子。半衰期 T½。结合能=把核拆散所需能量，越大越稳定。质量亏损 ΔE=Δmc²。",
    "quiz": {
      "question": "In β⁻ decay, a neutron becomes:",
      "options": [
        "proton + electron + antineutrino",
        "proton only",
        "2 protons",
        "alpha particle"
      ],
      "answerIndex": 0,
      "explanation": "n→p+e⁻+反中微子。",
      "remedialSection": "守恒电荷、重子数、轻子数。"
    },
    "courseId": "alevel_phy",
    "enTitle": "Nuclear Physics",
    "enBody": "Alpha decay emits a helium nucleus; beta decay converts a neutron to a proton and emits an electron. Half-life T½. Binding energy is the energy needed to split a nucleus — the larger, the more stable. Mass defect: ΔE = Δmc²."
  },
  {
    "id": "ib_math_i1",
    "chapterId": "ib_math_ch0",
    "title": "向量与几何",
    "type": "lecture",
    "body": "向量点积 a·b=|a||b|cosθ，用于判垂直（=0）求夹角。叉积模=|a||b|sinθ=平行四边形面积。向量方程直线 r=a+tb。",
    "quiz": {
      "question": "Two vectors perpendicular ⟹ dot product =",
      "options": [
        "0",
        "1",
        "|a||b|",
        "-1"
      ],
      "answerIndex": 0,
      "explanation": "垂直 ⟹ cos90°=0 ⟹ 点积为 0。",
      "remedialSection": "向量三种运算（加减点叉）各自几何意义。"
    },
    "courseId": "ib_math",
    "enTitle": "Vectors and Geometry",
    "enBody": "The dot product a·b = |a||b|cosθ tests perpendicularity (= 0) and finds angles. The magnitude of the cross product = |a||b|sinθ, the parallelogram area. A line has vector equation r = a + tb."
  },
  {
    "id": "ib_math_i2",
    "chapterId": "ib_math_ch0",
    "title": "矩阵与变换",
    "type": "lecture",
    "body": "矩阵乘法不可交换。行列式 det 衡量面积缩放。2×2 det=ad-bc。逆矩阵存在当且仅当 det≠0。旋转/缩放/反射对应特定矩阵。",
    "quiz": {
      "question": "det[[2,0],[0,3]]=",
      "options": [
        "6",
        "5",
        "0",
        "-6"
      ],
      "answerIndex": 0,
      "explanation": "ad-bc=2×3-0=6。",
      "remedialSection": "行列式几何=变换后单位面积倍数。"
    },
    "courseId": "ib_math",
    "enTitle": "Matrices and Transformations",
    "enBody": "Matrix multiplication is not commutative. The determinant measures area scaling; for 2×2, det = ad-bc. An inverse exists iff det ≠ 0. Rotations, scalings, and reflections correspond to specific matrices."
  },
  {
    "id": "ib_math_i3",
    "chapterId": "ib_math_ch0",
    "title": "微积分进阶",
    "type": "lecture",
    "body": "隐函数求导对两边关于 x 求导并把 y' 保留。参数方程 dy/dx=(dy/dt)/(dx/dt)。泰勒展开 f(a+h)=f(a)+hf'+h²/2 f''+...",
    "quiz": {
      "question": "Parametric x=t²,y=t³ → dy/dx =",
      "options": [
        "3t/2",
        "3t²",
        "2/(3t)",
        "t"
      ],
      "answerIndex": 0,
      "explanation": "dy/dt=3t², dx/dt=2t → (3t²)/(2t)=3t/2。",
      "remedialSection": "参数二阶导公式再复习。"
    },
    "courseId": "ib_math",
    "enTitle": "Advanced Calculus",
    "enBody": "For implicit differentiation, differentiate both sides with respect to x and keep y'. For parametric equations, dy/dx = (dy/dt)/(dx/dt). Taylor: f(a+h) = f(a) + hf' + h²/2 f'' + ..."
  },
  {
    "id": "ib_math_i4",
    "chapterId": "ib_math_ch0",
    "title": "概率分布",
    "type": "lecture",
    "body": "二项分布 X~B(n,p)，均值 np、方差 np(1-p)。泊松 X~Po(λ) 均值=方差=λ。正态分布 Z=(X-μ)/σ 标准化。",
    "quiz": {
      "question": "X~B(10,0.3), mean =",
      "options": [
        "3",
        "7",
        "2.1",
        "0.3"
      ],
      "answerIndex": 0,
      "explanation": "均值=np=10×0.3=3。",
      "remedialSection": "二项和泊松适用场景对比。"
    },
    "courseId": "ib_math",
    "enTitle": "Probability Distributions",
    "enBody": "Binomial X~B(n,p) has mean np and variance np(1-p). Poisson X~Po(λ) has mean = variance = λ. Normal: standardize with Z = (X-μ)/σ."
  },
  {
    "id": "ib_phy_i1",
    "chapterId": "ib_phy_ch0",
    "title": "测量与误差",
    "type": "lecture",
    "body": "绝对误差 ±δ，相对误差=δ/值，百分误差=相对×100%。多次测量减小随机误差。系统误差来源固定偏置。有效数字按最不精确数据定。",
    "quiz": {
      "question": "Measure 5.2±0.1 cm, relative uncertainty ≈",
      "options": [
        "1.9%",
        "0.1%",
        "5%",
        "10%"
      ],
      "answerIndex": 0,
      "explanation": "0.1/5.2≈0.019=1.9%。",
      "remedialSection": "误差传播规则（乘除取相对、加减取绝对）。"
    },
    "courseId": "ib_phy",
    "enTitle": "Measurement and Uncertainty",
    "enBody": "Absolute uncertainty ±δ, relative uncertainty = δ/value, percentage = relative × 100%. Repeated measurements reduce random error. Systematic error is a fixed bias. Significant figures follow the least precise datum."
  },
  {
    "id": "ib_phy_i2",
    "chapterId": "ib_phy_ch0",
    "title": "热力学",
    "type": "lecture",
    "body": "第一定律 ΔU=Q-W（吸热增内能，对外做功减）。理想气体 PV=nRT。等温过程 ΔU=0故 Q=W。熵增原理。",
    "quiz": {
      "question": "Ideal gas isothermal expansion: ΔU =",
      "options": [
        "0",
        "positive",
        "negative",
        "PV"
      ],
      "answerIndex": 0,
      "explanation": "理想气体内能只与温度有关，等温 ΔT=0 ⟹ ΔU=0。",
      "remedialSection": "四种过程（等温/等压/等容/绝热）能量流梳理。"
    },
    "courseId": "ib_phy",
    "enTitle": "Thermodynamics",
    "enBody": "First law ΔU = Q - W (heat in raises internal energy; work out lowers it). Ideal gas PV = nRT. Isothermal process: ΔU = 0 so Q = W. Entropy never decreases in an isolated system."
  },
  {
    "id": "ib_phy_i3",
    "chapterId": "ib_phy_ch0",
    "title": "波与干涉",
    "type": "lecture",
    "body": "相长干涉路径差=nλ，相消=(n+½)λ。驻波两端固定节点间距 λ/2。多普勒频移观察靠近频率升高。折射 n₁sinθ₁=n₂sinθ₂。",
    "quiz": {
      "question": "Destructive interference path difference =",
      "options": [
        "(n+½)λ",
        "nλ",
        "2nλ",
        "λ/4 only"
      ],
      "answerIndex": 0,
      "explanation": "半波长奇数倍导致相消。",
      "remedialSection": "双缝干涉条纹间距公式 Δx=λL/d。"
    },
    "courseId": "ib_phy",
    "enTitle": "Waves and Interference",
    "enBody": "Constructive interference: path difference = nλ; destructive = (n+½)λ. Standing waves have nodes spaced λ/2 apart. Doppler shift: approaching source raises frequency. Refraction: n₁sinθ₁ = n₂sinθ₂."
  },
  {
    "id": "ib_phy_i4",
    "chapterId": "ib_phy_ch0",
    "title": "相对论基础",
    "type": "lecture",
    "body": "光速不变原理。时间膨胀 Δt=γΔt₀，长度收缩 L=L₀/γ，γ=1/√(1-v²/c²)。质能 E=mc²，总能量 E=γmc²。",
    "quiz": {
      "question": "Lorentz factor γ for v→c approaches",
      "options": [
        "∞",
        "1",
        "0",
        "c"
      ],
      "answerIndex": 0,
      "explanation": "分母趋零，γ→∞。",
      "remedialSection": "双生子佯谬定性理解。"
    },
    "courseId": "ib_phy",
    "enTitle": "Introduction to Relativity",
    "enBody": "The speed of light is invariant. Time dilation Δt = γΔt₀, length contraction L = L₀/γ, with γ = 1/√(1-v²/c²). Mass-energy E = mc²; total energy E = γmc²."
  },
  {
    "id": "toefl_b1_i1",
    "courseId": "toefl_b1",
    "chapterId": "toefl_b1_ch0",
    "title": "听力主旨题：抓教授开场句",
    "body": "托福讲座的第一句话通常就是主旨。教授常会说\"Today I want to talk about...\"或\"Let's begin with...\"，后面紧跟的就是主旨题答案。练习时养成记第一句的习惯。",
    "quiz": {
      "question": "教授说 \"Today we'll look at how coral reefs form\"，这最可能对应什么题型？",
      "options": [
        "细节题",
        "主旨题",
        "态度题",
        "推断题"
      ],
      "answerIndex": 1,
      "explanation": "开场句直接点明讲座主题，是典型的组织主旨题信号。"
    },
    "type": "lecture",
    "enTitle": "Main Idea Questions: Catch the Opening",
    "enBody": "The first sentence of a TOEFL lecture is usually the main idea. Professors often say \"Today I want to talk about...\" or \"Let's begin with...\", and what follows is the answer to the gist question. Practise noting the first sentence."
  },
  {
    "id": "toefl_b1_i2",
    "courseId": "toefl_b1",
    "chapterId": "toefl_b1_ch0",
    "title": "听力连接词：信号即答案",
    "body": "but / however / in contrast / on the other hand 之后的内容几乎必考。托福出题人习惯把答案放在转折之后，听到这类词要立刻标记。同样，first / second / finally 表示并列结构，常对应表格题。",
    "quiz": {
      "question": "听到 \"however, recent studies show the opposite\"，答案最可能在哪？",
      "options": [
        "however 之前",
        "however 之后",
        "开头第一句",
        "教授举例时"
      ],
      "answerIndex": 1,
      "explanation": "转折词之后才是出题人想强调的新观点，是考点集中区。"
    },
    "type": "lecture",
    "enTitle": "Listening Connectives: Signals Are Answers",
    "enBody": "Content after \"but / however / in contrast / on the other hand\" is almost always tested. Test writers place answers after contrast markers — mark them immediately. Similarly, \"first / second / finally\" signal parallel structure, often matching table questions."
  },
  {
    "id": "toefl_b1_i3",
    "courseId": "toefl_b1",
    "chapterId": "toefl_b1_ch0",
    "title": "阅读事实信息题：关键词回文",
    "body": "事实信息题（Factual Information）的做法是：题干取专有名词或数字回原文定位，答案往往是原文的同义改写而非原词照抄。找不到定位词就不要硬选。",
    "quiz": {
      "question": "做事实信息题第一步应该做什么？",
      "options": [
        "通读全文",
        "把选项代入验证",
        "从题干提取关键词回原文定位",
        "猜测作者态度"
      ],
      "answerIndex": 2,
      "explanation": "先定位再比对，是这类题唯一稳定高效的做法。"
    },
    "type": "lecture",
    "enTitle": "Factual Information: Keyword Scanning",
    "enBody": "For factual information questions, take a proper noun or number from the question to locate the passage. The answer is usually a paraphrase rather than a verbatim match. If you cannot find the anchor, do not force an answer."
  },
  {
    "id": "toefl_b1_i4",
    "courseId": "toefl_b1",
    "chapterId": "toefl_b1_ch0",
    "title": "口语 Task 1：15 秒构思模板",
    "body": "独立口语第一题只有 15 秒准备。推荐模板：亮观点（I think...）+ 一个理由 + 一个具体例子。宁可说得简单完整，也不要堆复杂句导致卡顿。",
    "quiz": {
      "question": "口语 Task 1 准备时间是多少？",
      "options": [
        "15 秒",
        "30 秒",
        "45 秒",
        "60 秒"
      ],
      "answerIndex": 0,
      "explanation": "Task 1 准备 15 秒，答题 45 秒，时间管理很关键。"
    },
    "type": "lecture",
    "enTitle": "Speaking Task 1: The 15-Second Plan",
    "enBody": "Independent speaking Task 1 gives only 15 seconds to prepare. Use a template: state your opinion (\"I think...\") + one reason + one specific example. Prefer simple, complete speech over complex sentences that cause hesitation."
  },
  {
    "id": "ielts_listening_i2",
    "courseId": "ielts_listening",
    "chapterId": "ielts_listening_ch0",
    "title": "填空题：预判词性与单复数",
    "body": "听录音前先读题，预判空格处需要名词、数字还是形容词，以及是否可数。录音中一旦出现复数 \"s\" 没听清，就要靠语法判断，漏写 \"s\" 算错。",
    "quiz": {
      "question": "填空题答案 \"books\"，只写了 \"book\" 会怎样？",
      "options": [
        "不扣分",
        "扣分，单复数算错",
        "由考官决定",
        "算半分"
      ],
      "answerIndex": 1,
      "explanation": "雅思拼写必须准确，单复数错误就是答案错误。"
    },
    "type": "lecture",
    "enTitle": "Form Completion: Predict Part of Speech",
    "enBody": "Before the audio, read the question and predict whether the blank needs a noun, a number, or an adjective, and whether it is countable. If you miss the plural \"s\" in the recording, use grammar to decide — omitting \"s\" is marked wrong."
  },
  {
    "id": "ielts_listening_i3",
    "courseId": "ielts_listening",
    "chapterId": "ielts_listening_ch0",
    "title": "地图题：方位词速记",
    "body": "地图题高频词：opposite = 对面、next to = 相邻、at the end of = 尽头、behind = 背后、between A and B = 两者之间。听到方位词立刻在图上标出位置，不要等听完再画。",
    "quiz": {
      "question": "听到 \"the bank is opposite the library\"，银行在图书馆的哪里？",
      "options": [
        "旁边",
        "里面",
        "对面",
        "尽头"
      ],
      "answerIndex": 2,
      "explanation": "opposite 就是正对面，是地图题最高频方位词之一。"
    },
    "type": "lecture",
    "enTitle": "Map Questions: Direction Words",
    "enBody": "High-frequency map words: opposite, next to, at the end of, behind, between A and B. As soon as you hear a direction word, mark the position on the map; do not wait until the audio ends."
  },
  {
    "id": "ielts_listening_i4",
    "courseId": "ielts_listening",
    "chapterId": "ielts_listening_ch0",
    "title": "多选题：答案往往分散出现",
    "body": "雅思多选题的正确答案通常分散在整段录音里，而不是连在一起。因此听到一个就选一个，不要等\"全部说完\"，否则容易漏听后续选项。",
    "quiz": {
      "question": "多选题答案的出现规律更接近？",
      "options": [
        "集中连续出现",
        "分散在整段录音中",
        "只在开头",
        "只在结尾"
      ],
      "answerIndex": 1,
      "explanation": "多选答案分散是雅思听力的常见设计，需边听边标记。"
    },
    "type": "lecture",
    "enTitle": "Multiple Choice: Answers Are Spread Out",
    "enBody": "In IELTS multiple choice, correct answers are usually scattered across the recording, not grouped together. So select an answer as soon as you hear it rather than waiting for all options to be covered, or you will miss later ones."
  },
  {
    "id": "ielts_speaking_i1",
    "courseId": "ielts_speaking",
    "chapterId": "ielts_speaking_ch0",
    "title": "Part 1：回答最少拉满 3 句",
    "body": "Part 1 最常见错误是只答 Yes/No。考官问 \"Do you like reading?\"，至少要给 观点 + 原因 + 补充。例如：\"Yes, I do, because it helps me relax. I usually read before bed, especially fiction.\" 控制在 15-20 秒完成。",
    "quiz": {
      "question": "Part 1 回答 \"Do you like music?\" 最合理的长度是？",
      "options": [
        "只说 Yes, I do",
        "观点+原因+一句补充",
        "讲一个完整故事",
        "背诵一段模板"
      ],
      "answerIndex": 1,
      "explanation": "Part 1 不是展示长篇大论，而是自然交谈，3 句左右最合适。"
    },
    "type": "lecture",
    "enTitle": "Part 1: Always Give at Least 3 Sentences",
    "enBody": "The most common Part 1 mistake is answering only Yes/No. If asked \"Do you like reading?\", give opinion + reason + extra detail. Example: \"Yes, I do, because it helps me relax. I usually read before bed, especially fiction.\" Aim for 15-20 seconds."
  },
  {
    "id": "ielts_speaking_i2",
    "courseId": "ielts_speaking",
    "chapterId": "ielts_speaking_ch0",
    "title": "Part 2：1 分钟准备只记关键词",
    "body": "拿到卡片后，不要写整句甚至背下来。1 分钟只够写提示词：谁、什么时候、在哪里、做了什么、感受如何。每个点写 2-3 个单词，说的时候自然展开。",
    "quiz": {
      "question": "Part 2 的 1 分钟准备时间最应该做什么？",
      "options": [
        "写完整回答并背诵",
        "只写关键词和要点",
        "反复读卡片题目",
        "什么都不写直接开口"
      ],
      "answerIndex": 1,
      "explanation": "写关键词能帮你组织逻辑，又不会因为盯着稿子而卡壳。"
    },
    "type": "lecture",
    "enTitle": "Part 2: Note Only Keywords",
    "enBody": "Do not write full sentences or memorise. One minute is only enough for cues: who, when, where, what you did, how you felt. Write 2-3 words per point and expand naturally as you speak."
  },
  {
    "id": "ielts_speaking_i3",
    "courseId": "ielts_speaking",
    "chapterId": "ielts_speaking_ch0",
    "title": "Part 3：观点 + 解释 + 例子",
    "body": "Part 3 考察抽象讨论能力。每个回答尽量用 PEE 结构：Point（观点）→ Explanation（解释）→ Example（例子）。考官追问时要敢于调整观点，先说 \"That's interesting, I haven't thought about it that way...\" 争取思考时间。",
    "quiz": {
      "question": "Part 3 被打断追问时，最不推荐的做法是？",
      "options": [
        "承认问题有难度",
        "坚持原观点并解释",
        "马上改口说自己没想过",
        "用连接词争取时间"
      ],
      "answerIndex": 2,
      "explanation": "改口太快显得立场不坚定，应先大方回应再加说明。"
    },
    "type": "lecture",
    "enTitle": "Part 3: Point + Explanation + Example",
    "enBody": "Part 3 tests abstract discussion. Use the PEE structure: Point → Explanation → Example. When pressed, adjust your view and buy time with \"That's interesting, I haven't thought about it that way...\""
  },
  {
    "id": "ielts_speaking_i4",
    "courseId": "ielts_speaking",
    "chapterId": "ielts_speaking_ch0",
    "title": "流利度：宁用简单词不卡壳",
    "body": "口语评分里 Fluency and Coherence 权重最高。与其憋一个高级词，不如用熟悉的词说顺。遇到想不起的词汇，用 \"It's a kind of...\" / \"You know...\" 绕过，避免长时间停顿。",
    "quiz": {
      "question": "说到一半找不到合适的词时，下列哪种处理最加分？",
      "options": [
        "停下来沉默想 10 秒",
        "用解释性语句绕过去",
        "直接跳回开头重新说",
        "不断重复刚才的话"
      ],
      "answerIndex": 1,
      "explanation": "自然绕过显示了交流能力，长时间沉默会严重扣流利度分。"
    },
    "type": "lecture",
    "enTitle": "Fluency: Prefer Simple Words Over Hesitation",
    "enBody": "Fluency and Coherence carry the most weight in speaking. Rather than straining for an advanced word, use familiar words to speak smoothly. If a word escapes you, bridge with \"It's a kind of...\" or \"You know...\" to avoid long pauses."
  },
  {
    "id": "ielts_reading_i1",
    "courseId": "ielts_reading",
    "chapterId": "ielts_reading_ch0",
    "title": "段落标题题：首末句定位法",
    "body": "List of Headings 题先读每段第一句和最后一句，概述段落主题。多个段落一个标题时，靠转折词和重复出现的名词做区分。不要先读选项，否则浪费时间。",
    "quiz": {
      "question": "做段落标题题时，下一步最推荐？",
      "options": [
        "先精读全部选项",
        "读每段首末句",
        "从文章最后一段倒着读",
        "先做其他题型"
      ],
      "answerIndex": 1,
      "explanation": "首末句通常包含主题句，能快速匹配标题。"
    },
    "type": "lecture",
    "enTitle": "Headings: First and Last Sentence Method",
    "enBody": "For List of Headings, read the first and last sentence of each paragraph to summarise the topic. When one heading fits several paragraphs, distinguish them by transition words and repeated nouns. Do not read the options first — it wastes time."
  },
  {
    "id": "ielts_reading_i2",
    "courseId": "ielts_reading",
    "chapterId": "ielts_reading_ch0",
    "title": "T/F/NG：不要主观推断",
    "body": "True/False/Not Given 的核心是严格基于原文。False 是原文明确否定，Not Given 是原文没提或无法从原文推出。很多考生把 Not Given 误判成 False，因为自己的常识觉得“不对”。",
    "quiz": {
      "question": "原文只说 \"The museum charges a fee\"，题目说 \"The museum is free\"。判断？",
      "options": [
        "True",
        "False",
        "Not Given",
        "无法判断"
      ],
      "answerIndex": 1,
      "explanation": "charge a fee 与 free 明确相反，是 False 而非 Not Given。"
    },
    "type": "lecture",
    "enTitle": "True/False/Not Given: Avoid Inference",
    "enBody": "The core of T/F/NG is strict reliance on the text. False means the passage explicitly contradicts; Not Given means the passage does not mention it or it cannot be inferred. Many test-takers mark Not Given as False because common sense says \"wrong\"."
  },
  {
    "id": "ielts_reading_i3",
    "courseId": "ielts_reading",
    "chapterId": "ielts_reading_ch0",
    "title": "填空题：同义改写是核心",
    "body": "雅思阅读填空几乎不直接抄原文，答案会被同义替换。例如 \"expensive\" 替换成 \"costly\"，\"rise\" 替换成 \"increase\"。做题时先定位原句，再找与题干语境一致的词。",
    "quiz": {
      "question": "原文 \"children often find it hard to concentrate\"，题干 \"Young pupils may struggle with ______\"，空格应填？",
      "options": [
        "concentration",
        "children",
        "hard",
        "struggle"
      ],
      "answerIndex": 0,
      "explanation": "find it hard to concentrate = struggle with concentration，名词化替换。"
    },
    "type": "lecture",
    "enTitle": "Gap-Fill: Paraphrasing Is the Key",
    "enBody": "IELTS gap-fill rarely copies the passage verbatim — answers are paraphrased. For example \"expensive\" becomes \"costly\", \"rise\" becomes \"increase\". First locate the original sentence, then find the word that matches the question context."
  },
  {
    "id": "ielts_reading_i4",
    "courseId": "ielts_reading",
    "chapterId": "ielts_reading_ch0",
    "title": "Heading 匹配：小心 NB 选项复用",
    "body": "题目说明里若有 \"NB You may use any heading more than once\"，意味着至少有一个标题会被用两次。此时不要把已选过的标题划掉，反而要留意哪些标题像多余项。",
    "quiz": {
      "question": "看到 \"NB You may use any heading more than once\"，正确策略是？",
      "options": [
        "每个标题只能用一次",
        "有标题会重复使用",
        "选项比段落多",
        "heading 按文章顺序排列"
      ],
      "answerIndex": 1,
      "explanation": "NB 明确提示可重复，这是出题人故意设置的陷阱。"
    },
    "type": "lecture",
    "enTitle": "Heading Matching: Watch the NB Note",
    "enBody": "If the instructions say \"NB You may use any heading more than once\", at least one heading is used twice. Do not cross out headings you have already used; instead, watch which headings look like surplus items."
  },
  {
    "id": "ielts_writing_i1",
    "courseId": "ielts_writing",
    "chapterId": "ielts_writing_ch0",
    "title": "Task 1：只描述客观数据",
    "body": "小作文是 data reporting，不是议论文。不要写 \"I think the reason is...\"。结构：开头改写题干 → 选主要趋势 → 细节点 → 对比。注意时态根据图表年份用过去式或现在时。",
    "quiz": {
      "question": "Task 1 图表作文里，哪句话是得分的？",
      "options": [
        "The number increased significantly.",
        "The increase is because people earn more.",
        "I think the trend is good.",
        "This chart is very important."
      ],
      "answerIndex": 0,
      "explanation": "客观描述数据变化最符合 Task 1 要求，主观原因或评论不得分。"
    },
    "type": "lecture",
    "enTitle": "Task 1: Describe Objective Data Only",
    "enBody": "Task 1 is data reporting, not an argumentative essay. Do not write \"I think the reason is...\". Structure: paraphrase the question, select the main trends, add detail, then compare. Match tense to the chart's years (past or present)."
  },
  {
    "id": "ielts_writing_i2",
    "courseId": "ielts_writing",
    "chapterId": "ielts_writing_ch0",
    "title": "Task 2：4 段式稳拿结构分",
    "body": "大作文推荐 4 段：Introduction 改写题干+亮立场；Body 1 第一论点；Body 2 第二论点（可让步）；Conclusion 总结。每段开头用 topic sentence 统领，段落内要用例子或因果支撑。",
    "quiz": {
      "question": "Task 2 大作文最稳妥的段落结构是？",
      "options": [
        "2 段：观点+例子",
        "3 段：开头+一段论述+结尾",
        "4 段：开头+两主体+结尾",
        "5 段以上自由发挥"
      ],
      "answerIndex": 2,
      "explanation": "4 段式逻辑完整、结构清晰，是高分模板。"
    },
    "type": "lecture",
    "enTitle": "Task 2: The Four-Paragraph Structure",
    "enBody": "Use four paragraphs: Introduction (paraphrase + stance); Body 1 (first argument); Body 2 (second argument, possibly a concession); Conclusion (summary). Open each paragraph with a topic sentence and support it with examples or cause-effect."
  },
  {
    "id": "ielts_writing_i3",
    "courseId": "ielts_writing",
    "chapterId": "ielts_writing_ch0",
    "title": "连贯性：指代词与连接词搭配",
    "body": "Coherence and Cohesion 评分维度要求句子间自然连接。多用 this / these / such 指代前文，用 however / therefore / for example 标志逻辑关系，但不要每个句子都加连接词，否则显得生硬。",
    "quiz": {
      "question": "下列哪种衔接手法最自然？",
      "options": [
        "Every sentence starts with \"Moreover\"",
        "Use \"it\" and \"this\" to refer back",
        "Copy the same word in every sentence",
        "Avoid all linking words"
      ],
      "answerIndex": 1,
      "explanation": "适当使用指代词和连接词，避免机械重复。"
    },
    "type": "lecture",
    "enTitle": "Cohesion: Pronouns with Connectives",
    "enBody": "Coherence and Cohesion require natural links between sentences. Use this / these / such to refer back, and however / therefore / for example to signal logic — but do not start every sentence with a connective, or it feels mechanical."
  },
  {
    "id": "ielts_writing_i4",
    "courseId": "ielts_writing",
    "chapterId": "ielts_writing_ch0",
    "title": "语法多样性：从句的正确使用",
    "body": "想拿 7 分以上，必须展示复杂句：定语从句、状语从句、虚拟语气。但前提是准确。一句 \"If I were you, I would agree\" 胜过三句错误的长难句。写完检查主谓一致和时态。",
    "quiz": {
      "question": "下面哪句语法最正确且能体现多样性？",
      "options": [
        "He go to school yesterday.",
        "If he had studied harder, he would have passed.",
        "I very like it because it is very good thing.",
        "There are many reasons, for example, traffic."
      ],
      "answerIndex": 1,
      "explanation": "条件句表达准确，展示了虚拟语气的使用能力。"
    },
    "type": "lecture",
    "enTitle": "Grammatical Range: Using Clauses Correctly",
    "enBody": "For a 7+, show complex structures: relative clauses, adverbial clauses, subjunctive. But accuracy comes first. One correct \"If I were you, I would agree\" beats three broken long sentences. Check subject-verb agreement and tense when you finish."
  },
  {
    "id": "ap_calc_i5",
    "courseId": "ap_calc",
    "chapterId": "ap_calc_ch0",
    "type": "lecture",
    "title": "隐函数求导",
    "enTitle": "Implicit Differentiation",
    "body": "隐函数是 y 没有显式解出的方程，如 x²+y²=25。求导时对两边关于 x 求导，遇到 y 的项用链式法则补 dy/dx，再解出 dy/dx。例：对 x²+y²=25 求导得 2x+2y·dy/dx=0，故 dy/dx=-x/y。",
    "enBody": "In an implicit equation like x²+y²=25, differentiate both sides with respect to x, applying the chain rule to y-terms, then solve for dy/dx. For x²+y²=25: 2x+2y·dy/dx=0, so dy/dx=-x/y.",
    "quiz": {
      "question": "For x²+y²=25, dy/dx equals:",
      "options": [
        "x/y",
        "-x/y",
        "y/x",
        "-y/x"
      ],
      "answerIndex": 1,
      "explanation": "Differentiating gives 2x+2y·dy/dx=0, so dy/dx=-x/y."
    }
  },
  {
    "id": "ap_calc_i6",
    "courseId": "ap_calc",
    "chapterId": "ap_calc_ch0",
    "type": "lecture",
    "title": "相关变化率",
    "enTitle": "Related Rates",
    "body": "相关变化率问题：一个量变化时另一个量跟着变。做法：写出几何关系式 → 两边对时间 t 求导 → 代入已知量求未知速率。例：圆的面积 A=πr²，dr/dt=2，则 dA/dt=2πr·dr/dt。",
    "enBody": "In related rates, one quantity changes as another changes. Write the geometric relation, differentiate both sides with respect to time t, then substitute known values. Example: for A=πr² with dr/dt=2, dA/dt=2πr·dr/dt.",
    "quiz": {
      "question": "For A=πr² with r=3 and dr/dt=2, dA/dt is:",
      "options": [
        "6π",
        "12π",
        "18π",
        "4π"
      ],
      "answerIndex": 1,
      "explanation": "dA/dt=2πr·dr/dt=2π(3)(2)=12π."
    }
  },
  {
    "id": "ap_calc_i7",
    "courseId": "ap_calc",
    "chapterId": "ap_calc_ch0",
    "type": "lecture",
    "title": "函数的极值与最值",
    "enTitle": "Extrema and Optimization",
    "body": "求极值：先求 f'(x)=0 的临界点，再用二阶导判定（f''>0 极小，f''<0 极大）。最值问题要把端点和临界点都代入比较。应用题先列目标函数，再求导找最值。",
    "enBody": "To find extrema, solve f'(x)=0 for critical points, then use the second derivative (f''>0 min, f''<0 max). For absolute extrema, check endpoints too. In optimization, set up the objective function, then differentiate.",
    "quiz": {
      "question": "If f'(c)=0 and f''(c)>0, the point c is a:",
      "options": [
        "local maximum",
        "local minimum",
        "inflection point",
        "discontinuity"
      ],
      "answerIndex": 1,
      "explanation": "f''>0 means the function is concave up, so c is a local minimum."
    }
  },
  {
    "id": "ap_calc_i8",
    "courseId": "ap_calc",
    "chapterId": "ap_calc_ch0",
    "type": "lecture",
    "title": "洛必达法则",
    "enTitle": "L'Hôpital's Rule",
    "body": "洛必达法则用于 0/0 或 ∞/∞ 型极限：lim f(x)/g(x) = lim f'(x)/g'(x)。注意：必须先确认是 0/0 或 ∞/∞ 型，否则不能用。例：lim(x→0) sin x/x = lim cos x/1 = 1。",
    "enBody": "L'Hôpital's rule handles 0/0 or ∞/∞ limits: lim f(x)/g(x) = lim f'(x)/g'(x). You must first confirm the indeterminate form. Example: lim(x→0) sin x/x = lim cos x/1 = 1.",
    "quiz": {
      "question": "lim(x→0) sin x/x equals:",
      "options": [
        "0",
        "1",
        "∞",
        "does not exist"
      ],
      "answerIndex": 1,
      "explanation": "By L'Hôpital's rule, the limit is lim cos x/1 = 1."
    }
  },
  {
    "id": "ap_stats_i5",
    "courseId": "ap_stats",
    "chapterId": "ap_stats_ch0",
    "type": "lecture",
    "title": "两类错误",
    "enTitle": "Type I and Type II Errors",
    "body": "第一类错误（Type I）：H₀ 为真却拒绝了它，概率为 α。第二类错误（Type II）：H₀ 为假却没拒绝，概率为 β。检验功效 power = 1-β。减小 α 会增大 β，需权衡。",
    "enBody": "Type I error: rejecting a true H₀, with probability α. Type II error: failing to reject a false H₀, with probability β. Power = 1-β. Reducing α increases β, so there is a trade-off.",
    "quiz": {
      "question": "Rejecting a true null hypothesis is a:",
      "options": [
        "Type I error",
        "Type II error",
        "correct decision",
        "sampling error"
      ],
      "answerIndex": 0,
      "explanation": "Type I error is rejecting H₀ when it is actually true."
    }
  },
  {
    "id": "ap_stats_i6",
    "courseId": "ap_stats",
    "chapterId": "ap_stats_ch0",
    "type": "lecture",
    "title": "双样本检验",
    "enTitle": "Two-Sample Tests",
    "body": "比较两组均值用双样本 t 检验。比较比例用双比例 z 检验。配对样本（同一批人前后测）用配对 t 检验。先明确研究问题，再选对应检验方法。",
    "enBody": "Use a two-sample t-test to compare two means, and a two-proportion z-test to compare two proportions. Paired samples (same subjects before/after) use a paired t-test. Clarify the research question, then pick the test.",
    "quiz": {
      "question": "Comparing the same subjects before and after a treatment uses a:",
      "options": [
        "two-sample t-test",
        "paired t-test",
        "z-test for proportions",
        "chi-square test"
      ],
      "answerIndex": 1,
      "explanation": "Paired data (same subjects, two measurements) requires a paired t-test."
    }
  },
  {
    "id": "ap_stats_i7",
    "courseId": "ap_stats",
    "chapterId": "ap_stats_ch0",
    "type": "lecture",
    "title": "卡方检验",
    "enTitle": "Chi-Square Tests",
    "body": "卡方检验用于分类数据。拟合优度检验：观察频数是否符合某个分布。独立性检验：两个分类变量是否相关。计算 χ²=Σ(O-E)²/E，与临界值或 p 值比较。",
    "enBody": "Chi-square tests work with categorical data. A goodness-of-fit test checks if observed frequencies match a distribution. A test of independence checks association between two categorical variables. Compute χ²=Σ(O-E)²/E.",
    "quiz": {
      "question": "Chi-square tests are used for:",
      "options": [
        "means",
        "proportions",
        "categorical data",
        "paired data"
      ],
      "answerIndex": 2,
      "explanation": "Chi-square tests analyze categorical (count) data."
    }
  },
  {
    "id": "ap_stats_i8",
    "courseId": "ap_stats",
    "chapterId": "ap_stats_ch0",
    "type": "lecture",
    "title": "回归推断",
    "enTitle": "Inference for Regression",
    "body": "对回归斜率做假设检验：H₀ 通常为 β=0（无线性关系）。t 检验判断斜率是否显著不为 0。同时给出斜率的置信区间。检查残差图的随机性验证线性条件。",
    "enBody": "Test the regression slope, typically H₀: β=0 (no linear relationship). A t-test determines if the slope differs significantly from 0, with a confidence interval for the slope. Check residual plots for randomness.",
    "quiz": {
      "question": "In regression inference, the usual null hypothesis for the slope is:",
      "options": [
        "β=1",
        "β=0",
        "β>0",
        "β<0"
      ],
      "answerIndex": 1,
      "explanation": "The default null hypothesis is β=0, meaning no linear relationship."
    }
  },
  {
    "id": "sat_math_i5",
    "courseId": "sat_math",
    "chapterId": "sat_math_ch0",
    "type": "lecture",
    "title": "指数与根式",
    "enTitle": "Exponents and Radicals",
    "body": "指数运算：xᵃ·xᵇ=xᵃ⁺ᵇ，(xᵃ)ᵇ=xᵃᵇ，x⁻ᵃ=1/xᵃ。根式可写成分数指数：√x=x^(1/2)，∛x=x^(1/3)。解指数方程常取对数：xᵃ=b → a·log x=log b。",
    "enBody": "Exponent rules: xᵃ·xᵇ=xᵃ⁺ᵇ, (xᵃ)ᵇ=xᵃᵇ, x⁻ᵃ=1/xᵃ. Radicals are fractional exponents: √x=x^(1/2). Solve exponential equations with logs: xᵃ=b → a·log x=log b.",
    "quiz": {
      "question": "√x expressed as an exponent is:",
      "options": [
        "x²",
        "x^(1/2)",
        "x^(1/3)",
        "2x"
      ],
      "answerIndex": 1,
      "explanation": "The square root is the 1/2 power: √x=x^(1/2)."
    }
  },
  {
    "id": "sat_math_i6",
    "courseId": "sat_math",
    "chapterId": "sat_math_ch0",
    "type": "lecture",
    "title": "圆与抛物线方程",
    "enTitle": "Circles and Parabolas",
    "body": "圆标准方程 (x-h)²+(y-k)²=r²，圆心 (h,k)、半径 r。抛物线顶点式 y=a(x-h)²+k，顶点 (h,k)。通过配方法把一般式化为标准式，直接读出几何特征。",
    "enBody": "Circle: (x-h)²+(y-k)²=r² with center (h,k), radius r. Parabola: y=a(x-h)²+k with vertex (h,k). Complete the square to convert general form to standard form and read off geometric features.",
    "quiz": {
      "question": "For (x-2)²+(y+3)²=16, the radius is:",
      "options": [
        "2",
        "3",
        "4",
        "16"
      ],
      "answerIndex": 2,
      "explanation": "r²=16, so r=4."
    }
  },
  {
    "id": "sat_math_i7",
    "courseId": "sat_math",
    "chapterId": "sat_math_ch0",
    "type": "lecture",
    "title": "比例与百分比",
    "enTitle": "Ratios and Percentages",
    "body": "百分比增减：增加 p% 即乘以 (1+p/100)，减少 p% 即乘以 (1-p/100)。连续变化用连乘。比例问题设每份为 x，按比例分配。注意区分\"占谁的百分比\"。",
    "enBody": "Percentage change: an increase of p% multiplies by (1+p/100), a decrease by (1-p/100). Successive changes multiply. For ratio problems, let each part be x. Be careful about the base of the percentage.",
    "quiz": {
      "question": "A 20% discount on a $50 item gives a price of:",
      "options": [
        "$30",
        "$40",
        "$45",
        "$48"
      ],
      "answerIndex": 1,
      "explanation": "50×(1-0.20)=50×0.8=$40."
    }
  },
  {
    "id": "sat_math_i8",
    "courseId": "sat_math",
    "chapterId": "sat_math_ch0",
    "type": "lecture",
    "title": "复数运算",
    "enTitle": "Complex Numbers",
    "body": "复数 a+bi，i²=-1。加减：实部加实部、虚部加虚部。乘法展开后把 i² 换成 -1。除法：分子分母同乘共轭复数。复数相等则实部虚部分别相等。",
    "enBody": "A complex number is a+bi with i²=-1. Add by combining real and imaginary parts. Multiply by expanding and replacing i² with -1. To divide, multiply numerator and denominator by the conjugate.",
    "quiz": {
      "question": "(3+2i)(3-2i) equals:",
      "options": [
        "9",
        "5",
        "13",
        "9-4i"
      ],
      "answerIndex": 2,
      "explanation": "(3+2i)(3-2i)=9-4i²=9+4=13."
    }
  },
  {
    "id": "sat_write_i5",
    "courseId": "sat_write",
    "chapterId": "sat_write_ch0",
    "type": "lecture",
    "title": "平行结构",
    "enTitle": "Parallel Structure",
    "body": "并列的语法成分必须结构一致：动词和动词并列、名词和名词并列。例：She likes reading, writing, and to swim ✗ → She likes reading, writing, and swimming ✓。",
    "enBody": "Coordinated items must share the same grammatical form. Example: \"She likes reading, writing, and to swim\" is wrong; it should be \"reading, writing, and swimming\".",
    "quiz": {
      "question": "Which is correct?",
      "options": [
        "to run, swimming, and biking",
        "running, swimming, and biking",
        "run, swimming, and to bike",
        "running, to swim, and bike"
      ],
      "answerIndex": 1,
      "explanation": "All three items must be gerunds: running, swimming, and biking."
    }
  },
  {
    "id": "sat_write_i6",
    "courseId": "sat_write",
    "chapterId": "sat_write_ch0",
    "type": "lecture",
    "title": "代词指代清晰",
    "enTitle": "Pronoun Clarity",
    "body": "代词必须清楚指代一个明确的先行词。当一个句子有多个可能的名词时，代词会产生歧义。例：When John met Bill, he smiled 中的 he 指代不清，应改为 When John met Bill, John smiled。",
    "enBody": "A pronoun must refer clearly to one antecedent. With multiple possible nouns, ambiguity arises. Example: \"When John met Bill, he smiled\" is unclear — use \"John smiled\" instead.",
    "quiz": {
      "question": "Which sentence has clear pronoun reference?",
      "options": [
        "When Tom met Jerry, he laughed.",
        "Tom and Jerry met, and Tom laughed.",
        "They met, and he laughed.",
        "It was funny when he laughed."
      ],
      "answerIndex": 1,
      "explanation": "Option 2 names Tom explicitly, removing the ambiguity."
    }
  },
  {
    "id": "sat_write_i7",
    "courseId": "sat_write",
    "chapterId": "sat_write_ch0",
    "type": "lecture",
    "title": "悬垂修饰语",
    "enTitle": "Dangling Modifiers",
    "body": "修饰语必须紧邻它所修饰的成分。悬垂修饰语指修饰语在句首，但主句主语并非被修饰对象。例：Walking down the street, the trees were beautiful ✗（树不会走路）。",
    "enBody": "A modifier must sit next to what it modifies. A dangling modifier starts the sentence but the main subject is not what is being modified. Example: \"Walking down the street, the trees were beautiful\" is wrong because trees do not walk.",
    "quiz": {
      "question": "Which fixes the dangling modifier?",
      "options": [
        "Walking down the street, the trees were beautiful.",
        "Walking down the street, I saw beautiful trees.",
        "Walking down the street, beautiful trees were seen.",
        "The trees, walking down the street, were beautiful."
      ],
      "answerIndex": 1,
      "explanation": "Option 2 makes \"I\" the subject who is walking."
    }
  },
  {
    "id": "sat_write_i8",
    "courseId": "sat_write",
    "chapterId": "sat_write_ch0",
    "type": "lecture",
    "title": "简洁性原则",
    "enTitle": "Conciseness",
    "body": "SAT 写作偏好最简洁的表达。删掉冗余词（如 \"in the future\" 可省、\"due to the fact that\" → \"because\"）。多个选项都对时，选最短且不改变原意的。",
    "enBody": "SAT Writing favors the most concise expression. Cut redundancy (\"due to the fact that\" → \"because\"). When several options are grammatically correct, choose the shortest one that preserves meaning.",
    "quiz": {
      "question": "Which is the most concise?",
      "options": [
        "Due to the fact that it rained, we stayed.",
        "Because it rained, we stayed.",
        "The reason we stayed is because it rained.",
        "It rained, and due to this fact we stayed."
      ],
      "answerIndex": 1,
      "explanation": "\"Because it rained, we stayed\" is the shortest and clearest."
    }
  },
  {
    "id": "ielts_listening_i5",
    "courseId": "ielts_listening",
    "chapterId": "ielts_listening_ch0",
    "type": "lecture",
    "title": "配对题：先读选项预判改写",
    "enTitle": "Matching: Predict Paraphrases",
    "body": "听力配对题选项中常有同义改写，录音里不会原词出现。做题前先把选项读一遍，预测每个选项可能被怎么改写。例如选项 \"long opening hours\" 可能在录音中说成 \"open until midnight\"。",
    "enBody": "Matching options are often paraphrased and never appear verbatim. Read the options first and predict how each might be reworded. For example, \"long opening hours\" may be said as \"open until midnight\".",
    "quiz": {
      "question": "配对题录音中的答案通常以什么形式出现？",
      "options": [
        "与选项原词相同",
        "选项的同义改写",
        "更长的句子",
        "与题干重复"
      ],
      "answerIndex": 1,
      "explanation": "配对题答案常以同义改写出现，需预判改写形式。"
    }
  },
  {
    "id": "ielts_listening_i6",
    "courseId": "ielts_listening",
    "chapterId": "ielts_listening_ch0",
    "type": "lecture",
    "title": "数字与字母听写",
    "enTitle": "Numbers and Letters",
    "body": "电话号码、门牌、邮编的听写高频出现。注意易混音：13 与 30（thirteen/thirty）、14 与 40。字母常按\"单词拼读\"给出（如 A for Apple）。听到连读的数字要先默念再写。",
    "enBody": "Phone numbers, addresses, and postcodes are common. Beware of confusable sounds: 13 vs 30, 14 vs 40. Letters are often given by spelling words (A for Apple). Repeat tricky digits mentally before writing.",
    "quiz": {
      "question": "13 和 30 易混，主要靠什么区分？",
      "options": [
        "元音长短",
        "重音位置",
        "语境",
        "以上都是"
      ],
      "answerIndex": 3,
      "explanation": "thirteen 重音在后、30 thirty 重音在前，结合语境综合判断。"
    }
  },
  {
    "id": "ielts_listening_i7",
    "courseId": "ielts_listening",
    "chapterId": "ielts_listening_ch0",
    "type": "lecture",
    "title": "否定词陷阱",
    "enTitle": "Negation Traps",
    "body": "听力中先肯定后否定是常见陷阱：\"I'd love to go, but I can't.\" 答案常是 but 之后的内容。注意 hardly、rarely、seldom 等隐性否定词，以及 would rather not、instead of 这类表达。",
    "enBody": "A common trap is first agreeing then contradicting: \"I'd love to go, but I can't.\" The answer is what follows \"but\". Watch hidden negatives like hardly, rarely, seldom, and phrases like would rather not.",
    "quiz": {
      "question": "\"I'd love to go, but I'm busy\" 中说话人的态度是？",
      "options": [
        "想去",
        "不想去",
        "不确定",
        "无所谓"
      ],
      "answerIndex": 1,
      "explanation": "but 之后才是真实态度，实际是不去。"
    }
  },
  {
    "id": "ielts_listening_i8",
    "courseId": "ielts_listening",
    "chapterId": "ielts_listening_ch0",
    "type": "lecture",
    "title": "答案词性核对",
    "enTitle": "Answer Word Form Check",
    "body": "填空答案必须与题干语法匹配。如果题干是 \"a ___ of water\"，答案应是名词（如 glass）。写完答案快速回读，检查单复数、时态、词性是否通顺，这是最后一道保险。",
    "enBody": "Blank answers must match the grammar of the question. If the prompt reads \"a ___ of water\", the answer must be a noun (e.g. glass). After writing, re-read to check number, tense, and word form.",
    "quiz": {
      "question": "\"a ___ of water\" 的空格应填什么词性？",
      "options": [
        "动词",
        "名词",
        "形容词",
        "副词"
      ],
      "answerIndex": 1,
      "explanation": "\"a ... of\" 结构中间需要名词，如 a glass of water。"
    }
  },
  {
    "id": "ielts_speaking_i5",
    "courseId": "ielts_speaking",
    "chapterId": "ielts_speaking_ch0",
    "type": "lecture",
    "title": "拓展回答的 AREA 法",
    "enTitle": "The AREA Method",
    "body": "回答简短时用 AREA 法拓展：Answer（直接回答）→ Reason（给原因）→ Example（举例子）→ Alternative（换个角度补充）。这能让每个回答都充实到 15 秒以上，避免冷场。",
    "enBody": "Use AREA to expand short answers: Answer directly → Reason → Example → Alternative angle. This fills every response to over 15 seconds and avoids dead air.",
    "quiz": {
      "question": "AREA 法中 E 代表什么？",
      "options": [
        "Explanation",
        "Example",
        "English",
        "Emotion"
      ],
      "answerIndex": 1,
      "explanation": "AREA = Answer, Reason, Example, Alternative。"
    }
  },
  {
    "id": "ielts_speaking_i6",
    "courseId": "ielts_speaking",
    "chapterId": "ielts_speaking_ch0",
    "type": "lecture",
    "title": "Part 2 时间分配",
    "enTitle": "Part 2 Time Management",
    "body": "Part 2 要说满 2 分钟。建议结构：开头 20 秒介绍主题，中间 80 秒讲细节（who/what/where），结尾 20 秒总结感受。练习时用秒表，养成\"说满不超时\"的节奏感。",
    "enBody": "Part 2 needs a full 2 minutes. Structure: 20s intro, 80s of details (who/what/where), 20s closing feelings. Practise with a stopwatch to build a steady pace.",
    "quiz": {
      "question": "Part 2 要求的时长是？",
      "options": [
        "1 分钟",
        "1-2 分钟",
        "2 分钟",
        "3 分钟"
      ],
      "answerIndex": 2,
      "explanation": "Part 2 需要连续说 1-2 分钟，目标应说满 2 分钟。"
    }
  },
  {
    "id": "ielts_speaking_i7",
    "courseId": "ielts_speaking",
    "chapterId": "ielts_speaking_ch0",
    "type": "lecture",
    "title": "争取思考时间的表达",
    "enTitle": "Buying Thinking Time",
    "body": "遇到难题不要说 \"I don't know\" 就停。用 \"That's a good question...\"、\"Let me think...\"、\"Well, I've never thought about that, but...\" 争取 2-3 秒组织语言，同时展示自然交流能力。",
    "enBody": "Never just say \"I don't know\" and stop. Use \"That's a good question...\", \"Let me think...\", \"Well, I've never thought about that, but...\" to buy 2-3 seconds and show natural communication.",
    "quiz": {
      "question": "遇到难题时最好的做法是？",
      "options": [
        "直接说不会",
        "沉默思考",
        "用过渡表达争取时间",
        "要求换题"
      ],
      "answerIndex": 2,
      "explanation": "用自然过渡表达争取思考时间，既得体又能组织语言。"
    }
  },
  {
    "id": "ielts_speaking_i8",
    "courseId": "ielts_speaking",
    "chapterId": "ielts_speaking_ch0",
    "type": "lecture",
    "title": "发音清晰度优先",
    "enTitle": "Clear Pronunciation First",
    "body": "发音评分看清晰度和可理解度，不是口音。宁可说慢一点，把重音和句子节奏说清楚。注意常见发音难点：th 音、长短元音（ship/sheep）、词尾辅音不要吞掉。",
    "enBody": "Pronunciation is scored on clarity and intelligibility, not accent. Slow down and stress key words. Watch common difficulties: the th sound, long vs short vowels (ship/sheep), and final consonants.",
    "quiz": {
      "question": "发音评分主要看？",
      "options": [
        "是否有英音",
        "清晰度和可理解度",
        "语速快",
        "词汇量"
      ],
      "answerIndex": 1,
      "explanation": "评分关注清晰可懂，口音不影响。"
    }
  },
  {
    "id": "ielts_reading_i5",
    "courseId": "ielts_reading",
    "chapterId": "ielts_reading_ch0",
    "type": "lecture",
    "title": "定位词选择技巧",
    "enTitle": "Choosing Keywords",
    "body": "回文定位时选\"难被改写\"的词：专有名词、数字、年份、大写词。普通动词和形容词容易被同义替换，不宜作定位词。一次只带 2-3 个关键词，太多反而干扰。",
    "enBody": "Choose keywords that resist paraphrasing: proper nouns, numbers, years, capitalized words. Ordinary verbs and adjectives are easily reworded. Take only 2-3 keywords at a time.",
    "quiz": {
      "question": "最适合做定位词的是？",
      "options": [
        "动词",
        "形容词",
        "专有名词和数字",
        "连接词"
      ],
      "answerIndex": 2,
      "explanation": "专有名词和数字难被改写，定位最稳。"
    }
  },
  {
    "id": "ielts_reading_i6",
    "courseId": "ielts_reading",
    "chapterId": "ielts_reading_ch0",
    "type": "lecture",
    "title": "主旨题：概括 vs 细节",
    "enTitle": "Main Idea vs Detail",
    "body": "主旨题选\"概括性\"答案，排除\"只覆盖部分\"或\"过于宽泛\"的选项。干扰项常是文中的某个细节。判断标准：正确选项能统领全段，而不是某一句。",
    "enBody": "For main idea questions, choose a general answer, not one covering only part or being too broad. Distractors are often details. The correct option governs the whole paragraph.",
    "quiz": {
      "question": "主旨题的正确答案通常？",
      "options": [
        "是文中某个细节",
        "能概括全段",
        "最长的选项",
        "包含数字的选项"
      ],
      "answerIndex": 1,
      "explanation": "主旨题答案要能统领全段，而非某一句细节。"
    }
  },
  {
    "id": "ielts_reading_i7",
    "courseId": "ielts_reading",
    "chapterId": "ielts_reading_ch0",
    "type": "lecture",
    "title": "信息匹配题：扫读 + 精读",
    "enTitle": "Information Matching",
    "body": "信息匹配题（which paragraph contains...）先用题干关键词扫读定位段落，再精读该段确认。这类题乱序出现，不要按顺序找。一个段落可能对应多题。",
    "enBody": "For \"which paragraph contains...\" questions, scan for keywords to locate the paragraph, then read it carefully to confirm. Answers are out of order, and one paragraph may match several items.",
    "quiz": {
      "question": "信息匹配题的答案是？",
      "options": [
        "按文章顺序",
        "乱序出现",
        "只在首段",
        "只在末段"
      ],
      "answerIndex": 1,
      "explanation": "这类题答案乱序，需逐题定位。"
    }
  },
  {
    "id": "ielts_reading_i8",
    "courseId": "ielts_reading",
    "chapterId": "ielts_reading_ch0",
    "type": "lecture",
    "title": "时间分配策略",
    "enTitle": "Time Allocation",
    "body": "阅读 60 分钟 40 题，建议每篇 20 分钟。难的文章放到最后，先做简单题型的分数。不要在某一题卡太久，超过 1 分钟先跳过，做完回头再想。",
    "enBody": "60 minutes for 40 questions means about 20 minutes per passage. Do easy question types first, save hard passages for last. If stuck for over a minute, skip and return later.",
    "quiz": {
      "question": "雅思阅读每篇建议用时？",
      "options": [
        "10 分钟",
        "15 分钟",
        "20 分钟",
        "25 分钟"
      ],
      "answerIndex": 2,
      "explanation": "三篇共 60 分钟，平均每篇 20 分钟。"
    }
  },
  {
    "id": "ielts_writing_i5",
    "courseId": "ielts_writing",
    "chapterId": "ielts_writing_ch0",
    "type": "lecture",
    "title": "Task 1 数据选择",
    "enTitle": "Task 1 Data Selection",
    "body": "Task 1 不要罗列所有数据，选 2-3 个最显著的特征：最高/最低、最大变化、明显趋势、例外点。数据引用用 \"approximately / around / just over\" 等词，不要照抄精确数字。",
    "enBody": "Do not list every figure in Task 1. Select 2-3 striking features: highest/lowest, biggest change, clear trend, exceptions. Use \"approximately / around / just over\" rather than copying exact numbers.",
    "quiz": {
      "question": "Task 1 应该？",
      "options": [
        "罗列所有数据",
        "选 2-3 个显著特征",
        "写个人观点",
        "只写标题"
      ],
      "answerIndex": 1,
      "explanation": "选最显著特征概述，而非穷举数据。"
    }
  },
  {
    "id": "ielts_writing_i6",
    "courseId": "ielts_writing",
    "chapterId": "ielts_writing_ch0",
    "type": "lecture",
    "title": "Task 2 论点展开",
    "enTitle": "Task 2 Argument Development",
    "body": "每个主体段用 PEEL 结构：Point（论点）→ Explanation（解释）→ Example（例子）→ Link（回扣题旨）。例子要具体，可以是个人经历或常识，但必须支撑论点而非另起炉灶。",
    "enBody": "Develop each body paragraph with PEEL: Point → Explanation → Example → Link back to the question. Examples should be concrete and support the point, not start a new one.",
    "quiz": {
      "question": "PEEL 中 L 代表？",
      "options": [
        "Language",
        "Link",
        "Length",
        "Logic"
      ],
      "answerIndex": 1,
      "explanation": "PEEL = Point, Explanation, Example, Link。"
    }
  },
  {
    "id": "ielts_writing_i7",
    "courseId": "ielts_writing",
    "chapterId": "ielts_writing_ch0",
    "type": "lecture",
    "title": "审题与偏题风险",
    "enTitle": "Understanding the Prompt",
    "body": "大作文失分大头是偏题。先圈出题目的\"任务词\"：discuss、agree/disagree、advantages/disadvantages、cause/solution。确定要写几方观点、是否要给立场，再动笔。",
    "enBody": "The biggest Task 2 risk is going off-topic. Circle the task words first: discuss, agree/disagree, advantages/disadvantages, cause/solution. Decide how many views to cover and whether to state a position.",
    "quiz": {
      "question": "\"Discuss both views and give your opinion\" 要求？",
      "options": [
        "只写一方",
        "讨论双方并给立场",
        "只写观点",
        "只写例子"
      ],
      "answerIndex": 1,
      "explanation": "需讨论双方观点并明确给出自己的立场。"
    }
  },
  {
    "id": "ielts_writing_i8",
    "courseId": "ielts_writing",
    "chapterId": "ielts_writing_ch0",
    "type": "lecture",
    "title": "词汇升级：避免重复",
    "enTitle": "Lexical Resource",
    "body": "避免反复用同一个词。给高频词建立同义库：important → crucial/vital/significant；show → illustrate/demonstrate；many → numerous/a variety of。但前提是用得准，别为换词而换词。",
    "enBody": "Avoid repeating the same word. Build synonym banks: important → crucial/vital/significant; show → illustrate/demonstrate; many → numerous/a variety of. But prioritize accuracy over novelty.",
    "quiz": {
      "question": "提升词汇分的正确做法是？",
      "options": [
        "堆砌生僻词",
        "准确使用同义替换",
        "重复同一个词",
        "全部用短词"
      ],
      "answerIndex": 1,
      "explanation": "准确使用同义替换，而非堆砌或重复。"
    }
  },
  {
    "id": "toefl_b1_i5",
    "courseId": "toefl_b1",
    "chapterId": "toefl_b1_ch0",
    "type": "lecture",
    "title": "听力细节题：笔记定位",
    "enTitle": "Listening Detail Questions",
    "body": "细节题答案来自讲座中的具体事实。记笔记时用缩写和符号记关键数字、人名、定义。答题时先看题干关键词，回到笔记对应位置找答案，而不是凭记忆猜。",
    "enBody": "Detail questions test specific facts. Take notes with abbreviations for key numbers, names, and definitions. Match the question keyword to your notes rather than guessing from memory.",
    "quiz": {
      "question": "细节题的最佳应对是？",
      "options": [
        "凭记忆作答",
        "回笔记定位",
        "选最长选项",
        "跳过"
      ],
      "answerIndex": 1,
      "explanation": "用题干关键词回笔记定位，比凭记忆可靠。"
    }
  },
  {
    "id": "toefl_b1_i6",
    "courseId": "toefl_b1",
    "chapterId": "toefl_b1_ch0",
    "type": "lecture",
    "title": "阅读词汇题：上下文猜词",
    "enTitle": "Vocabulary in Context",
    "body": "词汇题考\"单词在文中的意思\"，不是默写。做法：定位该词所在句 → 看前后逻辑（对比、因果、举例）→ 用上下文推断。即使不认识单词也能做对。",
    "enBody": "Vocabulary questions test meaning in context, not memorization. Locate the sentence, examine the surrounding logic (contrast, cause, example), and infer. You can answer even without knowing the word.",
    "quiz": {
      "question": "词汇题的正确做法是？",
      "options": [
        "直接背词义",
        "看上下文推断",
        "选最熟悉的词",
        "跳过"
      ],
      "answerIndex": 1,
      "explanation": "词汇题考语境义，需结合上下文推断。"
    }
  },
  {
    "id": "toefl_b1_i7",
    "courseId": "toefl_b1",
    "chapterId": "toefl_b1_ch0",
    "type": "lecture",
    "title": "口语 Task 2：校园场景",
    "enTitle": "Speaking Task 2: Campus",
    "body": "Task 2 是读一则校园通知 + 听对话表态。回答结构：先概括通知内容，再说说话者的态度（支持/反对），最后给 1-2 个理由。注意用自己的话转述，不要照读。",
    "enBody": "Task 2 combines a campus announcement and a conversation. Structure: summarize the announcement, state the speaker's attitude (for/against), then give 1-2 reasons. Paraphrase, do not read verbatim.",
    "quiz": {
      "question": "Task 2 回答应包含？",
      "options": [
        "只概括通知",
        "通知+态度+理由",
        "只讲个人观点",
        "只复述对话"
      ],
      "answerIndex": 1,
      "explanation": "需概括通知、说明态度并给理由。"
    }
  },
  {
    "id": "toefl_b1_i8",
    "courseId": "toefl_b1",
    "chapterId": "toefl_b1_ch0",
    "type": "lecture",
    "title": "阅读主旨题：首段定位",
    "enTitle": "Reading Main Idea",
    "body": "托福阅读主旨题答案常在首段，尤其是首段最后一句的 thesis statement。注意转折词 however 之后往往是真正主旨。段落主旨题则看该段首句和尾句。",
    "enBody": "Main idea answers usually sit in the first paragraph, often the thesis statement at its end. Watch for the real point after \"however\". For paragraph-level questions, check the first and last sentences.",
    "quiz": {
      "question": "阅读主旨常出现在？",
      "options": [
        "末段",
        "首段 thesis statement",
        "中间段",
        "标题"
      ],
      "answerIndex": 1,
      "explanation": "主旨常在首段，尤其是 thesis statement。"
    }
  },
  {
    "id": "toefl_b2_i5",
    "courseId": "toefl_b2",
    "chapterId": "toefl_b2_ch0",
    "type": "lecture",
    "title": "讲座重听题",
    "enTitle": "Replay Questions",
    "body": "重听题会重放一段话，问说话者意图或态度。关键是听\"语气\"而非字面意思：重音、停顿、反问都暗示态度。注意 \"Actually / Well / I mean\" 这类修正性开头的真实意图。",
    "enBody": "Replay questions replay a segment and ask about intent or attitude. Listen to tone, not just words: stress, pauses, and rhetorical questions reveal attitude. Note corrective openings like \"Actually / Well / I mean\".",
    "quiz": {
      "question": "重听题重点听什么？",
      "options": [
        "字面意思",
        "语气和意图",
        "语法",
        "词汇"
      ],
      "answerIndex": 1,
      "explanation": "重听题考意图态度，语气是关键线索。"
    }
  },
  {
    "id": "toefl_b2_i6",
    "courseId": "toefl_b2",
    "chapterId": "toefl_b2_ch0",
    "type": "lecture",
    "title": "推断题：言外之意",
    "enTitle": "Inference Questions",
    "body": "推断题答案不直接出现在文中，要基于信息合理推出。原则：推断必须\"往前一小步\"，不能过度引申。排除\"文中明说\"和\"毫无根据\"的选项，选最贴近原文逻辑的那个。",
    "enBody": "Inference answers are not stated directly but follow from the text. Infer one small step, not a leap. Eliminate options that are stated outright or unfounded, and choose the one closest to the passage logic.",
    "quiz": {
      "question": "推断题的原则是？",
      "options": [
        "大胆联想",
        "基于原文往前一小步",
        "选最极端的",
        "选文中原句"
      ],
      "answerIndex": 1,
      "explanation": "推断要基于原文做合理的小步推导。"
    }
  },
  {
    "id": "toefl_b2_i7",
    "courseId": "toefl_b2",
    "chapterId": "toefl_b2_ch0",
    "type": "lecture",
    "title": "组织结构题",
    "enTitle": "Organization Questions",
    "body": "组织结构题问\"教授为什么提到某个例子/观点\"。答案通常是\"为了说明/支持/对比前文某个概念\"。定位该内容在文中的位置，看它服务的论点是哪个。",
    "enBody": "Organization questions ask why the professor mentions an example or idea. The answer is usually \"to illustrate/support/contrast a prior concept\". Locate the item and identify which argument it serves.",
    "quiz": {
      "question": "\"为什么提到某个例子\"这类题考的是？",
      "options": [
        "例子的细节",
        "例子的功能",
        "例子的词义",
        "例子的长度"
      ],
      "answerIndex": 1,
      "explanation": "考例子在文中的作用，而非例子本身细节。"
    }
  },
  {
    "id": "toefl_b2_i8",
    "courseId": "toefl_b2",
    "chapterId": "toefl_b2_ch0",
    "type": "lecture",
    "title": "综合口语 Task 4",
    "enTitle": "Integrated Speaking Task 4",
    "body": "Task 4 是学术讲座复述。结构：先复述教授讲的概念定义，再讲例子说明。笔记要抓\"概念 + 例子\"两条线，复述时用自己的话串联，60 秒内讲清楚。",
    "enBody": "Task 4 retells an academic lecture. Structure: restate the concept's definition, then the example. Note both the \"concept\" and \"example\" lines, and link them in your own words within 60 seconds.",
    "quiz": {
      "question": "Task 4 复述的重点是？",
      "options": [
        "只讲例子",
        "概念+例子",
        "只讲概念",
        "个人观点"
      ],
      "answerIndex": 1,
      "explanation": "需完整复述概念定义并用例子说明。"
    }
  },
  {
    "id": "toefl_adv_i5",
    "courseId": "toefl_adv",
    "chapterId": "toefl_adv_ch0",
    "type": "lecture",
    "title": "独立写作立论",
    "enTitle": "Independent Writing Thesis",
    "body": "独立写作开头段要点：背景句引入 + 明确立场 thesis statement。立场要清晰可辩，不要骑墙。常用结构：While some argue X, I believe Y for two reasons. 明确预告主体段内容。",
    "enBody": "A strong intro has a hook and a clear thesis. Take a clear, arguable stance — no fence-sitting. Use: \"While some argue X, I believe Y for two reasons\" and preview your body paragraphs.",
    "quiz": {
      "question": "好的 thesis statement 应该？",
      "options": [
        "骑墙不定",
        "清晰可辩",
        "越长越好",
        "只提问题"
      ],
      "answerIndex": 1,
      "explanation": "立场要明确、可辩论，并预告论证方向。"
    }
  },
  {
    "id": "toefl_adv_i6",
    "courseId": "toefl_adv",
    "chapterId": "toefl_adv_ch0",
    "type": "lecture",
    "title": "例子充分性",
    "enTitle": "Adequate Examples",
    "body": "每个论点都要有具体例子支撑，泛泛而谈会扣分。例子可以是个人经历、历史事件、常识，但必须具体：谁、做了什么、结果如何。一个具体例子胜过三个空泛观点。",
    "enBody": "Every point needs concrete support; vague statements lose points. Examples can be personal, historical, or common knowledge, but must be specific: who, what, and the result. One specific example beats three vague claims.",
    "quiz": {
      "question": "论证充分的关键是？",
      "options": [
        "观点越多越好",
        "每个论点配具体例子",
        "用高级词汇",
        "写长句"
      ],
      "answerIndex": 1,
      "explanation": "具体例子支撑论点才是论证充分的关键。"
    }
  },
  {
    "id": "toefl_adv_i7",
    "courseId": "toefl_adv",
    "chapterId": "toefl_adv_ch0",
    "type": "lecture",
    "title": "让步与反驳",
    "enTitle": "Concession and Rebuttal",
    "body": "高分作文常含让步段：先承认对方观点有道理（Admittedly, ...），再用 however 反驳。这展示辩证思维，但让步要简短，反驳要占主体，不能让让步削弱自己的立场。",
    "enBody": "High-scoring essays include a concession: acknowledge the counterargument (Admittedly, ...), then rebut with \"however\". This shows balanced thinking, but keep the concession brief so it does not weaken your position.",
    "quiz": {
      "question": "让步段的正确写法是？",
      "options": [
        "只写对方观点",
        "承认对方+反驳",
        "完全不提对方",
        "全部让步"
      ],
      "answerIndex": 1,
      "explanation": "先承认对方有道理，再反驳，展示辩证思维。"
    }
  },
  {
    "id": "toefl_adv_i8",
    "courseId": "toefl_adv",
    "chapterId": "toefl_adv_ch0",
    "type": "lecture",
    "title": "结尾段：升华不重复",
    "enTitle": "Conclusion: Elevate, Don't Repeat",
    "body": "结尾段不要逐字重复正文。做法：paraphrase 重申立场 + 升华意义（展望、呼吁、总结价值）。简短有力，2-3 句即可，切忌引入新论点。",
    "enBody": "Do not repeat the body verbatim. Instead, paraphrase your position and elevate it (look ahead, call to action, or summarize value). Keep it to 2-3 strong sentences and introduce no new arguments.",
    "quiz": {
      "question": "结尾段应该？",
      "options": [
        "逐字重复正文",
        "重申立场+升华",
        "引入新论点",
        "写越长越好"
      ],
      "answerIndex": 1,
      "explanation": "结尾要重申立场并升华，不重复、不引入新论点。"
    }
  },
  {
    "id": "igcse_am_i5",
    "courseId": "igcse_addmath",
    "chapterId": "igcse_addmath_ch0",
    "type": "lecture",
    "title": "函数与反函数",
    "enTitle": "Functions and Inverses",
    "body": "函数是一对一或一对多的映射。反函数 f⁻¹ 把输出映射回输入。求反函数：把 y=f(x) 中的 x 和 y 互换，再解出 y。反函数图像关于直线 y=x 对称。",
    "enBody": "A function maps inputs to outputs. The inverse f⁻¹ maps outputs back to inputs. To find it, swap x and y in y=f(x), then solve for y. Inverse graphs are symmetric about the line y=x.",
    "quiz": {
      "question": "反函数图像关于哪条线对称？",
      "options": [
        "x 轴",
        "y 轴",
        "y=x",
        "原点"
      ],
      "answerIndex": 2,
      "explanation": "反函数图像关于直线 y=x 对称。"
    }
  },
  {
    "id": "igcse_am_i6",
    "courseId": "igcse_addmath",
    "chapterId": "igcse_addmath_ch0",
    "type": "lecture",
    "title": "指数函数与对数",
    "enTitle": "Exponentials and Logarithms",
    "body": "指数函数 y=aˣ 与对数函数 y=log_a x 互为反函数。换底公式：log_a b = log b / log a。解指数方程常用两边取对数。ln 是以 e 为底的自然对数。",
    "enBody": "Exponential y=aˣ and logarithmic y=log_a x are inverses. Change of base: log_a b = log b / log a. Solve exponential equations by taking logs. ln is the natural log with base e.",
    "quiz": {
      "question": "换底公式 log_a b 等于？",
      "options": [
        "log b / log a",
        "log a / log b",
        "log a · log b",
        "a^b"
      ],
      "answerIndex": 0,
      "explanation": "log_a b = log b / log a。"
    }
  },
  {
    "id": "igcse_am_i7",
    "courseId": "igcse_addmath",
    "chapterId": "igcse_addmath_ch0",
    "type": "lecture",
    "title": "三角恒等式",
    "enTitle": "Trigonometric Identities",
    "body": "核心恒等式：sin²θ + cos²θ = 1；tanθ = sinθ/cosθ。倍角公式 sin2θ = 2sinθcosθ。解三角方程时先化简成单一三角函数，再在给定区间找所有解。",
    "enBody": "Key identities: sin²θ + cos²θ = 1 and tanθ = sinθ/cosθ. Double angle: sin2θ = 2sinθcosθ. Simplify to a single trig function, then find all solutions in the interval.",
    "quiz": {
      "question": "sin²θ + cos²θ 恒等于？",
      "options": [
        "0",
        "1",
        "tanθ",
        "2"
      ],
      "answerIndex": 1,
      "explanation": "这是最基本的三角恒等式，恒等于 1。"
    }
  },
  {
    "id": "igcse_am_i8",
    "courseId": "igcse_addmath",
    "chapterId": "igcse_addmath_ch0",
    "type": "lecture",
    "title": "向量基础运算",
    "enTitle": "Basic Vector Operations",
    "body": "向量有大小和方向。加减用平行四边形法则。数乘改变大小可能反转方向。位置向量、单位向量（模为 1）是常见概念。向量模长 |v| = √(x²+y²)。",
    "enBody": "Vectors have magnitude and direction. Add by the parallelogram rule; scalar multiplication scales or reverses. Position vectors and unit vectors (magnitude 1) are common. Magnitude |v| = √(x²+y²).",
    "quiz": {
      "question": "向量 v=(3,4) 的模长是？",
      "options": [
        "5",
        "7",
        "12",
        "25"
      ],
      "answerIndex": 0,
      "explanation": "|v| = √(3²+4²) = √25 = 5。"
    }
  },
  {
    "id": "alevel_p3_i5",
    "courseId": "alevel_pure3",
    "chapterId": "alevel_pure3_ch0",
    "type": "lecture",
    "title": "双曲函数",
    "enTitle": "Hyperbolic Functions",
    "body": "双曲函数：sinh x = (eˣ-e⁻ˣ)/2，cosh x = (eˣ+e⁻ˣ)/2。恒等式 cosh²x - sinh²x = 1（与三角恒等式符号相反）。求导：d/dx sinh x = cosh x，d/dx cosh x = sinh x。",
    "enBody": "Hyperbolic functions: sinh x = (eˣ-e⁻ˣ)/2, cosh x = (eˣ+e⁻ˣ)/2. Identity: cosh²x - sinh²x = 1 (note the minus, unlike trig). Derivatives: d/dx sinh x = cosh x, d/dx cosh x = sinh x.",
    "quiz": {
      "question": "cosh²x - sinh²x 等于？",
      "options": [
        "1",
        "-1",
        "0",
        "2"
      ],
      "answerIndex": 0,
      "explanation": "双曲恒等式 cosh²x - sinh²x = 1。"
    }
  },
  {
    "id": "alevel_p3_i6",
    "courseId": "alevel_pure3",
    "chapterId": "alevel_pure3_ch0",
    "type": "lecture",
    "title": "有理函数积分",
    "enTitle": "Integrating Rational Functions",
    "body": "有理函数积分用部分分式分解：把分式拆成简单分式之和再逐项积分。分解方法：分母因式分解后设待定系数，解方程确定系数。适用于分母可因式分解的情况。",
    "enBody": "Integrate rational functions by partial fractions: decompose into simpler fractions, then integrate term by term. Factor the denominator, set undetermined coefficients, and solve. Works when the denominator factors.",
    "quiz": {
      "question": "部分分式分解用于？",
      "options": [
        "有理函数积分",
        "求极限",
        "解方程",
        "矩阵运算"
      ],
      "answerIndex": 0,
      "explanation": "把复杂分式拆成简单分式再积分。"
    }
  },
  {
    "id": "alevel_p3_i7",
    "courseId": "alevel_pure3",
    "chapterId": "alevel_pure3_ch0",
    "type": "lecture",
    "title": "泰勒级数与逼近",
    "enTitle": "Taylor Series and Approximations",
    "body": "泰勒级数把函数在某点附近展开成多项式。常用：eˣ、sin x、cos x 在 x=0 的麦克劳林展开。用前几项近似计算函数值，误差由余项估计控制。",
    "enBody": "Taylor series expand a function into a polynomial near a point. Common Maclaurin expansions (at x=0) include eˣ, sin x, cos x. Use the first few terms to approximate, with the remainder controlling error.",
    "quiz": {
      "question": "麦克劳林展开是在哪一点的泰勒展开？",
      "options": [
        "x=1",
        "x=0",
        "x=∞",
        "任意点"
      ],
      "answerIndex": 1,
      "explanation": "麦克劳林展开是 x=0 处的泰勒展开特例。"
    }
  },
  {
    "id": "alevel_p3_i8",
    "courseId": "alevel_pure3",
    "chapterId": "alevel_pure3_ch0",
    "type": "lecture",
    "title": "向量叉积",
    "enTitle": "Vector Cross Product",
    "body": "叉积 a×b 得到一个垂直于 a、b 的向量，模 |a×b| = |a||b|sinθ。用于求法向量、三角形面积（面积的一半）。行列式法计算分量。注意叉积反交换律 a×b = -(b×a)。",
    "enBody": "The cross product a×b gives a vector perpendicular to both, with magnitude |a||b|sinθ. Use it for normal vectors and triangle areas. Compute via determinant. Note a×b = -(b×a).",
    "quiz": {
      "question": "叉积 a×b 的结果是？",
      "options": [
        "标量",
        "垂直于 a、b 的向量",
        "平行于 a 的向量",
        "单位向量"
      ],
      "answerIndex": 1,
      "explanation": "叉积结果是同时垂直于两个操作向量的向量。"
    }
  },
  {
    "id": "alevel_mech_i5",
    "courseId": "alevel_mech",
    "chapterId": "alevel_mech_ch0",
    "type": "lecture",
    "title": "摩擦力",
    "enTitle": "Friction",
    "body": "摩擦力 f ≤ μN，最大静摩擦 f_max = μN（μ 摩擦系数、N 法向力）。动摩擦 f = μₖN。当物体刚要滑动时 f 取最大值。解题判断物体是否滑动是第一步。",
    "enBody": "Friction satisfies f ≤ μN, with maximum static friction f_max = μN (μ coefficient, N normal force). Kinetic friction f = μₖN. At the point of slipping, f is maximal. First determine whether sliding occurs.",
    "quiz": {
      "question": "最大静摩擦 f_max 等于？",
      "options": [
        "μN",
        "μN²",
        "μ/N",
        "N/μ"
      ],
      "answerIndex": 0,
      "explanation": "最大静摩擦 = 摩擦系数 × 法向力 = μN。"
    }
  },
  {
    "id": "alevel_mech_i6",
    "courseId": "alevel_mech",
    "chapterId": "alevel_mech_ch0",
    "type": "lecture",
    "title": "动量与冲量",
    "enTitle": "Momentum and Impulse",
    "body": "动量 p = mv。冲量 = 力 × 时间 = 动量变化 = Δ(mv)。动量守恒：无外力时系统总动量不变。碰撞问题用动量守恒和恢复系数 e 联合求解。",
    "enBody": "Momentum p = mv. Impulse = force × time = change in momentum = Δ(mv). Momentum is conserved without external forces. Collision problems combine conservation of momentum with the restitution coefficient e.",
    "quiz": {
      "question": "冲量等于？",
      "options": [
        "质量×速度",
        "力×时间",
        "力×位移",
        "质量×加速度"
      ],
      "answerIndex": 1,
      "explanation": "冲量 = 力 × 作用时间 = 动量变化。"
    }
  },
  {
    "id": "alevel_mech_i7",
    "courseId": "alevel_mech",
    "chapterId": "alevel_mech_ch0",
    "type": "lecture",
    "title": "力矩平衡",
    "enTitle": "Moments and Equilibrium",
    "body": "力矩 = 力 × 垂直距离。刚体平衡需满足：合力为零 + 合力矩为零。取支点为矩心可简化计算。杠杆、桥梁、悬臂都是力矩平衡的典型应用。",
    "enBody": "Moment = force × perpendicular distance. A rigid body in equilibrium has zero resultant force and zero resultant moment. Taking moments about a pivot simplifies calculations. Levers and bridges are typical applications.",
    "quiz": {
      "question": "刚体平衡需要满足？",
      "options": [
        "合力为零",
        "合力矩为零",
        "两者都为零",
        "两者都不为零"
      ],
      "answerIndex": 2,
      "explanation": "平衡需合力为零且合力矩为零。"
    }
  },
  {
    "id": "alevel_mech_i8",
    "courseId": "alevel_mech",
    "chapterId": "alevel_mech_ch0",
    "type": "lecture",
    "title": "圆周运动",
    "enTitle": "Circular Motion",
    "body": "匀速圆周运动：向心加速度 a = v²/r = rω²。向心力 F = mv²/r。角速度 ω = v/r，周期 T = 2π/ω。向心力由重力、张力或摩擦力等提供。",
    "enBody": "Uniform circular motion: centripetal acceleration a = v²/r = rω², and force F = mv²/r. Angular velocity ω = v/r, period T = 2π/ω. The centripetal force is provided by gravity, tension, or friction.",
    "quiz": {
      "question": "向心加速度等于？",
      "options": [
        "v²/r",
        "vr",
        "v/r²",
        "r/v"
      ],
      "answerIndex": 0,
      "explanation": "向心加速度 a = v²/r。"
    }
  },
  {
    "id": "ib_aa_i5",
    "courseId": "ib_math_aa",
    "chapterId": "ib_math_aa_ch0",
    "type": "lecture",
    "title": "极限与连续性",
    "enTitle": "Limits and Continuity",
    "body": "极限描述函数在某点的趋近值。连续函数满足 lim f(x) = f(a)。判断连续性三条件：函数在 a 有定义、极限存在、极限值等于函数值。夹逼定理是求极限的重要工具。",
    "enBody": "A limit describes the value a function approaches. A function is continuous if lim f(x) = f(a). Three conditions: f(a) exists, the limit exists, and they are equal. The squeeze theorem is a key tool.",
    "quiz": {
      "question": "连续函数在 a 点需满足？",
      "options": [
        "极限等于函数值",
        "函数有定义即可",
        "极限存在即可",
        "可导即可"
      ],
      "answerIndex": 0,
      "explanation": "连续性要求极限值等于该点函数值。"
    }
  },
  {
    "id": "ib_aa_i6",
    "courseId": "ib_math_aa",
    "chapterId": "ib_math_aa_ch0",
    "type": "lecture",
    "title": "反三角函数求导",
    "enTitle": "Inverse Trig Derivatives",
    "body": "反三角函数求导公式：d/dx arcsin x = 1/√(1-x²)，d/dx arctan x = 1/(1+x²)，d/dx arccos x = -1/√(1-x²)。配合链式法则处理复合形式。",
    "enBody": "Inverse trig derivatives: d/dx arcsin x = 1/√(1-x²), d/dx arctan x = 1/(1+x²), d/dx arccos x = -1/√(1-x²). Apply the chain rule for composite forms.",
    "quiz": {
      "question": "d/dx arctan x 等于？",
      "options": [
        "1/(1+x²)",
        "1/√(1-x²)",
        "-1/(1+x²)",
        "tan x"
      ],
      "answerIndex": 0,
      "explanation": "arctan x 的导数是 1/(1+x²)。"
    }
  },
  {
    "id": "ib_aa_i7",
    "courseId": "ib_math_aa",
    "chapterId": "ib_math_aa_ch0",
    "type": "lecture",
    "title": "数列与级数收敛",
    "enTitle": "Sequence and Series Convergence",
    "body": "等比数列前 n 项和 Sₙ = a(1-rⁿ)/(1-r)。无穷等比级数当 |r|<1 时收敛，和 S = a/(1-r)。判断级数敛散用比值检验、比较检验等。",
    "enBody": "Geometric sum Sₙ = a(1-rⁿ)/(1-r). An infinite geometric series converges when |r|<1 with sum S = a/(1-r). Test convergence with the ratio test or comparison test.",
    "quiz": {
      "question": "无穷等比级数收敛条件是？",
      "options": [
        "|r|<1",
        "|r|>1",
        "r=1",
        "任意 r"
      ],
      "answerIndex": 0,
      "explanation": "公比绝对值小于 1 时级数收敛。"
    }
  },
  {
    "id": "ib_aa_i8",
    "courseId": "ib_math_aa",
    "chapterId": "ib_math_aa_ch0",
    "type": "lecture",
    "title": "复数根与单位根",
    "enTitle": "Complex Roots",
    "body": "方程 zⁿ = 1 有 n 个复数根，均匀分布在单位圆上，称为 n 次单位根。用棣莫弗定理求根：z = cos(2kπ/n) + i sin(2kπ/n)。这些根在复平面成对称分布。",
    "enBody": "The equation zⁿ = 1 has n complex roots evenly spaced on the unit circle, called nth roots of unity. Use De Moivre: z = cos(2kπ/n) + i sin(2kπ/n). The roots are symmetric on the complex plane.",
    "quiz": {
      "question": "z⁴=1 有几个复数根？",
      "options": [
        "1",
        "2",
        "4",
        "无穷"
      ],
      "answerIndex": 2,
      "explanation": "z⁴=1 有 4 个根，均匀分布在单位圆上。"
    }
  },
  {
    "id": "ib_ai_i5",
    "courseId": "ib_math_ai",
    "chapterId": "ib_math_ai_ch0",
    "type": "lecture",
    "title": "图论基础",
    "enTitle": "Introduction to Graph Theory",
    "body": "图由顶点和边构成。欧拉路径经过每条边一次，哈密顿路径经过每个顶点一次。最小生成树用 Kruskal 或 Prim 算法。图论用于路线规划、网络设计。",
    "enBody": "A graph consists of vertices and edges. An Eulerian path visits each edge once; a Hamiltonian path visits each vertex once. Minimum spanning trees use Kruskal or Prim. Graphs model routing and networks.",
    "quiz": {
      "question": "经过每条边恰好一次的路径叫？",
      "options": [
        "欧拉路径",
        "哈密顿路径",
        "生成树",
        "最短路径"
      ],
      "answerIndex": 0,
      "explanation": "欧拉路径遍历所有边一次，哈密顿路径遍历所有顶点一次。"
    }
  },
  {
    "id": "ib_ai_i6",
    "courseId": "ib_math_ai",
    "chapterId": "ib_math_ai_ch0",
    "type": "lecture",
    "title": "二项分布与泊松",
    "enTitle": "Binomial and Poisson",
    "body": "二项分布 X~B(n,p) 描述 n 次独立试验成功次数，P(X=k)=C(n,k)p^k(1-p)^(n-k)。当 n 大 p 小时，泊松分布 Po(λ=np) 是良好近似，P(X=k)=λᵏe⁻λ/k!。",
    "enBody": "Binomial X~B(n,p) counts successes in n independent trials: P(X=k)=C(n,k)p^k(1-p)^(n-k). When n is large and p small, Poisson Po(λ=np) approximates it: P(X=k)=λᵏe⁻λ/k!.",
    "quiz": {
      "question": "泊松分布常用于近似？",
      "options": [
        "n 大 p 小的二项分布",
        "均匀分布",
        "正态分布",
        "指数分布"
      ],
      "answerIndex": 0,
      "explanation": "当 n 大 p 小时，泊松分布近似二项分布。"
    }
  },
  {
    "id": "ib_ai_i7",
    "courseId": "ib_math_ai",
    "chapterId": "ib_math_ai_ch0",
    "type": "lecture",
    "title": "矩阵与线性规划",
    "enTitle": "Matrices and Linear Programming",
    "body": "线性规划在约束条件下求目标函数最值。图解法：画可行域（约束不等式围成的区域），在顶点处求目标函数值。矩阵可表示线性方程组，用高斯消元求解。",
    "enBody": "Linear programming optimizes an objective under constraints. Graphically: draw the feasible region (bounded by constraint inequalities), then evaluate the objective at vertices. Matrices solve linear systems via Gaussian elimination.",
    "quiz": {
      "question": "线性规划最优解出现在？",
      "options": [
        "可行域内部",
        "可行域顶点",
        "原点",
        "任意点"
      ],
      "answerIndex": 1,
      "explanation": "线性规划最优解在可行域的顶点处取得。"
    }
  },
  {
    "id": "ib_ai_i8",
    "courseId": "ib_math_ai",
    "chapterId": "ib_math_ai_ch0",
    "type": "lecture",
    "title": "假设检验与 p 值",
    "enTitle": "Hypothesis Testing and p-values",
    "body": "假设检验判断样本是否支持某个假设。p 值是原假设成立时观察到当前结果的概率。p < 显著性水平 α（通常 0.05）则拒绝原假设。IB 要求会用 GDC 计算 p 值。",
    "enBody": "Hypothesis testing judges whether a sample supports a claim. The p-value is the probability of observing the result if H₀ is true. Reject H₀ if p < α (typically 0.05). IB requires computing p-values with a GDC.",
    "quiz": {
      "question": "p < 0.05 时应该？",
      "options": [
        "接受原假设",
        "拒绝原假设",
        "无结论",
        "重新取样"
      ],
      "answerIndex": 1,
      "explanation": "p 值小于显著性水平时拒绝原假设。"
    }
  },
  {
    "id": "igcse_phy_i5",
    "courseId": "igcse_phy",
    "chapterId": "igcse_phy_ch0",
    "type": "lecture",
    "title": "波的性质",
    "enTitle": "Properties of Waves",
    "body": "波速 v = fλ（频率 × 波长）。横波振动方向垂直传播方向（光波），纵波振动方向平行（声波）。反射、折射、衍射是波的三种基本现象。",
    "enBody": "Wave speed v = fλ (frequency × wavelength). Transverse waves oscillate perpendicular to travel (light); longitudinal waves parallel (sound). Reflection, refraction, and diffraction are three basic phenomena.",
    "quiz": {
      "question": "波速等于？",
      "options": [
        "fλ",
        "f/λ",
        "λ/f",
        "f+λ"
      ],
      "answerIndex": 0,
      "explanation": "波速 = 频率 × 波长 = fλ。"
    }
  },
  {
    "id": "igcse_phy_i6",
    "courseId": "igcse_phy",
    "chapterId": "igcse_phy_ch0",
    "type": "lecture",
    "title": "光的反射与折射",
    "enTitle": "Reflection and Refraction",
    "body": "反射定律：入射角等于反射角。折射定律（斯涅尔定律）：n₁sinθ₁ = n₂sinθ₂。光从光密到光疏介质且入射角大于临界角时发生全反射。",
    "enBody": "Law of reflection: angle of incidence equals angle of reflection. Snell's law: n₁sinθ₁ = n₂sinθ₂. Total internal reflection occurs from denser to rarer media beyond the critical angle.",
    "quiz": {
      "question": "斯涅尔定律是？",
      "options": [
        "n₁sinθ₁=n₂sinθ₂",
        "n₁=n₂",
        "sinθ=0",
        "n₁θ₁=n₂θ₂"
      ],
      "answerIndex": 0,
      "explanation": "斯涅尔定律：n₁sinθ₁ = n₂sinθ₂。"
    }
  },
  {
    "id": "igcse_phy_i7",
    "courseId": "igcse_phy",
    "chapterId": "igcse_phy_ch0",
    "type": "lecture",
    "title": "热传导三种方式",
    "enTitle": "Heat Transfer",
    "body": "热传递三种方式：传导（固体分子碰撞）、对流（流体流动）、辐射（电磁波，无需介质）。真空瓶利用真空阻止传导和对流，镀银面反射辐射。",
    "enBody": "Three modes of heat transfer: conduction (molecular collisions in solids), convection (fluid flow), radiation (electromagnetic, no medium needed). A vacuum flask stops conduction and convection via vacuum, and radiation via silvering.",
    "quiz": {
      "question": "无需介质的传热方式是？",
      "options": [
        "传导",
        "对流",
        "辐射",
        "以上都不是"
      ],
      "answerIndex": 2,
      "explanation": "辐射通过电磁波传热，不需要介质。"
    }
  },
  {
    "id": "igcse_phy_i8",
    "courseId": "igcse_phy",
    "chapterId": "igcse_phy_ch0",
    "type": "lecture",
    "title": "电路元件与电阻",
    "enTitle": "Circuit Components",
    "body": "电阻串联 R=R₁+R₂，并联 1/R=1/R₁+1/R₂。常见元件：电阻器、二极管（单向导电）、热敏电阻（温度变化）、光敏电阻（光照变化）。伏安特性曲线描述元件特性。",
    "enBody": "Resistors in series: R=R₁+R₂; in parallel: 1/R=1/R₁+1/R₂. Common components: resistor, diode (one-way), thermistor (temperature), LDR (light). I-V curves describe component behavior.",
    "quiz": {
      "question": "两个相同电阻 R 并联，总电阻是？",
      "options": [
        "2R",
        "R/2",
        "R",
        "R²"
      ],
      "answerIndex": 1,
      "explanation": "并联 1/R总=1/R+1/R，故 R总=R/2。"
    }
  },
  {
    "id": "alevel_math_i5",
    "courseId": "alevel_math",
    "chapterId": "alevel_math_ch0",
    "type": "lecture",
    "title": "反函数求导",
    "enTitle": "Derivative of Inverse Functions",
    "body": "反函数求导公式：(f⁻¹)'(y) = 1/f'(x)，其中 y=f(x)。可用于求反三角函数导数。本质是链式法则的运用：f(f⁻¹(x))=x 两边求导。",
    "enBody": "Derivative of an inverse function: (f⁻¹)'(y) = 1/f'(x), where y=f(x). This derives inverse trig derivatives and follows from differentiating f(f⁻¹(x))=x.",
    "quiz": {
      "question": "(f⁻¹)'(y) 等于？",
      "options": [
        "1/f'(x)",
        "f'(x)",
        "-f'(x)",
        "f'(x)²"
      ],
      "answerIndex": 0,
      "explanation": "反函数求导是原函数导数的倒数。"
    }
  },
  {
    "id": "alevel_math_i6",
    "courseId": "alevel_math",
    "chapterId": "alevel_math_ch0",
    "type": "lecture",
    "title": "参数方程求导",
    "enTitle": "Parametric Differentiation",
    "body": "参数方程 x=f(t), y=g(t)，导数 dy/dx = (dy/dt)/(dx/dt)。二阶导 d²y/dx² = d/dx(dy/dx) = [d/dt(dy/dx)]/(dx/dt)。用于求切线斜率。",
    "enBody": "For parametric x=f(t), y=g(t), the derivative is dy/dx = (dy/dt)/(dx/dt). The second derivative is d²y/dx² = [d/dt(dy/dx)]/(dx/dt).",
    "quiz": {
      "question": "参数方程 dy/dx 等于？",
      "options": [
        "(dy/dt)/(dx/dt)",
        "dy/dt·dx/dt",
        "dx/dt/dy/dt",
        "dy/dx·dt"
      ],
      "answerIndex": 0,
      "explanation": "dy/dx = (dy/dt)/(dx/dt)。"
    }
  },
  {
    "id": "alevel_math_i7",
    "courseId": "alevel_math",
    "chapterId": "alevel_math_ch0",
    "type": "lecture",
    "title": "微分方程建模",
    "enTitle": "Modelling with Differential Equations",
    "body": "实际问题（人口增长、冷却、放射性衰变）可建模为微分方程。常见模型：指数增长 dy/dt = ky，解为 y = Ce^(kt)。解题：建方程 → 解方程 → 用初始条件定常数 → 解释结果。",
    "enBody": "Real problems (population, cooling, decay) are modelled by differential equations. A common model is dy/dt = ky with solution y = Ce^(kt). Steps: set up, solve, apply initial conditions, interpret.",
    "quiz": {
      "question": "dy/dt = ky 的通解是？",
      "options": [
        "y=Ce^(kt)",
        "y=kt+C",
        "y=k ln t",
        "y=t^k"
      ],
      "answerIndex": 0,
      "explanation": "指数增长方程的解为 y = Ce^(kt)。"
    }
  },
  {
    "id": "alevel_math_i8",
    "courseId": "alevel_math",
    "chapterId": "alevel_math_ch0",
    "type": "lecture",
    "title": "级数求和与收敛",
    "enTitle": "Series and Convergence",
    "body": "等差、等比级数求和公式是基础。泰勒级数、麦克劳林级数用于函数逼近。判断级数收敛用比值检验、积分检验等。收敛半径决定幂级数有效范围。",
    "enBody": "Arithmetic and geometric series sums are foundational. Taylor and Maclaurin series approximate functions. Test convergence with the ratio or integral test. The radius of convergence bounds a power series.",
    "quiz": {
      "question": "等比级数公比 |r|<1 时无穷和是？",
      "options": [
        "a/(1-r)",
        "a(1-r)",
        "a rⁿ",
        "a/(r-1)"
      ],
      "answerIndex": 0,
      "explanation": "无穷等比级数和 S = a/(1-r)。"
    }
  },
  {
    "id": "alevel_phy_i5",
    "courseId": "alevel_phy",
    "chapterId": "alevel_phy_ch0",
    "type": "lecture",
    "title": "简谐运动",
    "enTitle": "Simple Harmonic Motion",
    "body": "简谐运动（SHM）回复力与位移成正比反向：F = -kx。位移 x = A cos(ωt)，速度 v = -Aω sin(ωt)。周期 T = 2π√(m/k)。弹簧振子和单摆是典型例子。",
    "enBody": "In SHM, the restoring force is proportional and opposite to displacement: F = -kx. Displacement x = A cos(ωt), velocity v = -Aω sin(ωt). Period T = 2π√(m/k). Spring and pendulum are examples.",
    "quiz": {
      "question": "SHM 回复力的特点是？",
      "options": [
        "与位移成正比反向",
        "恒为常数",
        "与速度成正比",
        "与位移平方成正比"
      ],
      "answerIndex": 0,
      "explanation": "F = -kx，回复力与位移成正比且方向相反。"
    }
  },
  {
    "id": "alevel_phy_i6",
    "courseId": "alevel_phy",
    "chapterId": "alevel_phy_ch0",
    "type": "lecture",
    "title": "引力场",
    "enTitle": "Gravitational Fields",
    "body": "万有引力 F = GMm/r²。引力场强度 g = GM/r²。引力势能 U = -GMm/r。卫星轨道、逃逸速度 v = √(2GM/r) 都是引力场应用。",
    "enBody": "Gravitational force F = GMm/r². Field strength g = GM/r². Potential energy U = -GMm/r. Satellite orbits and escape velocity v = √(2GM/r) are applications.",
    "quiz": {
      "question": "万有引力与距离的关系是？",
      "options": [
        "正比 r",
        "反比 r²",
        "反比 r",
        "正比 r²"
      ],
      "answerIndex": 1,
      "explanation": "F = GMm/r²，与距离平方成反比。"
    }
  },
  {
    "id": "alevel_phy_i7",
    "courseId": "alevel_phy",
    "chapterId": "alevel_phy_ch0",
    "type": "lecture",
    "title": "电容与充放电",
    "enTitle": "Capacitance and Charging",
    "body": "电容 C = Q/V。平行板电容 C = εA/d。充电时电压按指数上升，放电时指数下降，时间常数 τ = RC。电容储能 E = ½CV²。",
    "enBody": "Capacitance C = Q/V. Parallel plate C = εA/d. Charging raises voltage exponentially, discharging lowers it, with time constant τ = RC. Stored energy E = ½CV².",
    "quiz": {
      "question": "电容储能公式是？",
      "options": [
        "½CV²",
        "CV",
        "½CV",
        "CV²/4"
      ],
      "answerIndex": 0,
      "explanation": "电容储存的能量 E = ½CV²。"
    }
  },
  {
    "id": "alevel_phy_i8",
    "courseId": "alevel_phy",
    "chapterId": "alevel_phy_ch0",
    "type": "lecture",
    "title": "电磁感应",
    "enTitle": "Electromagnetic Induction",
    "body": "法拉第定律：感应电动势 ε = -N·dΦ/dt（磁通量变化率）。楞次定律：感应电流方向总是阻碍磁通量变化。发电机、变压器都基于电磁感应。",
    "enBody": "Faraday's law: induced emf ε = -N·dΦ/dt (rate of flux change). Lenz's law: the induced current opposes the flux change. Generators and transformers rely on induction.",
    "quiz": {
      "question": "法拉第定律中 ε 与什么成正比？",
      "options": [
        "磁通量",
        "磁通量变化率",
        "磁通量平方",
        "时间"
      ],
      "answerIndex": 1,
      "explanation": "感应电动势与磁通量的变化率成正比。"
    }
  },
  {
    "id": "ib_math_i5",
    "courseId": "ib_math",
    "chapterId": "ib_math_ch0",
    "type": "lecture",
    "title": "向量点积与夹角",
    "enTitle": "Dot Product and Angles",
    "body": "点积 a·b = |a||b|cosθ，用于求两向量夹角：cosθ = a·b/(|a||b|)。点积为 0 则两向量垂直。投影：a 在 b 上的投影长度 = a·b/|b|。",
    "enBody": "The dot product a·b = |a||b|cosθ finds the angle: cosθ = a·b/(|a||b|). If the dot product is 0, the vectors are perpendicular. Projection of a onto b = a·b/|b|.",
    "quiz": {
      "question": "a·b = 0 说明两向量？",
      "options": [
        "平行",
        "垂直",
        "相等",
        "反向"
      ],
      "answerIndex": 1,
      "explanation": "点积为零表示两向量垂直。"
    }
  },
  {
    "id": "ib_math_i6",
    "courseId": "ib_math",
    "chapterId": "ib_math_ch0",
    "type": "lecture",
    "title": "矩阵逆与行列式",
    "enTitle": "Matrix Inverse and Determinant",
    "body": "2×2 矩阵逆：A⁻¹ = (1/det)(d -b; -c a)，det = ad-bc。det=0 时矩阵不可逆。行列式表示线性变换的面积缩放因子。用逆矩阵解线性方程组 AX=B → X=A⁻¹B。",
    "enBody": "For a 2×2 matrix, A⁻¹ = (1/det)(d -b; -c a) with det = ad-bc. If det=0, the matrix is singular. The determinant is the area scale factor. Solve AX=B as X=A⁻¹B.",
    "quiz": {
      "question": "det=0 说明矩阵？",
      "options": [
        "可逆",
        "不可逆",
        "是单位阵",
        "是对称阵"
      ],
      "answerIndex": 1,
      "explanation": "行列式为零的矩阵不可逆（奇异矩阵）。"
    }
  },
  {
    "id": "ib_math_i7",
    "courseId": "ib_math",
    "chapterId": "ib_math_ch0",
    "type": "lecture",
    "title": "微积分基本定理",
    "enTitle": "Fundamental Theorem of Calculus",
    "body": "微积分基本定理联系了微分与积分：∫ₐᵇ f(x)dx = F(b) - F(a)，其中 F 是 f 的原函数。它使定积分计算变得直接。变上限积分求导 d/dx ∫ₐˣ f(t)dt = f(x)。",
    "enBody": "The fundamental theorem links differentiation and integration: ∫ₐᵇ f(x)dx = F(b) - F(a), where F is an antiderivative. This makes definite integrals straightforward. Also d/dx ∫ₐˣ f(t)dt = f(x).",
    "quiz": {
      "question": "∫ₐᵇ f(x)dx 等于？",
      "options": [
        "F(b)-F(a)",
        "F(a)-F(b)",
        "F(b)+F(a)",
        "f(b)-f(a)"
      ],
      "answerIndex": 0,
      "explanation": "定积分等于原函数在上下限的值之差。"
    }
  },
  {
    "id": "ib_math_i8",
    "courseId": "ib_math",
    "chapterId": "ib_math_ch0",
    "type": "lecture",
    "title": "正态分布标准化",
    "enTitle": "Standardizing the Normal Distribution",
    "body": "标准正态分布 N(0,1)。标准化：Z = (X-μ)/σ，把任意正态分布转化为标准正态。用 Z 表或 GDC 求概率 P(X<x)。反查表可求给定概率对应的临界值。",
    "enBody": "The standard normal is N(0,1). Standardize with Z = (X-μ)/σ to convert any normal to standard. Use a Z-table or GDC for P(X<x). Inverse lookup finds critical values for a given probability.",
    "quiz": {
      "question": "标准化公式是？",
      "options": [
        "(X-μ)/σ",
        "(X+μ)/σ",
        "X·σ+μ",
        "(X-σ)/μ"
      ],
      "answerIndex": 0,
      "explanation": "Z = (X-μ)/σ。"
    }
  },
  {
    "id": "ib_phy_i5",
    "courseId": "ib_phy",
    "chapterId": "ib_phy_ch0",
    "type": "lecture",
    "title": "动量守恒",
    "enTitle": "Conservation of Momentum",
    "body": "孤立系统总动量守恒。碰撞分弹性（动能守恒）和非弹性（动能损失）。动量守恒与能量守恒联立解碰撞问题。火箭推进基于动量守恒。",
    "enBody": "Total momentum is conserved in an isolated system. Collisions are elastic (kinetic energy conserved) or inelastic (energy lost). Solve collision problems with momentum and energy conservation. Rockets rely on momentum conservation.",
    "quiz": {
      "question": "弹性碰撞中守恒的是？",
      "options": [
        "仅动量",
        "仅动能",
        "动量和动能",
        "都不守恒"
      ],
      "answerIndex": 2,
      "explanation": "弹性碰撞同时守恒动量和动能。"
    }
  },
  {
    "id": "ib_phy_i6",
    "courseId": "ib_phy",
    "chapterId": "ib_phy_ch0",
    "type": "lecture",
    "title": "光电效应",
    "enTitle": "The Photoelectric Effect",
    "body": "光照射金属表面逸出电子。爱因斯坦方程：hf = φ + KE_max（光子能量 = 逸出功 + 最大动能）。阈值频率 f₀ = φ/h，低于此频率无论光多强都不逸出电子。",
    "enBody": "Light ejects electrons from metal surfaces. Einstein's equation: hf = φ + KE_max. The threshold frequency f₀ = φ/h — below it, no electrons escape regardless of intensity.",
    "quiz": {
      "question": "爱因斯坦光电方程是？",
      "options": [
        "hf=φ+KE_max",
        "E=mc²",
        "F=ma",
        "V=IR"
      ],
      "answerIndex": 0,
      "explanation": "光子能量 = 逸出功 + 最大动能。"
    }
  },
  {
    "id": "ib_phy_i7",
    "courseId": "ib_phy",
    "chapterId": "ib_phy_ch0",
    "type": "lecture",
    "title": "双缝干涉",
    "enTitle": "Double-Slit Interference",
    "body": "双缝干涉条纹间距 x = λD/d（λ 波长、D 屏距、d 缝距）。亮纹满足 d sinθ = nλ，暗纹满足 d sinθ = (n+½)λ。实验证明光的波动性。",
    "enBody": "Double-slit fringe spacing x = λD/d (λ wavelength, D screen distance, d slit separation). Bright fringes: d sinθ = nλ; dark: d sinθ = (n+½)λ. The experiment proves light's wave nature.",
    "quiz": {
      "question": "条纹间距与波长 λ 的关系是？",
      "options": [
        "正比",
        "反比",
        "无关",
        "平方"
      ],
      "answerIndex": 0,
      "explanation": "x = λD/d，条纹间距与波长成正比。"
    }
  },
  {
    "id": "ib_phy_i8",
    "courseId": "ib_phy",
    "chapterId": "ib_phy_ch0",
    "type": "lecture",
    "title": "放射性衰变",
    "enTitle": "Radioactive Decay",
    "body": "衰变定律 N = N₀e^(-λt)，λ 是衰变常数。半衰期 T½ = ln2/λ。活度 A = λN，单位贝克勒尔（Bq）。衰变是随机的，半衰期是统计规律。",
    "enBody": "Decay law N = N₀e^(-λt) with decay constant λ. Half-life T½ = ln2/λ. Activity A = λN in becquerels (Bq). Decay is random; half-life is a statistical rule.",
    "quiz": {
      "question": "半衰期 T½ 等于？",
      "options": [
        "ln2/λ",
        "λ/ln2",
        "2λ",
        "λ²"
      ],
      "answerIndex": 0,
      "explanation": "T½ = ln2/λ。"
    }
  }
];

const courses = [
  {
    "id": "ielts_listening",
    "name": "雅思听力",
    "emoji": "🎧",
    "desc": "8 个知识点",
    "progress": 0,
    "systemId": "ielts"
  },
  {
    "id": "toefl_b2",
    "name": "托福进阶",
    "emoji": "📚",
    "desc": "8 个知识点",
    "progress": 0,
    "systemId": "toefl"
  },
  {
    "id": "toefl_adv",
    "name": "托福冲刺",
    "emoji": "📚",
    "desc": "8 个知识点",
    "progress": 0,
    "systemId": "toefl"
  },
  {
    "id": "igcse_math",
    "name": "IGCSE数学",
    "emoji": "🧮",
    "desc": "8 个知识点",
    "progress": 0,
    "systemId": "igcse"
  },
  {
    "id": "igcse_addmath",
    "name": "IGCSE附加数学",
    "emoji": "🧮",
    "desc": "8 个知识点",
    "progress": 0,
    "systemId": "igcse"
  },
  {
    "id": "alevel_pure3",
    "name": "A-Level纯数3",
    "emoji": "📐",
    "desc": "8 个知识点",
    "progress": 0,
    "systemId": "alevel"
  },
  {
    "id": "alevel_mech",
    "name": "A-Level力学",
    "emoji": "📐",
    "desc": "8 个知识点",
    "progress": 0,
    "systemId": "alevel"
  },
  {
    "id": "ib_math_aa",
    "name": "IB数学AA",
    "emoji": "⚛️",
    "desc": "8 个知识点",
    "progress": 0,
    "systemId": "ib"
  },
  {
    "id": "ib_math_ai",
    "name": "IB数学AI",
    "emoji": "⚛️",
    "desc": "8 个知识点",
    "progress": 0,
    "systemId": "ib"
  },
  {
    "id": "ap_calc",
    "name": "AP微积分",
    "emoji": "📊",
    "desc": "8 个知识点",
    "progress": 0,
    "systemId": "ap"
  },
  {
    "id": "ap_stats",
    "name": "AP统计",
    "emoji": "📊",
    "desc": "8 个知识点",
    "progress": 0,
    "systemId": "ap"
  },
  {
    "id": "sat_math",
    "name": "SAT数学",
    "emoji": "✏️",
    "desc": "8 个知识点",
    "progress": 0,
    "systemId": "sat"
  },
  {
    "id": "sat_write",
    "name": "SAT文法",
    "emoji": "✏️",
    "desc": "8 个知识点",
    "progress": 0,
    "systemId": "sat"
  },
  {
    "id": "igcse_phy",
    "name": "IGCSE物理",
    "emoji": "🧮",
    "desc": "8 个知识点",
    "progress": 0,
    "systemId": "igcse"
  },
  {
    "id": "alevel_math",
    "name": "A-Level数学",
    "emoji": "📐",
    "desc": "8 个知识点",
    "progress": 0,
    "systemId": "alevel"
  },
  {
    "id": "alevel_phy",
    "name": "A-Level物理",
    "emoji": "📐",
    "desc": "8 个知识点",
    "progress": 0,
    "systemId": "alevel"
  },
  {
    "id": "ib_math",
    "name": "IB数学",
    "emoji": "⚛️",
    "desc": "8 个知识点",
    "progress": 0,
    "systemId": "ib"
  },
  {
    "id": "ib_phy",
    "name": "IB物理",
    "emoji": "⚛️",
    "desc": "8 个知识点",
    "progress": 0,
    "systemId": "ib"
  },
  {
    "id": "toefl_b1",
    "name": "托福基础",
    "emoji": "📚",
    "desc": "8 个知识点",
    "progress": 0,
    "systemId": "toefl"
  },
  {
    "id": "ielts_speaking",
    "name": "雅思口语",
    "emoji": "🎧",
    "desc": "8 个知识点",
    "progress": 0,
    "systemId": "ielts"
  },
  {
    "id": "ielts_reading",
    "name": "雅思阅读",
    "emoji": "🎧",
    "desc": "8 个知识点",
    "progress": 0,
    "systemId": "ielts"
  },
  {
    "id": "ielts_writing",
    "name": "雅思写作",
    "emoji": "🎧",
    "desc": "8 个知识点",
    "progress": 0,
    "systemId": "ielts"
  }
];

const chapters = [
  {
    "id": "ielts_listening_ch0",
    "courseId": "ielts_listening",
    "title": "雅思听力 · 核心知识",
    "items": [
      {
        "id": "ielts_listening_basics",
        "title": "雅思听力基础：定位词",
        "learned": false,
        "videoUrl": "",
        "enBody": "Locating words help you quickly find the sentence that contains the answer. The best locating words are proper nouns (names, places, institutions) and numbers, because they are rarely paraphrased. When you hear a locating word, be alert: the answer usually follows immediately."
      },
      {
        "id": "ielts_listening_i2",
        "title": "填空题：预判词性与单复数",
        "learned": false,
        "videoUrl": "",
        "enBody": "Before the audio, read the question and predict whether the blank needs a noun, a number, or an adjective, and whether it is countable. If you miss the plural \"s\" in the recording, use grammar to decide — omitting \"s\" is marked wrong."
      },
      {
        "id": "ielts_listening_i3",
        "title": "地图题：方位词速记",
        "learned": false,
        "videoUrl": "",
        "enBody": "High-frequency map words: opposite, next to, at the end of, behind, between A and B. As soon as you hear a direction word, mark the position on the map; do not wait until the audio ends."
      },
      {
        "id": "ielts_listening_i4",
        "title": "多选题：答案往往分散出现",
        "learned": false,
        "videoUrl": "",
        "enBody": "In IELTS multiple choice, correct answers are usually scattered across the recording, not grouped together. So select an answer as soon as you hear it rather than waiting for all options to be covered, or you will miss later ones."
      },
      {
        "id": "ielts_listening_i5",
        "title": "配对题：先读选项预判改写",
        "learned": false,
        "videoUrl": "",
        "enBody": "Matching options are often paraphrased and never appear verbatim. Read the options first and predict how each might be reworded. For example, \"long opening hours\" may be said as \"open until midnight\"."
      },
      {
        "id": "ielts_listening_i6",
        "title": "数字与字母听写",
        "learned": false,
        "videoUrl": "",
        "enBody": "Phone numbers, addresses, and postcodes are common. Beware of confusable sounds: 13 vs 30, 14 vs 40. Letters are often given by spelling words (A for Apple). Repeat tricky digits mentally before writing."
      },
      {
        "id": "ielts_listening_i7",
        "title": "否定词陷阱",
        "learned": false,
        "videoUrl": "",
        "enBody": "A common trap is first agreeing then contradicting: \"I'd love to go, but I can't.\" The answer is what follows \"but\". Watch hidden negatives like hardly, rarely, seldom, and phrases like would rather not."
      },
      {
        "id": "ielts_listening_i8",
        "title": "答案词性核对",
        "learned": false,
        "videoUrl": "",
        "enBody": "Blank answers must match the grammar of the question. If the prompt reads \"a ___ of water\", the answer must be a noun (e.g. glass). After writing, re-read to check number, tense, and word form."
      }
    ]
  },
  {
    "id": "toefl_b2_ch0",
    "courseId": "toefl_b2",
    "title": "托福进阶 · 核心知识",
    "items": [
      {
        "id": "toefl_b2_i1",
        "title": "Cornell 笔记法",
        "learned": false,
        "videoUrl": "",
        "enBody": "TOEFL lectures are information-dense, so the Cornell method helps: divide the page into a main column (right, key points), a cue column (left, keywords), and a summary bar (bottom). Take notes in the main column while listening, write cues during pauses, and spend 10 seconds summarizing at the end."
      },
      {
        "id": "toefl_b2_i2",
        "title": "信号词",
        "learned": false,
        "videoUrl": "",
        "enBody": "Signal words in lectures reveal structure and emphasis. Listing: first, besides, another. Contrast: however, but, in contrast. Cause-effect: therefore, as a result, consequently. Examples: for instance, such as, take ... as an example. Be especially alert when you hear cause-effect signals."
      },
      {
        "id": "toefl_b2_i3",
        "title": "讲座结构",
        "learned": false,
        "videoUrl": "",
        "enBody": "Academic lectures follow a stable structure: introduce the topic, give background, define the core concept, develop points, give examples, then the professor evaluates and summarizes. Predicting this structure lets you locate information early — hearing \"let's define\" tells you a definition is coming."
      },
      {
        "id": "toefl_b2_i4",
        "title": "速记符号",
        "learned": false,
        "videoUrl": "",
        "enBody": "Use symbols instead of full words in notes: an arrow (→) means \"leads to\", (←) \"comes from\", (↑) increase, (↓) decrease, (∵) because, (∴) therefore, (=) equals or means, (×) not or wrong, (≠) different. Symbols help you keep up with the speaker's pace."
      },
      {
        "id": "toefl_b2_i5",
        "title": "讲座重听题",
        "learned": false,
        "videoUrl": "",
        "enBody": "Replay questions replay a segment and ask about intent or attitude. Listen to tone, not just words: stress, pauses, and rhetorical questions reveal attitude. Note corrective openings like \"Actually / Well / I mean\"."
      },
      {
        "id": "toefl_b2_i6",
        "title": "推断题：言外之意",
        "learned": false,
        "videoUrl": "",
        "enBody": "Inference answers are not stated directly but follow from the text. Infer one small step, not a leap. Eliminate options that are stated outright or unfounded, and choose the one closest to the passage logic."
      },
      {
        "id": "toefl_b2_i7",
        "title": "组织结构题",
        "learned": false,
        "videoUrl": "",
        "enBody": "Organization questions ask why the professor mentions an example or idea. The answer is usually \"to illustrate/support/contrast a prior concept\". Locate the item and identify which argument it serves."
      },
      {
        "id": "toefl_b2_i8",
        "title": "综合口语 Task 4",
        "learned": false,
        "videoUrl": "",
        "enBody": "Task 4 retells an academic lecture. Structure: restate the concept's definition, then the example. Note both the \"concept\" and \"example\" lines, and link them in your own words within 60 seconds."
      }
    ]
  },
  {
    "id": "toefl_adv_ch0",
    "courseId": "toefl_adv",
    "title": "托福冲刺 · 核心知识",
    "items": [
      {
        "id": "toefl_adv_i1",
        "title": "整合框架",
        "learned": false,
        "videoUrl": "",
        "enBody": "Integrated writing is a \"reading vs. listening\" contrast framework. The reading presents three points, and the lecture rebuts them one by one. Basic structure: an introduction summarizing the relationship, then three body paragraphs (each stating a reading point, then the lecture's counterargument)."
      },
      {
        "id": "toefl_adv_i2",
        "title": "模板句式",
        "learned": false,
        "videoUrl": "",
        "enBody": "High-frequency templates: \"The reading passage argues that ... However, the lecturer challenges this by explaining that ...\" Remember that templates only build the skeleton; over 70% of your essay must be your own language and details, not copied verbatim."
      },
      {
        "id": "toefl_adv_i3",
        "title": "阅读预判",
        "learned": false,
        "videoUrl": "",
        "enBody": "During the 3-minute reading phase, mark the three arguments with your pencil: look for \"firstly / secondly / finally\" or topic sentences. Summarize each point in one sentence in advance, which prepares you to locate the lecture's rebuttals."
      },
      {
        "id": "toefl_adv_i4",
        "title": "评分标准",
        "learned": false,
        "videoUrl": "",
        "enBody": "Integrated writing is scored on completeness (covering all reading and listening points), accuracy (not distorting information), and clarity. Missing one point usually rules out a 28+ score. So prefer less ornamentation over omitting key points."
      },
      {
        "id": "toefl_adv_i5",
        "title": "独立写作立论",
        "learned": false,
        "videoUrl": "",
        "enBody": "A strong intro has a hook and a clear thesis. Take a clear, arguable stance — no fence-sitting. Use: \"While some argue X, I believe Y for two reasons\" and preview your body paragraphs."
      },
      {
        "id": "toefl_adv_i6",
        "title": "例子充分性",
        "learned": false,
        "videoUrl": "",
        "enBody": "Every point needs concrete support; vague statements lose points. Examples can be personal, historical, or common knowledge, but must be specific: who, what, and the result. One specific example beats three vague claims."
      },
      {
        "id": "toefl_adv_i7",
        "title": "让步与反驳",
        "learned": false,
        "videoUrl": "",
        "enBody": "High-scoring essays include a concession: acknowledge the counterargument (Admittedly, ...), then rebut with \"however\". This shows balanced thinking, but keep the concession brief so it does not weaken your position."
      },
      {
        "id": "toefl_adv_i8",
        "title": "结尾段：升华不重复",
        "learned": false,
        "videoUrl": "",
        "enBody": "Do not repeat the body verbatim. Instead, paraphrase your position and elevate it (look ahead, call to action, or summarize value). Keep it to 2-3 strong sentences and introduce no new arguments."
      }
    ]
  },
  {
    "id": "igcse_math_ch0",
    "courseId": "igcse_math",
    "title": "IGCSE数学 · 核心知识",
    "items": [
      {
        "id": "igcse_math_i1",
        "title": "一元二次方程",
        "learned": false,
        "videoUrl": "",
        "enBody": "The quadratic ax² + bx + c = 0 can be solved three ways: factoring (fastest), completing the square (rigorous), and the quadratic formula x = [-b ± √(b²-4ac)] / (2a). The discriminant Δ = b² - 4ac: Δ > 0 gives two real roots, Δ = 0 one repeated root, Δ < 0 no real roots."
      },
      {
        "id": "igcse_math_i2",
        "title": "因式分解",
        "learned": false,
        "videoUrl": "",
        "enBody": "Factorisation writes a polynomial as a product of factors. Common cases: taking a common factor ax + bx = x(a+b); difference of squares a² - b² = (a+b)(a-b); perfect square a² ± 2ab + b² = (a±b)². First look for a common factor, then for a special form."
      },
      {
        "id": "igcse_math_i3",
        "title": "完全平方",
        "learned": false,
        "videoUrl": "",
        "enBody": "Perfect-square trinomials: a² + 2ab + b² = (a+b)² and a² - 2ab + b² = (a-b)². The key check: can the first and last terms form a square, and is the middle term twice the product? For example, x² + 6x + 9 = (x+3)²."
      },
      {
        "id": "igcse_math_i4",
        "title": "解不等式",
        "learned": false,
        "videoUrl": "",
        "enBody": "Solving inequalities is like solving equations, but multiplying or dividing by a negative reverses the direction. Example: -2x < 6 → x > -3. Show solution sets on a number line with a closed dot for inclusive and an open dot for exclusive. Note the difference between \"at least\" and \"more than\"."
      },
      {
        "id": "igcse_math_i5",
        "title": "因式分解 quadratics",
        "learned": false,
        "videoUrl": "",
        "enBody": "To factor ax²+bx+c, find two numbers whose product is c and whose sum is b (when a = 1). Example: x²+5x+6 = (x+2)(x+3). When a ≠ 1, use grouping or splitting the middle term."
      },
      {
        "id": "igcse_math_i6",
        "title": "三角函数基础",
        "learned": false,
        "videoUrl": "",
        "enBody": "SOH-CAH-TOA. Use sin/cos/tan to find sides from an angle, and inverse trig to find angles. Check the angle mode (degrees). Sine rule a/sinA = b/sinB; cosine rule c² = a²+b²-2ab cosC."
      },
      {
        "id": "igcse_math_i7",
        "title": "圆与圆周角定理",
        "learned": false,
        "videoUrl": "",
        "enBody": "The angle at the centre is twice the angle at the circumference on the same arc. An angle in a semicircle is 90°. Angles on the same arc are equal. A perpendicular from the centre to a chord bisects it."
      },
      {
        "id": "igcse_math_i8",
        "title": "概率",
        "learned": false,
        "videoUrl": "",
        "enBody": "P(A) = favourable outcomes / total outcomes. Mutually exclusive events: P(A∪B) = P(A)+P(B). Independent events: P(A∩B) = P(A)×P(B). Complement: P(not A) = 1 - P(A)."
      }
    ]
  },
  {
    "id": "igcse_addmath_ch0",
    "courseId": "igcse_addmath",
    "title": "IGCSE附加数学 · 核心知识",
    "items": [
      {
        "id": "igcse_am_i1",
        "title": "微分基本规则",
        "learned": false,
        "videoUrl": "",
        "enBody": "Differentiation finds a rate of change. Power rule: d/dx (xⁿ) = nxⁿ⁻¹. The derivative of a constant is 0. For example, the derivative of y = x³ is 3x². Geometrically, the derivative is the slope of the tangent at that point."
      },
      {
        "id": "igcse_am_i2",
        "title": "切线斜率",
        "learned": false,
        "videoUrl": "",
        "enBody": "To find the tangent slope at a point on a curve, first differentiate, then substitute the point's x-coordinate. For example, y = x² at x = 3 has slope dy/dx = 2x = 6. A positive slope means increasing, negative means decreasing."
      },
      {
        "id": "igcse_am_i3",
        "title": "定积分",
        "learned": false,
        "videoUrl": "",
        "enBody": "A definite integral represents the area between a curve and the x-axis: ∫ₐᵇ f(x) dx = F(b) - F(a), where F is an antiderivative of f. For example, ∫₁³ x² dx = [x³/3]₁³ = 27/3 - 1/3 = 26/3. Take absolute values when the area is below the axis."
      },
      {
        "id": "igcse_am_i4",
        "title": "积分应用",
        "learned": false,
        "videoUrl": "",
        "enBody": "Integration finds displacement from a velocity function, area between curves (upper curve minus lower curve), and volume. In applications, draw the graph first to fix the limits of integration, then determine which curve is on top."
      },
      {
        "id": "igcse_am_i5",
        "title": "函数与反函数",
        "learned": false,
        "videoUrl": "",
        "enBody": "A function maps inputs to outputs. The inverse f⁻¹ maps outputs back to inputs. To find it, swap x and y in y=f(x), then solve for y. Inverse graphs are symmetric about the line y=x."
      },
      {
        "id": "igcse_am_i6",
        "title": "指数函数与对数",
        "learned": false,
        "videoUrl": "",
        "enBody": "Exponential y=aˣ and logarithmic y=log_a x are inverses. Change of base: log_a b = log b / log a. Solve exponential equations by taking logs. ln is the natural log with base e."
      },
      {
        "id": "igcse_am_i7",
        "title": "三角恒等式",
        "learned": false,
        "videoUrl": "",
        "enBody": "Key identities: sin²θ + cos²θ = 1 and tanθ = sinθ/cosθ. Double angle: sin2θ = 2sinθcosθ. Simplify to a single trig function, then find all solutions in the interval."
      },
      {
        "id": "igcse_am_i8",
        "title": "向量基础运算",
        "learned": false,
        "videoUrl": "",
        "enBody": "Vectors have magnitude and direction. Add by the parallelogram rule; scalar multiplication scales or reverses. Position vectors and unit vectors (magnitude 1) are common. Magnitude |v| = √(x²+y²)."
      }
    ]
  },
  {
    "id": "alevel_pure3_ch0",
    "courseId": "alevel_pure3",
    "title": "A-Level纯数3 · 核心知识",
    "items": [
      {
        "id": "alevel_p3_i1",
        "title": "分离变量法",
        "learned": false,
        "videoUrl": "",
        "enBody": "A separable differential equation has the form dy/dx = f(x)g(y). Method: move all y-terms to one side and x-terms to the other, then integrate both sides. Example: dy/dx = x/y gives y dy = x dx, so y²/2 = x²/2 + C, i.e. y² = x² + C."
      },
      {
        "id": "alevel_p3_i2",
        "title": "积分因子法",
        "learned": false,
        "videoUrl": "",
        "enBody": "For a first-order linear equation dy/dx + P(x)y = Q(x), use the integrating factor I = e^∫P dx. Multiplying through by I makes the left side equal to (Iy)', so integrating gives the general solution. Example: dy/dx + y = sin x has P(x) = 1 and I = eˣ."
      },
      {
        "id": "alevel_p3_i3",
        "title": "二阶常系数方程",
        "learned": false,
        "videoUrl": "",
        "enBody": "For ay'' + by' + cy = 0, solve the characteristic equation aλ² + bλ + c = 0. With two distinct real roots λ₁, λ₂, the general solution is y = A e^(λ₁x) + B e^(λ₂x). For a repeated root use y = (A + Bx)e^(λx). Complex roots give trig form."
      },
      {
        "id": "alevel_p3_i4",
        "title": "初始条件",
        "learned": false,
        "videoUrl": "",
        "enBody": "A general solution contains arbitrary constants; initial conditions pin down a unique particular solution. Example: y' = y with y(0) = 1 gives the general solution y = Ceˣ, so C = 1 and the particular solution is y = eˣ. Substitute initial values only after differentiating and simplifying."
      },
      {
        "id": "alevel_p3_i5",
        "title": "双曲函数",
        "learned": false,
        "videoUrl": "",
        "enBody": "Hyperbolic functions: sinh x = (eˣ-e⁻ˣ)/2, cosh x = (eˣ+e⁻ˣ)/2. Identity: cosh²x - sinh²x = 1 (note the minus, unlike trig). Derivatives: d/dx sinh x = cosh x, d/dx cosh x = sinh x."
      },
      {
        "id": "alevel_p3_i6",
        "title": "有理函数积分",
        "learned": false,
        "videoUrl": "",
        "enBody": "Integrate rational functions by partial fractions: decompose into simpler fractions, then integrate term by term. Factor the denominator, set undetermined coefficients, and solve. Works when the denominator factors."
      },
      {
        "id": "alevel_p3_i7",
        "title": "泰勒级数与逼近",
        "learned": false,
        "videoUrl": "",
        "enBody": "Taylor series expand a function into a polynomial near a point. Common Maclaurin expansions (at x=0) include eˣ, sin x, cos x. Use the first few terms to approximate, with the remainder controlling error."
      },
      {
        "id": "alevel_p3_i8",
        "title": "向量叉积",
        "learned": false,
        "videoUrl": "",
        "enBody": "The cross product a×b gives a vector perpendicular to both, with magnitude |a||b|sinθ. Use it for normal vectors and triangle areas. Compute via determinant. Note a×b = -(b×a)."
      }
    ]
  },
  {
    "id": "alevel_mech_ch0",
    "courseId": "alevel_mech",
    "title": "A-Level力学 · 核心知识",
    "items": [
      {
        "id": "alevel_mech_i1",
        "title": "牛顿第二定律",
        "learned": false,
        "videoUrl": "",
        "enBody": "Newton's second law is F = ma. Force is in newtons (N), where 1 N = 1 kg·m/s². Steps: draw a free-body diagram, resolve the net force, then apply F = ma. Take the direction of motion as positive."
      },
      {
        "id": "alevel_mech_i2",
        "title": "匀加速运动",
        "learned": false,
        "videoUrl": "",
        "enBody": "The five SUVAT equations: v = u + at, s = ut + ½at², v² = u² + 2as, s = (u+v)t/2, and s = vt - ½at². Each involves four variables — given three, solve for the fourth."
      },
      {
        "id": "alevel_mech_i3",
        "title": "连接体问题",
        "learned": false,
        "videoUrl": "",
        "enBody": "In connected-particle problems, two bodies joined by a string share the same acceleration. Write two equations: an overall equation (external force) and a single-body equation (tension). Example: force F pulls A linked to B, so F - T = mA·a and T = mB·a."
      },
      {
        "id": "alevel_mech_i4",
        "title": "能量守恒",
        "learned": false,
        "videoUrl": "",
        "enBody": "Without friction, mechanical energy is conserved: kinetic + potential = constant. KE = ½mv² and GPE = mgh. Example: an object dropped from height h reaches v = √(2gh). With friction, use the work-energy principle: work done equals change in mechanical energy."
      },
      {
        "id": "alevel_mech_i5",
        "title": "摩擦力",
        "learned": false,
        "videoUrl": "",
        "enBody": "Friction satisfies f ≤ μN, with maximum static friction f_max = μN (μ coefficient, N normal force). Kinetic friction f = μₖN. At the point of slipping, f is maximal. First determine whether sliding occurs."
      },
      {
        "id": "alevel_mech_i6",
        "title": "动量与冲量",
        "learned": false,
        "videoUrl": "",
        "enBody": "Momentum p = mv. Impulse = force × time = change in momentum = Δ(mv). Momentum is conserved without external forces. Collision problems combine conservation of momentum with the restitution coefficient e."
      },
      {
        "id": "alevel_mech_i7",
        "title": "力矩平衡",
        "learned": false,
        "videoUrl": "",
        "enBody": "Moment = force × perpendicular distance. A rigid body in equilibrium has zero resultant force and zero resultant moment. Taking moments about a pivot simplifies calculations. Levers and bridges are typical applications."
      },
      {
        "id": "alevel_mech_i8",
        "title": "圆周运动",
        "learned": false,
        "videoUrl": "",
        "enBody": "Uniform circular motion: centripetal acceleration a = v²/r = rω², and force F = mv²/r. Angular velocity ω = v/r, period T = 2π/ω. The centripetal force is provided by gravity, tension, or friction."
      }
    ]
  },
  {
    "id": "ib_math_aa_ch0",
    "courseId": "ib_math_aa",
    "title": "IB数学AA · 核心知识",
    "items": [
      {
        "id": "ib_aa_i1",
        "title": "链式法则",
        "learned": false,
        "videoUrl": "",
        "enBody": "Differentiate composite functions with the chain rule: dy/dx = dy/du × du/dx. Example: y = sin(2x), let u = 2x, so dy/du = cos(2x) and du/dx = 2, giving dy/dx = 2cos(2x)."
      },
      {
        "id": "ib_aa_i2",
        "title": "分部积分",
        "learned": false,
        "videoUrl": "",
        "enBody": "Integration by parts: ∫u dv = uv - ∫v du. Use it for products of two different function types. Choose u by LIATE: Logarithmic, Inverse trig, Algebraic, Trigonometric, Exponential. Example: ∫x eˣ dx with u = x, dv = eˣ dx gives xeˣ - eˣ + C."
      },
      {
        "id": "ib_aa_i3",
        "title": "泰勒展开",
        "learned": false,
        "videoUrl": "",
        "enBody": "A Taylor expansion approximates a function near a point with a polynomial: f(x) = f(a) + f'(a)(x-a) + f''(a)(x-a)²/2! + ... At x = 0 this is the Maclaurin series. Example: eˣ = 1 + x + x²/2! + x³/3! + ..."
      },
      {
        "id": "ib_aa_i4",
        "title": "积分换元",
        "learned": false,
        "videoUrl": "",
        "enBody": "Substitution is a systematic form of the reverse chain rule. Replace the complicated part with u and express dx in terms of du. Example: ∫2x e^(x²) dx with u = x² gives du = 2x dx, so ∫e^u du = e^(x²) + C. Check that dx is fully replaced."
      },
      {
        "id": "ib_aa_i5",
        "title": "极限与连续性",
        "learned": false,
        "videoUrl": "",
        "enBody": "A limit describes the value a function approaches. A function is continuous if lim f(x) = f(a). Three conditions: f(a) exists, the limit exists, and they are equal. The squeeze theorem is a key tool."
      },
      {
        "id": "ib_aa_i6",
        "title": "反三角函数求导",
        "learned": false,
        "videoUrl": "",
        "enBody": "Inverse trig derivatives: d/dx arcsin x = 1/√(1-x²), d/dx arctan x = 1/(1+x²), d/dx arccos x = -1/√(1-x²). Apply the chain rule for composite forms."
      },
      {
        "id": "ib_aa_i7",
        "title": "数列与级数收敛",
        "learned": false,
        "videoUrl": "",
        "enBody": "Geometric sum Sₙ = a(1-rⁿ)/(1-r). An infinite geometric series converges when |r|<1 with sum S = a/(1-r). Test convergence with the ratio test or comparison test."
      },
      {
        "id": "ib_aa_i8",
        "title": "复数根与单位根",
        "learned": false,
        "videoUrl": "",
        "enBody": "The equation zⁿ = 1 has n complex roots evenly spaced on the unit circle, called nth roots of unity. Use De Moivre: z = cos(2kπ/n) + i sin(2kπ/n). The roots are symmetric on the complex plane."
      }
    ]
  },
  {
    "id": "ib_math_ai_ch0",
    "courseId": "ib_math_ai",
    "title": "IB数学AI · 核心知识",
    "items": [
      {
        "id": "ib_ai_i1",
        "title": "正态分布",
        "learned": false,
        "videoUrl": "",
        "enBody": "The normal distribution N(μ, σ²) has mean μ and standard deviation σ. The 68-95-99.7 rule: 68% of data lie within μ±σ, 95% within μ±2σ, 99.7% within μ±3σ. Standardize with the z-score Z = (X - μ)/σ."
      },
      {
        "id": "ib_ai_i2",
        "title": "线性回归",
        "learned": false,
        "videoUrl": "",
        "enBody": "Linear regression y = ax + b finds the best-fit line by minimizing the sum of squared residuals. The coefficient of determination r² measures how well the model explains variation; r close to 1 means a strong linear relationship. If |r| < 0.3, the linear model is unreliable."
      },
      {
        "id": "ib_ai_i3",
        "title": "复合增长",
        "learned": false,
        "videoUrl": "",
        "enBody": "The compound growth model is A = P(1 + r/n)^(nt), where P is principal, r the annual rate, n the compounding frequency per year, and t the years. A negative r models decay. As n → ∞ we get continuous compounding: A = P e^(rt)."
      },
      {
        "id": "ib_ai_i4",
        "title": "误差传播",
        "learned": false,
        "videoUrl": "",
        "enBody": "For additive models, absolute errors add; for multiplicative models, relative errors add. Example: measuring length L = 10±0.1 cm and width W = 5±0.1 cm, the relative error of the perimeter is easier to compute than that of the area."
      },
      {
        "id": "ib_ai_i5",
        "title": "图论基础",
        "learned": false,
        "videoUrl": "",
        "enBody": "A graph consists of vertices and edges. An Eulerian path visits each edge once; a Hamiltonian path visits each vertex once. Minimum spanning trees use Kruskal or Prim. Graphs model routing and networks."
      },
      {
        "id": "ib_ai_i6",
        "title": "二项分布与泊松",
        "learned": false,
        "videoUrl": "",
        "enBody": "Binomial X~B(n,p) counts successes in n independent trials: P(X=k)=C(n,k)p^k(1-p)^(n-k). When n is large and p small, Poisson Po(λ=np) approximates it: P(X=k)=λᵏe⁻λ/k!."
      },
      {
        "id": "ib_ai_i7",
        "title": "矩阵与线性规划",
        "learned": false,
        "videoUrl": "",
        "enBody": "Linear programming optimizes an objective under constraints. Graphically: draw the feasible region (bounded by constraint inequalities), then evaluate the objective at vertices. Matrices solve linear systems via Gaussian elimination."
      },
      {
        "id": "ib_ai_i8",
        "title": "假设检验与 p 值",
        "learned": false,
        "videoUrl": "",
        "enBody": "Hypothesis testing judges whether a sample supports a claim. The p-value is the probability of observing the result if H₀ is true. Reject H₀ if p < α (typically 0.05). IB requires computing p-values with a GDC."
      }
    ]
  },
  {
    "id": "ap_calc_ch0",
    "courseId": "ap_calc",
    "title": "AP微积分 · 核心知识",
    "items": [
      {
        "id": "ap_calc_i1",
        "title": "泰勒级数展开",
        "learned": false,
        "videoUrl": "",
        "enBody": "A Taylor series expands a function about a point: f(x) = f(a) + f'(a)(x-a) + f''(a)(x-a)²/2! + ... The Maclaurin series is the special case a = 0. For smooth functions, more terms give a more accurate approximation."
      },
      {
        "id": "ap_calc_i2",
        "title": "收敛半径",
        "learned": false,
        "videoUrl": "",
        "enBody": "The radius of convergence R determines where a power series converges. Ratio test: R = lim |aₙ/aₙ₊₁|. The series converges absolutely for |x-a| < R, diverges for |x-a| > R, and the endpoints must be tested separately."
      },
      {
        "id": "ap_calc_i3",
        "title": "麦克劳林特殊展开",
        "learned": false,
        "videoUrl": "",
        "enBody": "Three must-know Maclaurin expansions: eˣ = Σxⁿ/n!, sin x = Σ(-1)ⁿx^(2n+1)/(2n+1)!, cos x = Σ(-1)ⁿx^(2n)/(2n)!. Watch for alternating signs and factorial denominators."
      },
      {
        "id": "ap_calc_i4",
        "title": "余项估计",
        "learned": false,
        "videoUrl": "",
        "enBody": "The Taylor remainder Rₙ(x) measures the error of a polynomial approximation. Lagrange form: Rₙ(x) = f^(n+1)(c)(x-a)^(n+1)/(n+1)!, where c lies between a and x. Remainder estimates bound the truncation error."
      },
      {
        "id": "ap_calc_i5",
        "title": "隐函数求导",
        "learned": false,
        "videoUrl": "",
        "enBody": "In an implicit equation like x²+y²=25, differentiate both sides with respect to x, applying the chain rule to y-terms, then solve for dy/dx. For x²+y²=25: 2x+2y·dy/dx=0, so dy/dx=-x/y."
      },
      {
        "id": "ap_calc_i6",
        "title": "相关变化率",
        "learned": false,
        "videoUrl": "",
        "enBody": "In related rates, one quantity changes as another changes. Write the geometric relation, differentiate both sides with respect to time t, then substitute known values. Example: for A=πr² with dr/dt=2, dA/dt=2πr·dr/dt."
      },
      {
        "id": "ap_calc_i7",
        "title": "函数的极值与最值",
        "learned": false,
        "videoUrl": "",
        "enBody": "To find extrema, solve f'(x)=0 for critical points, then use the second derivative (f''>0 min, f''<0 max). For absolute extrema, check endpoints too. In optimization, set up the objective function, then differentiate."
      },
      {
        "id": "ap_calc_i8",
        "title": "洛必达法则",
        "learned": false,
        "videoUrl": "",
        "enBody": "L'Hôpital's rule handles 0/0 or ∞/∞ limits: lim f(x)/g(x) = lim f'(x)/g'(x). You must first confirm the indeterminate form. Example: lim(x→0) sin x/x = lim cos x/1 = 1."
      }
    ]
  },
  {
    "id": "ap_stats_ch0",
    "courseId": "ap_stats",
    "title": "AP统计 · 核心知识",
    "items": [
      {
        "id": "ap_stats_i1",
        "title": "取样方法",
        "learned": false,
        "videoUrl": "",
        "enBody": "Statistical inference relies on random sampling. Simple random sampling gives every individual equal probability. Stratified sampling divides by characteristic, then samples each stratum. Cluster sampling randomly selects groups and surveys them entirely. Convenience and voluntary samples are biased."
      },
      {
        "id": "ap_stats_i2",
        "title": "中心极限定理",
        "learned": false,
        "videoUrl": "",
        "enBody": "The central limit theorem: when n is large enough, the sampling distribution of the sample mean is approximately normal, with mean equal to the population mean μ and standard deviation σ/√n. In practice n ≥ 30 suffices. It underpins confidence intervals."
      },
      {
        "id": "ap_stats_i3",
        "title": "置信区间",
        "learned": false,
        "videoUrl": "",
        "enBody": "A confidence interval estimates a population parameter. For a mean: sample mean ± z* × σ/√n. A 95% confidence level uses z* = 1.96 (≈ 2). A narrower interval means a more precise estimate."
      },
      {
        "id": "ap_stats_i4",
        "title": "显著性检验",
        "learned": false,
        "videoUrl": "",
        "enBody": "Hypothesis testing: state H₀ and H₁, compute a test statistic, obtain the p-value, and compare it to the significance level α. If p < α, reject H₀. The p-value is the probability of observing such a result if H₀ were true."
      },
      {
        "id": "ap_stats_i5",
        "title": "两类错误",
        "learned": false,
        "videoUrl": "",
        "enBody": "Type I error: rejecting a true H₀, with probability α. Type II error: failing to reject a false H₀, with probability β. Power = 1-β. Reducing α increases β, so there is a trade-off."
      },
      {
        "id": "ap_stats_i6",
        "title": "双样本检验",
        "learned": false,
        "videoUrl": "",
        "enBody": "Use a two-sample t-test to compare two means, and a two-proportion z-test to compare two proportions. Paired samples (same subjects before/after) use a paired t-test. Clarify the research question, then pick the test."
      },
      {
        "id": "ap_stats_i7",
        "title": "卡方检验",
        "learned": false,
        "videoUrl": "",
        "enBody": "Chi-square tests work with categorical data. A goodness-of-fit test checks if observed frequencies match a distribution. A test of independence checks association between two categorical variables. Compute χ²=Σ(O-E)²/E."
      },
      {
        "id": "ap_stats_i8",
        "title": "回归推断",
        "learned": false,
        "videoUrl": "",
        "enBody": "Test the regression slope, typically H₀: β=0 (no linear relationship). A t-test determines if the slope differs significantly from 0, with a confidence interval for the slope. Check residual plots for randomness."
      }
    ]
  },
  {
    "id": "sat_math_ch0",
    "courseId": "sat_math",
    "title": "SAT数学 · 核心知识",
    "items": [
      {
        "id": "sat_math_i1",
        "title": "一次函数",
        "learned": false,
        "videoUrl": "",
        "enBody": "A linear function is y = mx + b, where m is the slope and b the y-intercept. Slope = change ratio = (y₂-y₁)/(x₂-x₁). Parallel lines share a slope; perpendicular lines have slopes whose product is -1."
      },
      {
        "id": "sat_math_i2",
        "title": "二次函数",
        "learned": false,
        "videoUrl": "",
        "enBody": "A quadratic function is y = ax² + bx + c, with vertex x = -b/2a. Vertex form y = a(x-h)² + k has vertex (h,k). The sign of a sets the opening direction (up for positive, down for negative). The discriminant determines the number of x-intercepts."
      },
      {
        "id": "sat_math_i3",
        "title": "三角比",
        "learned": false,
        "videoUrl": "",
        "enBody": "In a right triangle: sin θ = opposite/hypotenuse, cos θ = adjacent/hypotenuse, tan θ = opposite/adjacent. Remember SOH-CAH-TOA. Common values: sin 30° = 1/2, cos 60° = 1/2, tan 45° = 1."
      },
      {
        "id": "sat_math_i4",
        "title": "图表数据分析",
        "learned": false,
        "videoUrl": "",
        "enBody": "When reading graphs, check axis labels, units, and trends. The mean is sensitive to outliers while the median is more robust. In scatter plots, focus on correlation and outliers."
      },
      {
        "id": "sat_math_i5",
        "title": "指数与根式",
        "learned": false,
        "videoUrl": "",
        "enBody": "Exponent rules: xᵃ·xᵇ=xᵃ⁺ᵇ, (xᵃ)ᵇ=xᵃᵇ, x⁻ᵃ=1/xᵃ. Radicals are fractional exponents: √x=x^(1/2). Solve exponential equations with logs: xᵃ=b → a·log x=log b."
      },
      {
        "id": "sat_math_i6",
        "title": "圆与抛物线方程",
        "learned": false,
        "videoUrl": "",
        "enBody": "Circle: (x-h)²+(y-k)²=r² with center (h,k), radius r. Parabola: y=a(x-h)²+k with vertex (h,k). Complete the square to convert general form to standard form and read off geometric features."
      },
      {
        "id": "sat_math_i7",
        "title": "比例与百分比",
        "learned": false,
        "videoUrl": "",
        "enBody": "Percentage change: an increase of p% multiplies by (1+p/100), a decrease by (1-p/100). Successive changes multiply. For ratio problems, let each part be x. Be careful about the base of the percentage."
      },
      {
        "id": "sat_math_i8",
        "title": "复数运算",
        "learned": false,
        "videoUrl": "",
        "enBody": "A complex number is a+bi with i²=-1. Add by combining real and imaginary parts. Multiply by expanding and replacing i² with -1. To divide, multiply numerator and denominator by the conjugate."
      }
    ]
  },
  {
    "id": "sat_write_ch0",
    "courseId": "sat_write",
    "title": "SAT文法 · 核心知识",
    "items": [
      {
        "id": "sat_write_i1",
        "title": "主谓一致",
        "learned": false,
        "videoUrl": "",
        "enBody": "Subject and verb must agree in number. Parenthetical phrases and appositives do not change the subject's number. Collective nouns like \"team\" take singular when treated as a unit, plural when emphasizing members. \"Neither...nor\" follows the nearest subject."
      },
      {
        "id": "sat_write_i2",
        "title": "标点：逗号与分号",
        "learned": false,
        "videoUrl": "",
        "enBody": "Joining two independent clauses with a comma requires a FANBOYS conjunction. A semicolon (;) can join two related independent clauses without a conjunction. A colon (:) introduces an explanation or list. A dash (—) marks an insertion or emphasis."
      },
      {
        "id": "sat_write_i3",
        "title": "时态一致性",
        "learned": false,
        "videoUrl": "",
        "enBody": "Keep tenses consistent unless the narrative time actually changes. Use past tense for past events and present for universal truths. In if-conditionals, present in the if-clause pairs with future in the main clause: If it rains, we will stay."
      },
      {
        "id": "sat_write_i4",
        "title": "逻辑衔接词",
        "learned": false,
        "videoUrl": "",
        "enBody": "however/nevertheless signal contrast; therefore/thus/consequently signal cause-effect; furthermore/moreover/in addition signal addition; for example/such as introduce examples. Choose the transition that matches the logical relationship."
      },
      {
        "id": "sat_write_i5",
        "title": "平行结构",
        "learned": false,
        "videoUrl": "",
        "enBody": "Coordinated items must share the same grammatical form. Example: \"She likes reading, writing, and to swim\" is wrong; it should be \"reading, writing, and swimming\"."
      },
      {
        "id": "sat_write_i6",
        "title": "代词指代清晰",
        "learned": false,
        "videoUrl": "",
        "enBody": "A pronoun must refer clearly to one antecedent. With multiple possible nouns, ambiguity arises. Example: \"When John met Bill, he smiled\" is unclear — use \"John smiled\" instead."
      },
      {
        "id": "sat_write_i7",
        "title": "悬垂修饰语",
        "learned": false,
        "videoUrl": "",
        "enBody": "A modifier must sit next to what it modifies. A dangling modifier starts the sentence but the main subject is not what is being modified. Example: \"Walking down the street, the trees were beautiful\" is wrong because trees do not walk."
      },
      {
        "id": "sat_write_i8",
        "title": "简洁性原则",
        "learned": false,
        "videoUrl": "",
        "enBody": "SAT Writing favors the most concise expression. Cut redundancy (\"due to the fact that\" → \"because\"). When several options are grammatically correct, choose the shortest one that preserves meaning."
      }
    ]
  },
  {
    "id": "igcse_phy_ch0",
    "courseId": "igcse_phy",
    "title": "IGCSE物理 · 核心知识",
    "items": [
      {
        "id": "igcse_phy_i1",
        "title": "运动学公式",
        "learned": false,
        "videoUrl": "",
        "enBody": "v = u + at, s = ut + ½at², v² = u² + 2as. For uniform motion v = s/t. Acceleration a = Δv/t. Units: metres, seconds, metres per second."
      },
      {
        "id": "igcse_phy_i2",
        "title": "力与牛顿定律",
        "learned": false,
        "videoUrl": "",
        "enBody": "F = ma. Zero net force means uniform motion or rest (first law). Action and reaction are equal and opposite (third law). Weight W = mg. Friction opposes motion."
      },
      {
        "id": "igcse_phy_i3",
        "title": "能量守恒",
        "learned": false,
        "videoUrl": "",
        "enBody": "Energy is neither created nor destroyed, only converted between forms. Kinetic energy KE = ½mv², potential energy PE = mgh. Power P = work/time = E/t, in watts."
      },
      {
        "id": "igcse_phy_i4",
        "title": "电学基础",
        "learned": false,
        "videoUrl": "",
        "enBody": "Ohm's law: V = IR. In series, current is the same and voltage divides; in parallel, voltage is the same and current divides. Power P = VI = I²R = V²/R."
      },
      {
        "id": "igcse_phy_i5",
        "title": "波的性质",
        "learned": false,
        "videoUrl": "",
        "enBody": "Wave speed v = fλ (frequency × wavelength). Transverse waves oscillate perpendicular to travel (light); longitudinal waves parallel (sound). Reflection, refraction, and diffraction are three basic phenomena."
      },
      {
        "id": "igcse_phy_i6",
        "title": "光的反射与折射",
        "learned": false,
        "videoUrl": "",
        "enBody": "Law of reflection: angle of incidence equals angle of reflection. Snell's law: n₁sinθ₁ = n₂sinθ₂. Total internal reflection occurs from denser to rarer media beyond the critical angle."
      },
      {
        "id": "igcse_phy_i7",
        "title": "热传导三种方式",
        "learned": false,
        "videoUrl": "",
        "enBody": "Three modes of heat transfer: conduction (molecular collisions in solids), convection (fluid flow), radiation (electromagnetic, no medium needed). A vacuum flask stops conduction and convection via vacuum, and radiation via silvering."
      },
      {
        "id": "igcse_phy_i8",
        "title": "电路元件与电阻",
        "learned": false,
        "videoUrl": "",
        "enBody": "Resistors in series: R=R₁+R₂; in parallel: 1/R=1/R₁+1/R₂. Common components: resistor, diode (one-way), thermistor (temperature), LDR (light). I-V curves describe component behavior."
      }
    ]
  },
  {
    "id": "alevel_math_ch0",
    "courseId": "alevel_math",
    "title": "A-Level数学 · 核心知识",
    "items": [
      {
        "id": "alevel_math_i1",
        "title": "微积分求导法则",
        "learned": false,
        "videoUrl": "",
        "enBody": "d/dx(xⁿ) = nxⁿ⁻¹. Chain rule: (f∘g)' = f'(g)g'. Product rule: (uv)' = u'v + uv'. Quotient rule: (u/v)' = (u'v - uv')/v²."
      },
      {
        "id": "alevel_math_i2",
        "title": "积分技术",
        "learned": false,
        "videoUrl": "",
        "enBody": "∫xⁿdx = xⁿ⁺¹/(n+1) + C. Substitution (u-substitution); integration by parts ∫u dv = uv - ∫v du, choosing u by LIATE. A definite integral gives area."
      },
      {
        "id": "alevel_math_i3",
        "title": "微分方程",
        "learned": false,
        "videoUrl": "",
        "enBody": "dy/dx = f(x,y). Separable: rearrange to dy/g(y) = f(x)dx and integrate both sides. The solution contains an arbitrary constant C, fixed by an initial value. First-order linear equations use the integrating factor e^∫P dx."
      },
      {
        "id": "alevel_math_i4",
        "title": "复数与极坐标",
        "learned": false,
        "videoUrl": "",
        "enBody": "z = a+bi has modulus r = |z| = √(a²+b²) and argument θ = arg z. Polar form: z = r(cosθ + i sinθ) = re^{iθ}. De Moivre's theorem: (re^{iθ})ⁿ = rⁿe^{inθ}."
      },
      {
        "id": "alevel_math_i5",
        "title": "反函数求导",
        "learned": false,
        "videoUrl": "",
        "enBody": "Derivative of an inverse function: (f⁻¹)'(y) = 1/f'(x), where y=f(x). This derives inverse trig derivatives and follows from differentiating f(f⁻¹(x))=x."
      },
      {
        "id": "alevel_math_i6",
        "title": "参数方程求导",
        "learned": false,
        "videoUrl": "",
        "enBody": "For parametric x=f(t), y=g(t), the derivative is dy/dx = (dy/dt)/(dx/dt). The second derivative is d²y/dx² = [d/dt(dy/dx)]/(dx/dt)."
      },
      {
        "id": "alevel_math_i7",
        "title": "微分方程建模",
        "learned": false,
        "videoUrl": "",
        "enBody": "Real problems (population, cooling, decay) are modelled by differential equations. A common model is dy/dt = ky with solution y = Ce^(kt). Steps: set up, solve, apply initial conditions, interpret."
      },
      {
        "id": "alevel_math_i8",
        "title": "级数求和与收敛",
        "learned": false,
        "videoUrl": "",
        "enBody": "Arithmetic and geometric series sums are foundational. Taylor and Maclaurin series approximate functions. Test convergence with the ratio or integral test. The radius of convergence bounds a power series."
      }
    ]
  },
  {
    "id": "alevel_phy_ch0",
    "courseId": "alevel_phy",
    "title": "A-Level物理 · 核心知识",
    "items": [
      {
        "id": "alevel_phy_i1",
        "title": "力学与转动",
        "learned": false,
        "videoUrl": "",
        "enBody": "Torque τ = Fr sinθ. Moment of inertia I = Σmr². Angular acceleration α. Rotational analogue of F = ma: τ = Iα."
      },
      {
        "id": "alevel_phy_i2",
        "title": "电磁场",
        "learned": false,
        "videoUrl": "",
        "enBody": "Lorentz force F = qv×B. A charge in a magnetic field moves in a circle of radius r = mv/qB. Magnetic flux Φ = BA cosθ. Faraday's law: ε = -dΦ/dt."
      },
      {
        "id": "alevel_phy_i3",
        "title": "量子物理",
        "learned": false,
        "videoUrl": "",
        "enBody": "Photon energy E = hf = hc/λ. The photoelectric effect has a threshold frequency. De Broglie wavelength λ = h/p. A transition between energy levels releases a photon hf = E₂ - E₁."
      },
      {
        "id": "alevel_phy_i4",
        "title": "核物理",
        "learned": false,
        "videoUrl": "",
        "enBody": "Alpha decay emits a helium nucleus; beta decay converts a neutron to a proton and emits an electron. Half-life T½. Binding energy is the energy needed to split a nucleus — the larger, the more stable. Mass defect: ΔE = Δmc²."
      },
      {
        "id": "alevel_phy_i5",
        "title": "简谐运动",
        "learned": false,
        "videoUrl": "",
        "enBody": "In SHM, the restoring force is proportional and opposite to displacement: F = -kx. Displacement x = A cos(ωt), velocity v = -Aω sin(ωt). Period T = 2π√(m/k). Spring and pendulum are examples."
      },
      {
        "id": "alevel_phy_i6",
        "title": "引力场",
        "learned": false,
        "videoUrl": "",
        "enBody": "Gravitational force F = GMm/r². Field strength g = GM/r². Potential energy U = -GMm/r. Satellite orbits and escape velocity v = √(2GM/r) are applications."
      },
      {
        "id": "alevel_phy_i7",
        "title": "电容与充放电",
        "learned": false,
        "videoUrl": "",
        "enBody": "Capacitance C = Q/V. Parallel plate C = εA/d. Charging raises voltage exponentially, discharging lowers it, with time constant τ = RC. Stored energy E = ½CV²."
      },
      {
        "id": "alevel_phy_i8",
        "title": "电磁感应",
        "learned": false,
        "videoUrl": "",
        "enBody": "Faraday's law: induced emf ε = -N·dΦ/dt (rate of flux change). Lenz's law: the induced current opposes the flux change. Generators and transformers rely on induction."
      }
    ]
  },
  {
    "id": "ib_math_ch0",
    "courseId": "ib_math",
    "title": "IB数学 · 核心知识",
    "items": [
      {
        "id": "ib_math_i1",
        "title": "向量与几何",
        "learned": false,
        "videoUrl": "",
        "enBody": "The dot product a·b = |a||b|cosθ tests perpendicularity (= 0) and finds angles. The magnitude of the cross product = |a||b|sinθ, the parallelogram area. A line has vector equation r = a + tb."
      },
      {
        "id": "ib_math_i2",
        "title": "矩阵与变换",
        "learned": false,
        "videoUrl": "",
        "enBody": "Matrix multiplication is not commutative. The determinant measures area scaling; for 2×2, det = ad-bc. An inverse exists iff det ≠ 0. Rotations, scalings, and reflections correspond to specific matrices."
      },
      {
        "id": "ib_math_i3",
        "title": "微积分进阶",
        "learned": false,
        "videoUrl": "",
        "enBody": "For implicit differentiation, differentiate both sides with respect to x and keep y'. For parametric equations, dy/dx = (dy/dt)/(dx/dt). Taylor: f(a+h) = f(a) + hf' + h²/2 f'' + ..."
      },
      {
        "id": "ib_math_i4",
        "title": "概率分布",
        "learned": false,
        "videoUrl": "",
        "enBody": "Binomial X~B(n,p) has mean np and variance np(1-p). Poisson X~Po(λ) has mean = variance = λ. Normal: standardize with Z = (X-μ)/σ."
      },
      {
        "id": "ib_math_i5",
        "title": "向量点积与夹角",
        "learned": false,
        "videoUrl": "",
        "enBody": "The dot product a·b = |a||b|cosθ finds the angle: cosθ = a·b/(|a||b|). If the dot product is 0, the vectors are perpendicular. Projection of a onto b = a·b/|b|."
      },
      {
        "id": "ib_math_i6",
        "title": "矩阵逆与行列式",
        "learned": false,
        "videoUrl": "",
        "enBody": "For a 2×2 matrix, A⁻¹ = (1/det)(d -b; -c a) with det = ad-bc. If det=0, the matrix is singular. The determinant is the area scale factor. Solve AX=B as X=A⁻¹B."
      },
      {
        "id": "ib_math_i7",
        "title": "微积分基本定理",
        "learned": false,
        "videoUrl": "",
        "enBody": "The fundamental theorem links differentiation and integration: ∫ₐᵇ f(x)dx = F(b) - F(a), where F is an antiderivative. This makes definite integrals straightforward. Also d/dx ∫ₐˣ f(t)dt = f(x)."
      },
      {
        "id": "ib_math_i8",
        "title": "正态分布标准化",
        "learned": false,
        "videoUrl": "",
        "enBody": "The standard normal is N(0,1). Standardize with Z = (X-μ)/σ to convert any normal to standard. Use a Z-table or GDC for P(X<x). Inverse lookup finds critical values for a given probability."
      }
    ]
  },
  {
    "id": "ib_phy_ch0",
    "courseId": "ib_phy",
    "title": "IB物理 · 核心知识",
    "items": [
      {
        "id": "ib_phy_i1",
        "title": "测量与误差",
        "learned": false,
        "videoUrl": "",
        "enBody": "Absolute uncertainty ±δ, relative uncertainty = δ/value, percentage = relative × 100%. Repeated measurements reduce random error. Systematic error is a fixed bias. Significant figures follow the least precise datum."
      },
      {
        "id": "ib_phy_i2",
        "title": "热力学",
        "learned": false,
        "videoUrl": "",
        "enBody": "First law ΔU = Q - W (heat in raises internal energy; work out lowers it). Ideal gas PV = nRT. Isothermal process: ΔU = 0 so Q = W. Entropy never decreases in an isolated system."
      },
      {
        "id": "ib_phy_i3",
        "title": "波与干涉",
        "learned": false,
        "videoUrl": "",
        "enBody": "Constructive interference: path difference = nλ; destructive = (n+½)λ. Standing waves have nodes spaced λ/2 apart. Doppler shift: approaching source raises frequency. Refraction: n₁sinθ₁ = n₂sinθ₂."
      },
      {
        "id": "ib_phy_i4",
        "title": "相对论基础",
        "learned": false,
        "videoUrl": "",
        "enBody": "The speed of light is invariant. Time dilation Δt = γΔt₀, length contraction L = L₀/γ, with γ = 1/√(1-v²/c²). Mass-energy E = mc²; total energy E = γmc²."
      },
      {
        "id": "ib_phy_i5",
        "title": "动量守恒",
        "learned": false,
        "videoUrl": "",
        "enBody": "Total momentum is conserved in an isolated system. Collisions are elastic (kinetic energy conserved) or inelastic (energy lost). Solve collision problems with momentum and energy conservation. Rockets rely on momentum conservation."
      },
      {
        "id": "ib_phy_i6",
        "title": "光电效应",
        "learned": false,
        "videoUrl": "",
        "enBody": "Light ejects electrons from metal surfaces. Einstein's equation: hf = φ + KE_max. The threshold frequency f₀ = φ/h — below it, no electrons escape regardless of intensity."
      },
      {
        "id": "ib_phy_i7",
        "title": "双缝干涉",
        "learned": false,
        "videoUrl": "",
        "enBody": "Double-slit fringe spacing x = λD/d (λ wavelength, D screen distance, d slit separation). Bright fringes: d sinθ = nλ; dark: d sinθ = (n+½)λ. The experiment proves light's wave nature."
      },
      {
        "id": "ib_phy_i8",
        "title": "放射性衰变",
        "learned": false,
        "videoUrl": "",
        "enBody": "Decay law N = N₀e^(-λt) with decay constant λ. Half-life T½ = ln2/λ. Activity A = λN in becquerels (Bq). Decay is random; half-life is a statistical rule."
      }
    ]
  },
  {
    "id": "toefl_b1_ch0",
    "courseId": "toefl_b1",
    "title": "托福基础 · 核心知识",
    "items": [
      {
        "id": "toefl_b1_i1",
        "title": "听力主旨题：抓教授开场句",
        "learned": false,
        "videoUrl": "",
        "enBody": "The first sentence of a TOEFL lecture is usually the main idea. Professors often say \"Today I want to talk about...\" or \"Let's begin with...\", and what follows is the answer to the gist question. Practise noting the first sentence."
      },
      {
        "id": "toefl_b1_i2",
        "title": "听力连接词：信号即答案",
        "learned": false,
        "videoUrl": "",
        "enBody": "Content after \"but / however / in contrast / on the other hand\" is almost always tested. Test writers place answers after contrast markers — mark them immediately. Similarly, \"first / second / finally\" signal parallel structure, often matching table questions."
      },
      {
        "id": "toefl_b1_i3",
        "title": "阅读事实信息题：关键词回文",
        "learned": false,
        "videoUrl": "",
        "enBody": "For factual information questions, take a proper noun or number from the question to locate the passage. The answer is usually a paraphrase rather than a verbatim match. If you cannot find the anchor, do not force an answer."
      },
      {
        "id": "toefl_b1_i4",
        "title": "口语 Task 1：15 秒构思模板",
        "learned": false,
        "videoUrl": "",
        "enBody": "Independent speaking Task 1 gives only 15 seconds to prepare. Use a template: state your opinion (\"I think...\") + one reason + one specific example. Prefer simple, complete speech over complex sentences that cause hesitation."
      },
      {
        "id": "toefl_b1_i5",
        "title": "听力细节题：笔记定位",
        "learned": false,
        "videoUrl": "",
        "enBody": "Detail questions test specific facts. Take notes with abbreviations for key numbers, names, and definitions. Match the question keyword to your notes rather than guessing from memory."
      },
      {
        "id": "toefl_b1_i6",
        "title": "阅读词汇题：上下文猜词",
        "learned": false,
        "videoUrl": "",
        "enBody": "Vocabulary questions test meaning in context, not memorization. Locate the sentence, examine the surrounding logic (contrast, cause, example), and infer. You can answer even without knowing the word."
      },
      {
        "id": "toefl_b1_i7",
        "title": "口语 Task 2：校园场景",
        "learned": false,
        "videoUrl": "",
        "enBody": "Task 2 combines a campus announcement and a conversation. Structure: summarize the announcement, state the speaker's attitude (for/against), then give 1-2 reasons. Paraphrase, do not read verbatim."
      },
      {
        "id": "toefl_b1_i8",
        "title": "阅读主旨题：首段定位",
        "learned": false,
        "videoUrl": "",
        "enBody": "Main idea answers usually sit in the first paragraph, often the thesis statement at its end. Watch for the real point after \"however\". For paragraph-level questions, check the first and last sentences."
      }
    ]
  },
  {
    "id": "ielts_speaking_ch0",
    "courseId": "ielts_speaking",
    "title": "雅思口语 · 核心知识",
    "items": [
      {
        "id": "ielts_speaking_i1",
        "title": "Part 1：回答最少拉满 3 句",
        "learned": false,
        "videoUrl": "",
        "enBody": "The most common Part 1 mistake is answering only Yes/No. If asked \"Do you like reading?\", give opinion + reason + extra detail. Example: \"Yes, I do, because it helps me relax. I usually read before bed, especially fiction.\" Aim for 15-20 seconds."
      },
      {
        "id": "ielts_speaking_i2",
        "title": "Part 2：1 分钟准备只记关键词",
        "learned": false,
        "videoUrl": "",
        "enBody": "Do not write full sentences or memorise. One minute is only enough for cues: who, when, where, what you did, how you felt. Write 2-3 words per point and expand naturally as you speak."
      },
      {
        "id": "ielts_speaking_i3",
        "title": "Part 3：观点 + 解释 + 例子",
        "learned": false,
        "videoUrl": "",
        "enBody": "Part 3 tests abstract discussion. Use the PEE structure: Point → Explanation → Example. When pressed, adjust your view and buy time with \"That's interesting, I haven't thought about it that way...\""
      },
      {
        "id": "ielts_speaking_i4",
        "title": "流利度：宁用简单词不卡壳",
        "learned": false,
        "videoUrl": "",
        "enBody": "Fluency and Coherence carry the most weight in speaking. Rather than straining for an advanced word, use familiar words to speak smoothly. If a word escapes you, bridge with \"It's a kind of...\" or \"You know...\" to avoid long pauses."
      },
      {
        "id": "ielts_speaking_i5",
        "title": "拓展回答的 AREA 法",
        "learned": false,
        "videoUrl": "",
        "enBody": "Use AREA to expand short answers: Answer directly → Reason → Example → Alternative angle. This fills every response to over 15 seconds and avoids dead air."
      },
      {
        "id": "ielts_speaking_i6",
        "title": "Part 2 时间分配",
        "learned": false,
        "videoUrl": "",
        "enBody": "Part 2 needs a full 2 minutes. Structure: 20s intro, 80s of details (who/what/where), 20s closing feelings. Practise with a stopwatch to build a steady pace."
      },
      {
        "id": "ielts_speaking_i7",
        "title": "争取思考时间的表达",
        "learned": false,
        "videoUrl": "",
        "enBody": "Never just say \"I don't know\" and stop. Use \"That's a good question...\", \"Let me think...\", \"Well, I've never thought about that, but...\" to buy 2-3 seconds and show natural communication."
      },
      {
        "id": "ielts_speaking_i8",
        "title": "发音清晰度优先",
        "learned": false,
        "videoUrl": "",
        "enBody": "Pronunciation is scored on clarity and intelligibility, not accent. Slow down and stress key words. Watch common difficulties: the th sound, long vs short vowels (ship/sheep), and final consonants."
      }
    ]
  },
  {
    "id": "ielts_reading_ch0",
    "courseId": "ielts_reading",
    "title": "雅思阅读 · 核心知识",
    "items": [
      {
        "id": "ielts_reading_i1",
        "title": "段落标题题：首末句定位法",
        "learned": false,
        "videoUrl": "",
        "enBody": "For List of Headings, read the first and last sentence of each paragraph to summarise the topic. When one heading fits several paragraphs, distinguish them by transition words and repeated nouns. Do not read the options first — it wastes time."
      },
      {
        "id": "ielts_reading_i2",
        "title": "T/F/NG：不要主观推断",
        "learned": false,
        "videoUrl": "",
        "enBody": "The core of T/F/NG is strict reliance on the text. False means the passage explicitly contradicts; Not Given means the passage does not mention it or it cannot be inferred. Many test-takers mark Not Given as False because common sense says \"wrong\"."
      },
      {
        "id": "ielts_reading_i3",
        "title": "填空题：同义改写是核心",
        "learned": false,
        "videoUrl": "",
        "enBody": "IELTS gap-fill rarely copies the passage verbatim — answers are paraphrased. For example \"expensive\" becomes \"costly\", \"rise\" becomes \"increase\". First locate the original sentence, then find the word that matches the question context."
      },
      {
        "id": "ielts_reading_i4",
        "title": "Heading 匹配：小心 NB 选项复用",
        "learned": false,
        "videoUrl": "",
        "enBody": "If the instructions say \"NB You may use any heading more than once\", at least one heading is used twice. Do not cross out headings you have already used; instead, watch which headings look like surplus items."
      },
      {
        "id": "ielts_reading_i5",
        "title": "定位词选择技巧",
        "learned": false,
        "videoUrl": "",
        "enBody": "Choose keywords that resist paraphrasing: proper nouns, numbers, years, capitalized words. Ordinary verbs and adjectives are easily reworded. Take only 2-3 keywords at a time."
      },
      {
        "id": "ielts_reading_i6",
        "title": "主旨题：概括 vs 细节",
        "learned": false,
        "videoUrl": "",
        "enBody": "For main idea questions, choose a general answer, not one covering only part or being too broad. Distractors are often details. The correct option governs the whole paragraph."
      },
      {
        "id": "ielts_reading_i7",
        "title": "信息匹配题：扫读 + 精读",
        "learned": false,
        "videoUrl": "",
        "enBody": "For \"which paragraph contains...\" questions, scan for keywords to locate the paragraph, then read it carefully to confirm. Answers are out of order, and one paragraph may match several items."
      },
      {
        "id": "ielts_reading_i8",
        "title": "时间分配策略",
        "learned": false,
        "videoUrl": "",
        "enBody": "60 minutes for 40 questions means about 20 minutes per passage. Do easy question types first, save hard passages for last. If stuck for over a minute, skip and return later."
      }
    ]
  },
  {
    "id": "ielts_writing_ch0",
    "courseId": "ielts_writing",
    "title": "雅思写作 · 核心知识",
    "items": [
      {
        "id": "ielts_writing_i1",
        "title": "Task 1：只描述客观数据",
        "learned": false,
        "videoUrl": "",
        "enBody": "Task 1 is data reporting, not an argumentative essay. Do not write \"I think the reason is...\". Structure: paraphrase the question, select the main trends, add detail, then compare. Match tense to the chart's years (past or present)."
      },
      {
        "id": "ielts_writing_i2",
        "title": "Task 2：4 段式稳拿结构分",
        "learned": false,
        "videoUrl": "",
        "enBody": "Use four paragraphs: Introduction (paraphrase + stance); Body 1 (first argument); Body 2 (second argument, possibly a concession); Conclusion (summary). Open each paragraph with a topic sentence and support it with examples or cause-effect."
      },
      {
        "id": "ielts_writing_i3",
        "title": "连贯性：指代词与连接词搭配",
        "learned": false,
        "videoUrl": "",
        "enBody": "Coherence and Cohesion require natural links between sentences. Use this / these / such to refer back, and however / therefore / for example to signal logic — but do not start every sentence with a connective, or it feels mechanical."
      },
      {
        "id": "ielts_writing_i4",
        "title": "语法多样性：从句的正确使用",
        "learned": false,
        "videoUrl": "",
        "enBody": "For a 7+, show complex structures: relative clauses, adverbial clauses, subjunctive. But accuracy comes first. One correct \"If I were you, I would agree\" beats three broken long sentences. Check subject-verb agreement and tense when you finish."
      },
      {
        "id": "ielts_writing_i5",
        "title": "Task 1 数据选择",
        "learned": false,
        "videoUrl": "",
        "enBody": "Do not list every figure in Task 1. Select 2-3 striking features: highest/lowest, biggest change, clear trend, exceptions. Use \"approximately / around / just over\" rather than copying exact numbers."
      },
      {
        "id": "ielts_writing_i6",
        "title": "Task 2 论点展开",
        "learned": false,
        "videoUrl": "",
        "enBody": "Develop each body paragraph with PEEL: Point → Explanation → Example → Link back to the question. Examples should be concrete and support the point, not start a new one."
      },
      {
        "id": "ielts_writing_i7",
        "title": "审题与偏题风险",
        "learned": false,
        "videoUrl": "",
        "enBody": "The biggest Task 2 risk is going off-topic. Circle the task words first: discuss, agree/disagree, advantages/disadvantages, cause/solution. Decide how many views to cover and whether to state a position."
      },
      {
        "id": "ielts_writing_i8",
        "title": "词汇升级：避免重复",
        "learned": false,
        "videoUrl": "",
        "enBody": "Avoid repeating the same word. Build synonym banks: important → crucial/vital/significant; show → illustrate/demonstrate; many → numerous/a variety of. But prioritize accuracy over novelty."
      }
    ]
  }
];

const systems = [
  {
    "id": "ielts",
    "name": "雅思 IELTS",
    "board": "英国文化协会 / IDP"
  },
  {
    "id": "toefl",
    "name": "托福 TOEFL",
    "board": "ETS"
  },
  {
    "id": "sat",
    "name": "SAT",
    "board": "College Board"
  },
  {
    "id": "igcse",
    "name": "IGCSE",
    "board": "Cambridge"
  },
  {
    "id": "alevel",
    "name": "A-Level",
    "board": "CAIE / Edexcel / AQA"
  },
  {
    "id": "ap",
    "name": "AP",
    "board": "College Board"
  },
  {
    "id": "ib",
    "name": "IB",
    "board": "IBO"
  }
];

module.exports = { courses, chapters, knowledge, systems };
