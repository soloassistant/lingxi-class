/**
 * 扩充理科类知识点：IGCSE/A-Level/IB 数学物理，各门从 4 补到 8（i5~i8）
 * 运行：node _test/expand-sci.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DATA_FILE = path.join(__dirname, '..', 'miniprogram', 'data', 'courses.js');
const d = require(DATA_FILE);

const ADD = [
  // ===== IGCSE 附加数学 igcse_addmath =====
  {
    id: 'igcse_am_i5', courseId: 'igcse_addmath', chapterId: 'igcse_addmath_ch0', type: 'lecture',
    title: '函数与反函数',
    enTitle: 'Functions and Inverses',
    body: '函数是一对一或一对多的映射。反函数 f⁻¹ 把输出映射回输入。求反函数：把 y=f(x) 中的 x 和 y 互换，再解出 y。反函数图像关于直线 y=x 对称。',
    enBody: 'A function maps inputs to outputs. The inverse f⁻¹ maps outputs back to inputs. To find it, swap x and y in y=f(x), then solve for y. Inverse graphs are symmetric about the line y=x.',
    quiz: { question: '反函数图像关于哪条线对称？', options: ['x 轴', 'y 轴', 'y=x', '原点'], answerIndex: 2, explanation: '反函数图像关于直线 y=x 对称。' }
  },
  {
    id: 'igcse_am_i6', courseId: 'igcse_addmath', chapterId: 'igcse_addmath_ch0', type: 'lecture',
    title: '指数函数与对数',
    enTitle: 'Exponentials and Logarithms',
    body: '指数函数 y=aˣ 与对数函数 y=log_a x 互为反函数。换底公式：log_a b = log b / log a。解指数方程常用两边取对数。ln 是以 e 为底的自然对数。',
    enBody: 'Exponential y=aˣ and logarithmic y=log_a x are inverses. Change of base: log_a b = log b / log a. Solve exponential equations by taking logs. ln is the natural log with base e.',
    quiz: { question: '换底公式 log_a b 等于？', options: ['log b / log a', 'log a / log b', 'log a · log b', 'a^b'], answerIndex: 0, explanation: 'log_a b = log b / log a。' }
  },
  {
    id: 'igcse_am_i7', courseId: 'igcse_addmath', chapterId: 'igcse_addmath_ch0', type: 'lecture',
    title: '三角恒等式',
    enTitle: 'Trigonometric Identities',
    body: '核心恒等式：sin²θ + cos²θ = 1；tanθ = sinθ/cosθ。倍角公式 sin2θ = 2sinθcosθ。解三角方程时先化简成单一三角函数，再在给定区间找所有解。',
    enBody: 'Key identities: sin²θ + cos²θ = 1 and tanθ = sinθ/cosθ. Double angle: sin2θ = 2sinθcosθ. Simplify to a single trig function, then find all solutions in the interval.',
    quiz: { question: 'sin²θ + cos²θ 恒等于？', options: ['0', '1', 'tanθ', '2'], answerIndex: 1, explanation: '这是最基本的三角恒等式，恒等于 1。' }
  },
  {
    id: 'igcse_am_i8', courseId: 'igcse_addmath', chapterId: 'igcse_addmath_ch0', type: 'lecture',
    title: '向量基础运算',
    enTitle: 'Basic Vector Operations',
    body: '向量有大小和方向。加减用平行四边形法则。数乘改变大小可能反转方向。位置向量、单位向量（模为 1）是常见概念。向量模长 |v| = √(x²+y²)。',
    enBody: 'Vectors have magnitude and direction. Add by the parallelogram rule; scalar multiplication scales or reverses. Position vectors and unit vectors (magnitude 1) are common. Magnitude |v| = √(x²+y²).',
    quiz: { question: '向量 v=(3,4) 的模长是？', options: ['5', '7', '12', '25'], answerIndex: 0, explanation: '|v| = √(3²+4²) = √25 = 5。' }
  },

  // ===== A-Level 纯数3 alevel_pure3 =====
  {
    id: 'alevel_p3_i5', courseId: 'alevel_pure3', chapterId: 'alevel_pure3_ch0', type: 'lecture',
    title: '双曲函数',
    enTitle: 'Hyperbolic Functions',
    body: '双曲函数：sinh x = (eˣ-e⁻ˣ)/2，cosh x = (eˣ+e⁻ˣ)/2。恒等式 cosh²x - sinh²x = 1（与三角恒等式符号相反）。求导：d/dx sinh x = cosh x，d/dx cosh x = sinh x。',
    enBody: 'Hyperbolic functions: sinh x = (eˣ-e⁻ˣ)/2, cosh x = (eˣ+e⁻ˣ)/2. Identity: cosh²x - sinh²x = 1 (note the minus, unlike trig). Derivatives: d/dx sinh x = cosh x, d/dx cosh x = sinh x.',
    quiz: { question: 'cosh²x - sinh²x 等于？', options: ['1', '-1', '0', '2'], answerIndex: 0, explanation: '双曲恒等式 cosh²x - sinh²x = 1。' }
  },
  {
    id: 'alevel_p3_i6', courseId: 'alevel_pure3', chapterId: 'alevel_pure3_ch0', type: 'lecture',
    title: '有理函数积分',
    enTitle: 'Integrating Rational Functions',
    body: '有理函数积分用部分分式分解：把分式拆成简单分式之和再逐项积分。分解方法：分母因式分解后设待定系数，解方程确定系数。适用于分母可因式分解的情况。',
    enBody: 'Integrate rational functions by partial fractions: decompose into simpler fractions, then integrate term by term. Factor the denominator, set undetermined coefficients, and solve. Works when the denominator factors.',
    quiz: { question: '部分分式分解用于？', options: ['有理函数积分', '求极限', '解方程', '矩阵运算'], answerIndex: 0, explanation: '把复杂分式拆成简单分式再积分。' }
  },
  {
    id: 'alevel_p3_i7', courseId: 'alevel_pure3', chapterId: 'alevel_pure3_ch0', type: 'lecture',
    title: '泰勒级数与逼近',
    enTitle: 'Taylor Series and Approximations',
    body: '泰勒级数把函数在某点附近展开成多项式。常用：eˣ、sin x、cos x 在 x=0 的麦克劳林展开。用前几项近似计算函数值，误差由余项估计控制。',
    enBody: 'Taylor series expand a function into a polynomial near a point. Common Maclaurin expansions (at x=0) include eˣ, sin x, cos x. Use the first few terms to approximate, with the remainder controlling error.',
    quiz: { question: '麦克劳林展开是在哪一点的泰勒展开？', options: ['x=1', 'x=0', 'x=∞', '任意点'], answerIndex: 1, explanation: '麦克劳林展开是 x=0 处的泰勒展开特例。' }
  },
  {
    id: 'alevel_p3_i8', courseId: 'alevel_pure3', chapterId: 'alevel_pure3_ch0', type: 'lecture',
    title: '向量叉积',
    enTitle: 'Vector Cross Product',
    body: '叉积 a×b 得到一个垂直于 a、b 的向量，模 |a×b| = |a||b|sinθ。用于求法向量、三角形面积（面积的一半）。行列式法计算分量。注意叉积反交换律 a×b = -(b×a)。',
    enBody: 'The cross product a×b gives a vector perpendicular to both, with magnitude |a||b|sinθ. Use it for normal vectors and triangle areas. Compute via determinant. Note a×b = -(b×a).',
    quiz: { question: '叉积 a×b 的结果是？', options: ['标量', '垂直于 a、b 的向量', '平行于 a 的向量', '单位向量'], answerIndex: 1, explanation: '叉积结果是同时垂直于两个操作向量的向量。' }
  },

  // ===== A-Level 力学 alevel_mech =====
  {
    id: 'alevel_mech_i5', courseId: 'alevel_mech', chapterId: 'alevel_mech_ch0', type: 'lecture',
    title: '摩擦力',
    enTitle: 'Friction',
    body: '摩擦力 f ≤ μN，最大静摩擦 f_max = μN（μ 摩擦系数、N 法向力）。动摩擦 f = μₖN。当物体刚要滑动时 f 取最大值。解题判断物体是否滑动是第一步。',
    enBody: 'Friction satisfies f ≤ μN, with maximum static friction f_max = μN (μ coefficient, N normal force). Kinetic friction f = μₖN. At the point of slipping, f is maximal. First determine whether sliding occurs.',
    quiz: { question: '最大静摩擦 f_max 等于？', options: ['μN', 'μN²', 'μ/N', 'N/μ'], answerIndex: 0, explanation: '最大静摩擦 = 摩擦系数 × 法向力 = μN。' }
  },
  {
    id: 'alevel_mech_i6', courseId: 'alevel_mech', chapterId: 'alevel_mech_ch0', type: 'lecture',
    title: '动量与冲量',
    enTitle: 'Momentum and Impulse',
    body: '动量 p = mv。冲量 = 力 × 时间 = 动量变化 = Δ(mv)。动量守恒：无外力时系统总动量不变。碰撞问题用动量守恒和恢复系数 e 联合求解。',
    enBody: 'Momentum p = mv. Impulse = force × time = change in momentum = Δ(mv). Momentum is conserved without external forces. Collision problems combine conservation of momentum with the restitution coefficient e.',
    quiz: { question: '冲量等于？', options: ['质量×速度', '力×时间', '力×位移', '质量×加速度'], answerIndex: 1, explanation: '冲量 = 力 × 作用时间 = 动量变化。' }
  },
  {
    id: 'alevel_mech_i7', courseId: 'alevel_mech', chapterId: 'alevel_mech_ch0', type: 'lecture',
    title: '力矩平衡',
    enTitle: 'Moments and Equilibrium',
    body: '力矩 = 力 × 垂直距离。刚体平衡需满足：合力为零 + 合力矩为零。取支点为矩心可简化计算。杠杆、桥梁、悬臂都是力矩平衡的典型应用。',
    enBody: 'Moment = force × perpendicular distance. A rigid body in equilibrium has zero resultant force and zero resultant moment. Taking moments about a pivot simplifies calculations. Levers and bridges are typical applications.',
    quiz: { question: '刚体平衡需要满足？', options: ['合力为零', '合力矩为零', '两者都为零', '两者都不为零'], answerIndex: 2, explanation: '平衡需合力为零且合力矩为零。' }
  },
  {
    id: 'alevel_mech_i8', courseId: 'alevel_mech', chapterId: 'alevel_mech_ch0', type: 'lecture',
    title: '圆周运动',
    enTitle: 'Circular Motion',
    body: '匀速圆周运动：向心加速度 a = v²/r = rω²。向心力 F = mv²/r。角速度 ω = v/r，周期 T = 2π/ω。向心力由重力、张力或摩擦力等提供。',
    enBody: 'Uniform circular motion: centripetal acceleration a = v²/r = rω², and force F = mv²/r. Angular velocity ω = v/r, period T = 2π/ω. The centripetal force is provided by gravity, tension, or friction.',
    quiz: { question: '向心加速度等于？', options: ['v²/r', 'vr', 'v/r²', 'r/v'], answerIndex: 0, explanation: '向心加速度 a = v²/r。' }
  },

  // ===== IB 数学AA ib_math_aa =====
  {
    id: 'ib_aa_i5', courseId: 'ib_math_aa', chapterId: 'ib_math_aa_ch0', type: 'lecture',
    title: '极限与连续性',
    enTitle: 'Limits and Continuity',
    body: '极限描述函数在某点的趋近值。连续函数满足 lim f(x) = f(a)。判断连续性三条件：函数在 a 有定义、极限存在、极限值等于函数值。夹逼定理是求极限的重要工具。',
    enBody: 'A limit describes the value a function approaches. A function is continuous if lim f(x) = f(a). Three conditions: f(a) exists, the limit exists, and they are equal. The squeeze theorem is a key tool.',
    quiz: { question: '连续函数在 a 点需满足？', options: ['极限等于函数值', '函数有定义即可', '极限存在即可', '可导即可'], answerIndex: 0, explanation: '连续性要求极限值等于该点函数值。' }
  },
  {
    id: 'ib_aa_i6', courseId: 'ib_math_aa', chapterId: 'ib_math_aa_ch0', type: 'lecture',
    title: '反三角函数求导',
    enTitle: 'Inverse Trig Derivatives',
    body: '反三角函数求导公式：d/dx arcsin x = 1/√(1-x²)，d/dx arctan x = 1/(1+x²)，d/dx arccos x = -1/√(1-x²)。配合链式法则处理复合形式。',
    enBody: 'Inverse trig derivatives: d/dx arcsin x = 1/√(1-x²), d/dx arctan x = 1/(1+x²), d/dx arccos x = -1/√(1-x²). Apply the chain rule for composite forms.',
    quiz: { question: 'd/dx arctan x 等于？', options: ['1/(1+x²)', '1/√(1-x²)', '-1/(1+x²)', 'tan x'], answerIndex: 0, explanation: 'arctan x 的导数是 1/(1+x²)。' }
  },
  {
    id: 'ib_aa_i7', courseId: 'ib_math_aa', chapterId: 'ib_math_aa_ch0', type: 'lecture',
    title: '数列与级数收敛',
    enTitle: 'Sequence and Series Convergence',
    body: '等比数列前 n 项和 Sₙ = a(1-rⁿ)/(1-r)。无穷等比级数当 |r|<1 时收敛，和 S = a/(1-r)。判断级数敛散用比值检验、比较检验等。',
    enBody: 'Geometric sum Sₙ = a(1-rⁿ)/(1-r). An infinite geometric series converges when |r|<1 with sum S = a/(1-r). Test convergence with the ratio test or comparison test.',
    quiz: { question: '无穷等比级数收敛条件是？', options: ['|r|<1', '|r|>1', 'r=1', '任意 r'], answerIndex: 0, explanation: '公比绝对值小于 1 时级数收敛。' }
  },
  {
    id: 'ib_aa_i8', courseId: 'ib_math_aa', chapterId: 'ib_math_aa_ch0', type: 'lecture',
    title: '复数根与单位根',
    enTitle: 'Complex Roots',
    body: '方程 zⁿ = 1 有 n 个复数根，均匀分布在单位圆上，称为 n 次单位根。用棣莫弗定理求根：z = cos(2kπ/n) + i sin(2kπ/n)。这些根在复平面成对称分布。',
    enBody: 'The equation zⁿ = 1 has n complex roots evenly spaced on the unit circle, called nth roots of unity. Use De Moivre: z = cos(2kπ/n) + i sin(2kπ/n). The roots are symmetric on the complex plane.',
    quiz: { question: 'z⁴=1 有几个复数根？', options: ['1', '2', '4', '无穷'], answerIndex: 2, explanation: 'z⁴=1 有 4 个根，均匀分布在单位圆上。' }
  },

  // ===== IB 数学AI ib_math_ai =====
  {
    id: 'ib_ai_i5', courseId: 'ib_math_ai', chapterId: 'ib_math_ai_ch0', type: 'lecture',
    title: '图论基础',
    enTitle: 'Introduction to Graph Theory',
    body: '图由顶点和边构成。欧拉路径经过每条边一次，哈密顿路径经过每个顶点一次。最小生成树用 Kruskal 或 Prim 算法。图论用于路线规划、网络设计。',
    enBody: 'A graph consists of vertices and edges. An Eulerian path visits each edge once; a Hamiltonian path visits each vertex once. Minimum spanning trees use Kruskal or Prim. Graphs model routing and networks.',
    quiz: { question: '经过每条边恰好一次的路径叫？', options: ['欧拉路径', '哈密顿路径', '生成树', '最短路径'], answerIndex: 0, explanation: '欧拉路径遍历所有边一次，哈密顿路径遍历所有顶点一次。' }
  },
  {
    id: 'ib_ai_i6', courseId: 'ib_math_ai', chapterId: 'ib_math_ai_ch0', type: 'lecture',
    title: '二项分布与泊松',
    enTitle: 'Binomial and Poisson',
    body: '二项分布 X~B(n,p) 描述 n 次独立试验成功次数，P(X=k)=C(n,k)p^k(1-p)^(n-k)。当 n 大 p 小时，泊松分布 Po(λ=np) 是良好近似，P(X=k)=λᵏe⁻λ/k!。',
    enBody: 'Binomial X~B(n,p) counts successes in n independent trials: P(X=k)=C(n,k)p^k(1-p)^(n-k). When n is large and p small, Poisson Po(λ=np) approximates it: P(X=k)=λᵏe⁻λ/k!.',
    quiz: { question: '泊松分布常用于近似？', options: ['n 大 p 小的二项分布', '均匀分布', '正态分布', '指数分布'], answerIndex: 0, explanation: '当 n 大 p 小时，泊松分布近似二项分布。' }
  },
  {
    id: 'ib_ai_i7', courseId: 'ib_math_ai', chapterId: 'ib_math_ai_ch0', type: 'lecture',
    title: '矩阵与线性规划',
    enTitle: 'Matrices and Linear Programming',
    body: '线性规划在约束条件下求目标函数最值。图解法：画可行域（约束不等式围成的区域），在顶点处求目标函数值。矩阵可表示线性方程组，用高斯消元求解。',
    enBody: 'Linear programming optimizes an objective under constraints. Graphically: draw the feasible region (bounded by constraint inequalities), then evaluate the objective at vertices. Matrices solve linear systems via Gaussian elimination.',
    quiz: { question: '线性规划最优解出现在？', options: ['可行域内部', '可行域顶点', '原点', '任意点'], answerIndex: 1, explanation: '线性规划最优解在可行域的顶点处取得。' }
  },
  {
    id: 'ib_ai_i8', courseId: 'ib_math_ai', chapterId: 'ib_math_ai_ch0', type: 'lecture',
    title: '假设检验与 p 值',
    enTitle: 'Hypothesis Testing and p-values',
    body: '假设检验判断样本是否支持某个假设。p 值是原假设成立时观察到当前结果的概率。p < 显著性水平 α（通常 0.05）则拒绝原假设。IB 要求会用 GDC 计算 p 值。',
    enBody: 'Hypothesis testing judges whether a sample supports a claim. The p-value is the probability of observing the result if H₀ is true. Reject H₀ if p < α (typically 0.05). IB requires computing p-values with a GDC.',
    quiz: { question: 'p < 0.05 时应该？', options: ['接受原假设', '拒绝原假设', '无结论', '重新取样'], answerIndex: 1, explanation: 'p 值小于显著性水平时拒绝原假设。' }
  },

  // ===== IGCSE 物理 igcse_phy =====
  {
    id: 'igcse_phy_i5', courseId: 'igcse_phy', chapterId: 'igcse_phy_ch0', type: 'lecture',
    title: '波的性质',
    enTitle: 'Properties of Waves',
    body: '波速 v = fλ（频率 × 波长）。横波振动方向垂直传播方向（光波），纵波振动方向平行（声波）。反射、折射、衍射是波的三种基本现象。',
    enBody: 'Wave speed v = fλ (frequency × wavelength). Transverse waves oscillate perpendicular to travel (light); longitudinal waves parallel (sound). Reflection, refraction, and diffraction are three basic phenomena.',
    quiz: { question: '波速等于？', options: ['fλ', 'f/λ', 'λ/f', 'f+λ'], answerIndex: 0, explanation: '波速 = 频率 × 波长 = fλ。' }
  },
  {
    id: 'igcse_phy_i6', courseId: 'igcse_phy', chapterId: 'igcse_phy_ch0', type: 'lecture',
    title: '光的反射与折射',
    enTitle: 'Reflection and Refraction',
    body: '反射定律：入射角等于反射角。折射定律（斯涅尔定律）：n₁sinθ₁ = n₂sinθ₂。光从光密到光疏介质且入射角大于临界角时发生全反射。',
    enBody: 'Law of reflection: angle of incidence equals angle of reflection. Snell\'s law: n₁sinθ₁ = n₂sinθ₂. Total internal reflection occurs from denser to rarer media beyond the critical angle.',
    quiz: { question: '斯涅尔定律是？', options: ['n₁sinθ₁=n₂sinθ₂', 'n₁=n₂', 'sinθ=0', 'n₁θ₁=n₂θ₂'], answerIndex: 0, explanation: '斯涅尔定律：n₁sinθ₁ = n₂sinθ₂。' }
  },
  {
    id: 'igcse_phy_i7', courseId: 'igcse_phy', chapterId: 'igcse_phy_ch0', type: 'lecture',
    title: '热传导三种方式',
    enTitle: 'Heat Transfer',
    body: '热传递三种方式：传导（固体分子碰撞）、对流（流体流动）、辐射（电磁波，无需介质）。真空瓶利用真空阻止传导和对流，镀银面反射辐射。',
    enBody: 'Three modes of heat transfer: conduction (molecular collisions in solids), convection (fluid flow), radiation (electromagnetic, no medium needed). A vacuum flask stops conduction and convection via vacuum, and radiation via silvering.',
    quiz: { question: '无需介质的传热方式是？', options: ['传导', '对流', '辐射', '以上都不是'], answerIndex: 2, explanation: '辐射通过电磁波传热，不需要介质。' }
  },
  {
    id: 'igcse_phy_i8', courseId: 'igcse_phy', chapterId: 'igcse_phy_ch0', type: 'lecture',
    title: '电路元件与电阻',
    enTitle: 'Circuit Components',
    body: '电阻串联 R=R₁+R₂，并联 1/R=1/R₁+1/R₂。常见元件：电阻器、二极管（单向导电）、热敏电阻（温度变化）、光敏电阻（光照变化）。伏安特性曲线描述元件特性。',
    enBody: 'Resistors in series: R=R₁+R₂; in parallel: 1/R=1/R₁+1/R₂. Common components: resistor, diode (one-way), thermistor (temperature), LDR (light). I-V curves describe component behavior.',
    quiz: { question: '两个相同电阻 R 并联，总电阻是？', options: ['2R', 'R/2', 'R', 'R²'], answerIndex: 1, explanation: '并联 1/R总=1/R+1/R，故 R总=R/2。' }
  },

  // ===== A-Level 数学 alevel_math =====
  {
    id: 'alevel_math_i5', courseId: 'alevel_math', chapterId: 'alevel_math_ch0', type: 'lecture',
    title: '反函数求导',
    enTitle: 'Derivative of Inverse Functions',
    body: '反函数求导公式：(f⁻¹)\'(y) = 1/f\'(x)，其中 y=f(x)。可用于求反三角函数导数。本质是链式法则的运用：f(f⁻¹(x))=x 两边求导。',
    enBody: 'Derivative of an inverse function: (f⁻¹)\'(y) = 1/f\'(x), where y=f(x). This derives inverse trig derivatives and follows from differentiating f(f⁻¹(x))=x.',
    quiz: { question: '(f⁻¹)\'(y) 等于？', options: ['1/f\'(x)', 'f\'(x)', '-f\'(x)', 'f\'(x)²'], answerIndex: 0, explanation: '反函数求导是原函数导数的倒数。' }
  },
  {
    id: 'alevel_math_i6', courseId: 'alevel_math', chapterId: 'alevel_math_ch0', type: 'lecture',
    title: '参数方程求导',
    enTitle: 'Parametric Differentiation',
    body: '参数方程 x=f(t), y=g(t)，导数 dy/dx = (dy/dt)/(dx/dt)。二阶导 d²y/dx² = d/dx(dy/dx) = [d/dt(dy/dx)]/(dx/dt)。用于求切线斜率。',
    enBody: 'For parametric x=f(t), y=g(t), the derivative is dy/dx = (dy/dt)/(dx/dt). The second derivative is d²y/dx² = [d/dt(dy/dx)]/(dx/dt).',
    quiz: { question: '参数方程 dy/dx 等于？', options: ['(dy/dt)/(dx/dt)', 'dy/dt·dx/dt', 'dx/dt/dy/dt', 'dy/dx·dt'], answerIndex: 0, explanation: 'dy/dx = (dy/dt)/(dx/dt)。' }
  },
  {
    id: 'alevel_math_i7', courseId: 'alevel_math', chapterId: 'alevel_math_ch0', type: 'lecture',
    title: '微分方程建模',
    enTitle: 'Modelling with Differential Equations',
    body: '实际问题（人口增长、冷却、放射性衰变）可建模为微分方程。常见模型：指数增长 dy/dt = ky，解为 y = Ce^(kt)。解题：建方程 → 解方程 → 用初始条件定常数 → 解释结果。',
    enBody: 'Real problems (population, cooling, decay) are modelled by differential equations. A common model is dy/dt = ky with solution y = Ce^(kt). Steps: set up, solve, apply initial conditions, interpret.',
    quiz: { question: 'dy/dt = ky 的通解是？', options: ['y=Ce^(kt)', 'y=kt+C', 'y=k ln t', 'y=t^k'], answerIndex: 0, explanation: '指数增长方程的解为 y = Ce^(kt)。' }
  },
  {
    id: 'alevel_math_i8', courseId: 'alevel_math', chapterId: 'alevel_math_ch0', type: 'lecture',
    title: '级数求和与收敛',
    enTitle: 'Series and Convergence',
    body: '等差、等比级数求和公式是基础。泰勒级数、麦克劳林级数用于函数逼近。判断级数收敛用比值检验、积分检验等。收敛半径决定幂级数有效范围。',
    enBody: 'Arithmetic and geometric series sums are foundational. Taylor and Maclaurin series approximate functions. Test convergence with the ratio or integral test. The radius of convergence bounds a power series.',
    quiz: { question: '等比级数公比 |r|<1 时无穷和是？', options: ['a/(1-r)', 'a(1-r)', 'a rⁿ', 'a/(r-1)'], answerIndex: 0, explanation: '无穷等比级数和 S = a/(1-r)。' }
  },

  // ===== A-Level 物理 alevel_phy =====
  {
    id: 'alevel_phy_i5', courseId: 'alevel_phy', chapterId: 'alevel_phy_ch0', type: 'lecture',
    title: '简谐运动',
    enTitle: 'Simple Harmonic Motion',
    body: '简谐运动（SHM）回复力与位移成正比反向：F = -kx。位移 x = A cos(ωt)，速度 v = -Aω sin(ωt)。周期 T = 2π√(m/k)。弹簧振子和单摆是典型例子。',
    enBody: 'In SHM, the restoring force is proportional and opposite to displacement: F = -kx. Displacement x = A cos(ωt), velocity v = -Aω sin(ωt). Period T = 2π√(m/k). Spring and pendulum are examples.',
    quiz: { question: 'SHM 回复力的特点是？', options: ['与位移成正比反向', '恒为常数', '与速度成正比', '与位移平方成正比'], answerIndex: 0, explanation: 'F = -kx，回复力与位移成正比且方向相反。' }
  },
  {
    id: 'alevel_phy_i6', courseId: 'alevel_phy', chapterId: 'alevel_phy_ch0', type: 'lecture',
    title: '引力场',
    enTitle: 'Gravitational Fields',
    body: '万有引力 F = GMm/r²。引力场强度 g = GM/r²。引力势能 U = -GMm/r。卫星轨道、逃逸速度 v = √(2GM/r) 都是引力场应用。',
    enBody: 'Gravitational force F = GMm/r². Field strength g = GM/r². Potential energy U = -GMm/r. Satellite orbits and escape velocity v = √(2GM/r) are applications.',
    quiz: { question: '万有引力与距离的关系是？', options: ['正比 r', '反比 r²', '反比 r', '正比 r²'], answerIndex: 1, explanation: 'F = GMm/r²，与距离平方成反比。' }
  },
  {
    id: 'alevel_phy_i7', courseId: 'alevel_phy', chapterId: 'alevel_phy_ch0', type: 'lecture',
    title: '电容与充放电',
    enTitle: 'Capacitance and Charging',
    body: '电容 C = Q/V。平行板电容 C = εA/d。充电时电压按指数上升，放电时指数下降，时间常数 τ = RC。电容储能 E = ½CV²。',
    enBody: 'Capacitance C = Q/V. Parallel plate C = εA/d. Charging raises voltage exponentially, discharging lowers it, with time constant τ = RC. Stored energy E = ½CV².',
    quiz: { question: '电容储能公式是？', options: ['½CV²', 'CV', '½CV', 'CV²/4'], answerIndex: 0, explanation: '电容储存的能量 E = ½CV²。' }
  },
  {
    id: 'alevel_phy_i8', courseId: 'alevel_phy', chapterId: 'alevel_phy_ch0', type: 'lecture',
    title: '电磁感应',
    enTitle: 'Electromagnetic Induction',
    body: '法拉第定律：感应电动势 ε = -N·dΦ/dt（磁通量变化率）。楞次定律：感应电流方向总是阻碍磁通量变化。发电机、变压器都基于电磁感应。',
    enBody: 'Faraday\'s law: induced emf ε = -N·dΦ/dt (rate of flux change). Lenz\'s law: the induced current opposes the flux change. Generators and transformers rely on induction.',
    quiz: { question: '法拉第定律中 ε 与什么成正比？', options: ['磁通量', '磁通量变化率', '磁通量平方', '时间'], answerIndex: 1, explanation: '感应电动势与磁通量的变化率成正比。' }
  },

  // ===== IB 数学 ib_math =====
  {
    id: 'ib_math_i5', courseId: 'ib_math', chapterId: 'ib_math_ch0', type: 'lecture',
    title: '向量点积与夹角',
    enTitle: 'Dot Product and Angles',
    body: '点积 a·b = |a||b|cosθ，用于求两向量夹角：cosθ = a·b/(|a||b|)。点积为 0 则两向量垂直。投影：a 在 b 上的投影长度 = a·b/|b|。',
    enBody: 'The dot product a·b = |a||b|cosθ finds the angle: cosθ = a·b/(|a||b|). If the dot product is 0, the vectors are perpendicular. Projection of a onto b = a·b/|b|.',
    quiz: { question: 'a·b = 0 说明两向量？', options: ['平行', '垂直', '相等', '反向'], answerIndex: 1, explanation: '点积为零表示两向量垂直。' }
  },
  {
    id: 'ib_math_i6', courseId: 'ib_math', chapterId: 'ib_math_ch0', type: 'lecture',
    title: '矩阵逆与行列式',
    enTitle: 'Matrix Inverse and Determinant',
    body: '2×2 矩阵逆：A⁻¹ = (1/det)(d -b; -c a)，det = ad-bc。det=0 时矩阵不可逆。行列式表示线性变换的面积缩放因子。用逆矩阵解线性方程组 AX=B → X=A⁻¹B。',
    enBody: 'For a 2×2 matrix, A⁻¹ = (1/det)(d -b; -c a) with det = ad-bc. If det=0, the matrix is singular. The determinant is the area scale factor. Solve AX=B as X=A⁻¹B.',
    quiz: { question: 'det=0 说明矩阵？', options: ['可逆', '不可逆', '是单位阵', '是对称阵'], answerIndex: 1, explanation: '行列式为零的矩阵不可逆（奇异矩阵）。' }
  },
  {
    id: 'ib_math_i7', courseId: 'ib_math', chapterId: 'ib_math_ch0', type: 'lecture',
    title: '微积分基本定理',
    enTitle: 'Fundamental Theorem of Calculus',
    body: '微积分基本定理联系了微分与积分：∫ₐᵇ f(x)dx = F(b) - F(a)，其中 F 是 f 的原函数。它使定积分计算变得直接。变上限积分求导 d/dx ∫ₐˣ f(t)dt = f(x)。',
    enBody: 'The fundamental theorem links differentiation and integration: ∫ₐᵇ f(x)dx = F(b) - F(a), where F is an antiderivative. This makes definite integrals straightforward. Also d/dx ∫ₐˣ f(t)dt = f(x).',
    quiz: { question: '∫ₐᵇ f(x)dx 等于？', options: ['F(b)-F(a)', 'F(a)-F(b)', 'F(b)+F(a)', 'f(b)-f(a)'], answerIndex: 0, explanation: '定积分等于原函数在上下限的值之差。' }
  },
  {
    id: 'ib_math_i8', courseId: 'ib_math', chapterId: 'ib_math_ch0', type: 'lecture',
    title: '正态分布标准化',
    enTitle: 'Standardizing the Normal Distribution',
    body: '标准正态分布 N(0,1)。标准化：Z = (X-μ)/σ，把任意正态分布转化为标准正态。用 Z 表或 GDC 求概率 P(X<x)。反查表可求给定概率对应的临界值。',
    enBody: 'The standard normal is N(0,1). Standardize with Z = (X-μ)/σ to convert any normal to standard. Use a Z-table or GDC for P(X<x). Inverse lookup finds critical values for a given probability.',
    quiz: { question: '标准化公式是？', options: ['(X-μ)/σ', '(X+μ)/σ', 'X·σ+μ', '(X-σ)/μ'], answerIndex: 0, explanation: 'Z = (X-μ)/σ。' }
  },

  // ===== IB 物理 ib_phy =====
  {
    id: 'ib_phy_i5', courseId: 'ib_phy', chapterId: 'ib_phy_ch0', type: 'lecture',
    title: '动量守恒',
    enTitle: 'Conservation of Momentum',
    body: '孤立系统总动量守恒。碰撞分弹性（动能守恒）和非弹性（动能损失）。动量守恒与能量守恒联立解碰撞问题。火箭推进基于动量守恒。',
    enBody: 'Total momentum is conserved in an isolated system. Collisions are elastic (kinetic energy conserved) or inelastic (energy lost). Solve collision problems with momentum and energy conservation. Rockets rely on momentum conservation.',
    quiz: { question: '弹性碰撞中守恒的是？', options: ['仅动量', '仅动能', '动量和动能', '都不守恒'], answerIndex: 2, explanation: '弹性碰撞同时守恒动量和动能。' }
  },
  {
    id: 'ib_phy_i6', courseId: 'ib_phy', chapterId: 'ib_phy_ch0', type: 'lecture',
    title: '光电效应',
    enTitle: 'The Photoelectric Effect',
    body: '光照射金属表面逸出电子。爱因斯坦方程：hf = φ + KE_max（光子能量 = 逸出功 + 最大动能）。阈值频率 f₀ = φ/h，低于此频率无论光多强都不逸出电子。',
    enBody: 'Light ejects electrons from metal surfaces. Einstein\'s equation: hf = φ + KE_max. The threshold frequency f₀ = φ/h — below it, no electrons escape regardless of intensity.',
    quiz: { question: '爱因斯坦光电方程是？', options: ['hf=φ+KE_max', 'E=mc²', 'F=ma', 'V=IR'], answerIndex: 0, explanation: '光子能量 = 逸出功 + 最大动能。' }
  },
  {
    id: 'ib_phy_i7', courseId: 'ib_phy', chapterId: 'ib_phy_ch0', type: 'lecture',
    title: '双缝干涉',
    enTitle: 'Double-Slit Interference',
    body: '双缝干涉条纹间距 x = λD/d（λ 波长、D 屏距、d 缝距）。亮纹满足 d sinθ = nλ，暗纹满足 d sinθ = (n+½)λ。实验证明光的波动性。',
    enBody: 'Double-slit fringe spacing x = λD/d (λ wavelength, D screen distance, d slit separation). Bright fringes: d sinθ = nλ; dark: d sinθ = (n+½)λ. The experiment proves light\'s wave nature.',
    quiz: { question: '条纹间距与波长 λ 的关系是？', options: ['正比', '反比', '无关', '平方'], answerIndex: 0, explanation: 'x = λD/d，条纹间距与波长成正比。' }
  },
  {
    id: 'ib_phy_i8', courseId: 'ib_phy', chapterId: 'ib_phy_ch0', type: 'lecture',
    title: '放射性衰变',
    enTitle: 'Radioactive Decay',
    body: '衰变定律 N = N₀e^(-λt)，λ 是衰变常数。半衰期 T½ = ln2/λ。活度 A = λN，单位贝克勒尔（Bq）。衰变是随机的，半衰期是统计规律。',
    enBody: 'Decay law N = N₀e^(-λt) with decay constant λ. Half-life T½ = ln2/λ. Activity A = λN in becquerels (Bq). Decay is random; half-life is a statistical rule.',
    quiz: { question: '半衰期 T½ 等于？', options: ['ln2/λ', 'λ/ln2', '2λ', 'λ²'], answerIndex: 0, explanation: 'T½ = ln2/λ。' }
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

console.log('=== 理科类扩充完成 ===');
console.log('新增:', ADD.length, '条 | 总知识点:', knowledge.length);
