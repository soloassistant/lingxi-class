/**
 * 补齐双语内容（一次性）：
 *   - 为所有知识点补 enTitle / enBody（真实英文教学对照）
 *   - 修复 ielts_listening_basics 的省略号占位正文
 * 运行：node _test/fill-en.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DATA_FILE = path.join(__dirname, '..', 'miniprogram', 'data', 'courses.js');
const d = require(DATA_FILE);

// id -> { enTitle, enBody, body? }
const EN = {
  ielts_listening_basics: {
    enTitle: 'IELTS Listening: Locating Words',
    body: '定位词（locating words）用于在听力录音中快速锁定答案所在的句子。最适合做定位词的通常是专有名词（人名、地名、机构名）和数字，因为它们不容易被同义替换。听到定位词就要提高警觉，答案往往紧随其后。',
    enBody: 'Locating words help you quickly find the sentence that contains the answer. The best locating words are proper nouns (names, places, institutions) and numbers, because they are rarely paraphrased. When you hear a locating word, be alert: the answer usually follows immediately.'
  },
  toefl_b2_i1: {
    enTitle: 'The Cornell Note-Taking Method',
    enBody: 'TOEFL lectures are information-dense, so the Cornell method helps: divide the page into a main column (right, key points), a cue column (left, keywords), and a summary bar (bottom). Take notes in the main column while listening, write cues during pauses, and spend 10 seconds summarizing at the end.'
  },
  toefl_b2_i2: {
    enTitle: 'Signal Words',
    enBody: 'Signal words in lectures reveal structure and emphasis. Listing: first, besides, another. Contrast: however, but, in contrast. Cause-effect: therefore, as a result, consequently. Examples: for instance, such as, take ... as an example. Be especially alert when you hear cause-effect signals.'
  },
  toefl_b2_i3: {
    enTitle: 'Lecture Structure',
    enBody: 'Academic lectures follow a stable structure: introduce the topic, give background, define the core concept, develop points, give examples, then the professor evaluates and summarizes. Predicting this structure lets you locate information early — hearing "let\'s define" tells you a definition is coming.'
  },
  toefl_b2_i4: {
    enTitle: 'Note-Taking Symbols',
    enBody: 'Use symbols instead of full words in notes: an arrow (→) means "leads to", (←) "comes from", (↑) increase, (↓) decrease, (∵) because, (∴) therefore, (=) equals or means, (×) not or wrong, (≠) different. Symbols help you keep up with the speaker\'s pace.'
  },
  toefl_adv_i1: {
    enTitle: 'Integrated Writing Framework',
    enBody: 'Integrated writing is a "reading vs. listening" contrast framework. The reading presents three points, and the lecture rebuts them one by one. Basic structure: an introduction summarizing the relationship, then three body paragraphs (each stating a reading point, then the lecture\'s counterargument).'
  },
  toefl_adv_i2: {
    enTitle: 'Template Sentences',
    enBody: 'High-frequency templates: "The reading passage argues that ... However, the lecturer challenges this by explaining that ..." Remember that templates only build the skeleton; over 70% of your essay must be your own language and details, not copied verbatim.'
  },
  toefl_adv_i3: {
    enTitle: 'Reading Prediction',
    enBody: 'During the 3-minute reading phase, mark the three arguments with your pencil: look for "firstly / secondly / finally" or topic sentences. Summarize each point in one sentence in advance, which prepares you to locate the lecture\'s rebuttals.'
  },
  toefl_adv_i4: {
    enTitle: 'Scoring Criteria',
    enBody: 'Integrated writing is scored on completeness (covering all reading and listening points), accuracy (not distorting information), and clarity. Missing one point usually rules out a 28+ score. So prefer less ornamentation over omitting key points.'
  },
  igcse_math_i1: {
    enTitle: 'Quadratic Equations',
    enBody: 'The quadratic ax² + bx + c = 0 can be solved three ways: factoring (fastest), completing the square (rigorous), and the quadratic formula x = [-b ± √(b²-4ac)] / (2a). The discriminant Δ = b² - 4ac: Δ > 0 gives two real roots, Δ = 0 one repeated root, Δ < 0 no real roots.'
  },
  igcse_math_i2: {
    enTitle: 'Factorisation',
    enBody: 'Factorisation writes a polynomial as a product of factors. Common cases: taking a common factor ax + bx = x(a+b); difference of squares a² - b² = (a+b)(a-b); perfect square a² ± 2ab + b² = (a±b)². First look for a common factor, then for a special form.'
  },
  igcse_math_i3: {
    enTitle: 'Completing the Square',
    enBody: 'Perfect-square trinomials: a² + 2ab + b² = (a+b)² and a² - 2ab + b² = (a-b)². The key check: can the first and last terms form a square, and is the middle term twice the product? For example, x² + 6x + 9 = (x+3)².'
  },
  igcse_math_i4: {
    enTitle: 'Solving Inequalities',
    enBody: 'Solving inequalities is like solving equations, but multiplying or dividing by a negative reverses the direction. Example: -2x < 6 → x > -3. Show solution sets on a number line with a closed dot for inclusive and an open dot for exclusive. Note the difference between "at least" and "more than".'
  },
  igcse_am_i1: {
    enTitle: 'Basic Differentiation Rules',
    enBody: 'Differentiation finds a rate of change. Power rule: d/dx (xⁿ) = nxⁿ⁻¹. The derivative of a constant is 0. For example, the derivative of y = x³ is 3x². Geometrically, the derivative is the slope of the tangent at that point.'
  },
  igcse_am_i2: {
    enTitle: 'Tangent Slope',
    enBody: 'To find the tangent slope at a point on a curve, first differentiate, then substitute the point\'s x-coordinate. For example, y = x² at x = 3 has slope dy/dx = 2x = 6. A positive slope means increasing, negative means decreasing.'
  },
  igcse_am_i3: {
    enTitle: 'Definite Integrals',
    enBody: 'A definite integral represents the area between a curve and the x-axis: ∫ₐᵇ f(x) dx = F(b) - F(a), where F is an antiderivative of f. For example, ∫₁³ x² dx = [x³/3]₁³ = 27/3 - 1/3 = 26/3. Take absolute values when the area is below the axis.'
  },
  igcse_am_i4: {
    enTitle: 'Applications of Integration',
    enBody: 'Integration finds displacement from a velocity function, area between curves (upper curve minus lower curve), and volume. In applications, draw the graph first to fix the limits of integration, then determine which curve is on top.'
  },
  alevel_p3_i1: {
    enTitle: 'Separation of Variables',
    enBody: 'A separable differential equation has the form dy/dx = f(x)g(y). Method: move all y-terms to one side and x-terms to the other, then integrate both sides. Example: dy/dx = x/y gives y dy = x dx, so y²/2 = x²/2 + C, i.e. y² = x² + C.'
  },
  alevel_p3_i2: {
    enTitle: 'Integrating Factor Method',
    enBody: 'For a first-order linear equation dy/dx + P(x)y = Q(x), use the integrating factor I = e^∫P dx. Multiplying through by I makes the left side equal to (Iy)\', so integrating gives the general solution. Example: dy/dx + y = sin x has P(x) = 1 and I = eˣ.'
  },
  alevel_p3_i3: {
    enTitle: 'Second-Order Constant-Coefficient Equations',
    enBody: 'For ay\'\' + by\' + cy = 0, solve the characteristic equation aλ² + bλ + c = 0. With two distinct real roots λ₁, λ₂, the general solution is y = A e^(λ₁x) + B e^(λ₂x). For a repeated root use y = (A + Bx)e^(λx). Complex roots give trig form.'
  },
  alevel_p3_i4: {
    enTitle: 'Initial Conditions',
    enBody: 'A general solution contains arbitrary constants; initial conditions pin down a unique particular solution. Example: y\' = y with y(0) = 1 gives the general solution y = Ceˣ, so C = 1 and the particular solution is y = eˣ. Substitute initial values only after differentiating and simplifying.'
  },
  alevel_mech_i1: {
    enTitle: "Newton's Second Law",
    enBody: "Newton's second law is F = ma. Force is in newtons (N), where 1 N = 1 kg·m/s². Steps: draw a free-body diagram, resolve the net force, then apply F = ma. Take the direction of motion as positive."
  },
  alevel_mech_i2: {
    enTitle: 'Uniformly Accelerated Motion',
    enBody: 'The five SUVAT equations: v = u + at, s = ut + ½at², v² = u² + 2as, s = (u+v)t/2, and s = vt - ½at². Each involves four variables — given three, solve for the fourth.'
  },
  alevel_mech_i3: {
    enTitle: 'Connected Particles',
    enBody: 'In connected-particle problems, two bodies joined by a string share the same acceleration. Write two equations: an overall equation (external force) and a single-body equation (tension). Example: force F pulls A linked to B, so F - T = mA·a and T = mB·a.'
  },
  alevel_mech_i4: {
    enTitle: 'Conservation of Energy',
    enBody: 'Without friction, mechanical energy is conserved: kinetic + potential = constant. KE = ½mv² and GPE = mgh. Example: an object dropped from height h reaches v = √(2gh). With friction, use the work-energy principle: work done equals change in mechanical energy.'
  },
  ib_aa_i1: {
    enTitle: 'The Chain Rule',
    enBody: 'Differentiate composite functions with the chain rule: dy/dx = dy/du × du/dx. Example: y = sin(2x), let u = 2x, so dy/du = cos(2x) and du/dx = 2, giving dy/dx = 2cos(2x).'
  },
  ib_aa_i2: {
    enTitle: 'Integration by Parts',
    enBody: 'Integration by parts: ∫u dv = uv - ∫v du. Use it for products of two different function types. Choose u by LIATE: Logarithmic, Inverse trig, Algebraic, Trigonometric, Exponential. Example: ∫x eˣ dx with u = x, dv = eˣ dx gives xeˣ - eˣ + C.'
  },
  ib_aa_i3: {
    enTitle: 'Taylor Expansion',
    enBody: 'A Taylor expansion approximates a function near a point with a polynomial: f(x) = f(a) + f\'(a)(x-a) + f\'\'(a)(x-a)²/2! + ... At x = 0 this is the Maclaurin series. Example: eˣ = 1 + x + x²/2! + x³/3! + ...'
  },
  ib_aa_i4: {
    enTitle: 'Integration by Substitution',
    enBody: 'Substitution is a systematic form of the reverse chain rule. Replace the complicated part with u and express dx in terms of du. Example: ∫2x e^(x²) dx with u = x² gives du = 2x dx, so ∫e^u du = e^(x²) + C. Check that dx is fully replaced.'
  },
  ib_ai_i1: {
    enTitle: 'The Normal Distribution',
    enBody: 'The normal distribution N(μ, σ²) has mean μ and standard deviation σ. The 68-95-99.7 rule: 68% of data lie within μ±σ, 95% within μ±2σ, 99.7% within μ±3σ. Standardize with the z-score Z = (X - μ)/σ.'
  },
  ib_ai_i2: {
    enTitle: 'Linear Regression',
    enBody: 'Linear regression y = ax + b finds the best-fit line by minimizing the sum of squared residuals. The coefficient of determination r² measures how well the model explains variation; r close to 1 means a strong linear relationship. If |r| < 0.3, the linear model is unreliable.'
  },
  ib_ai_i3: {
    enTitle: 'Compound Growth',
    enBody: 'The compound growth model is A = P(1 + r/n)^(nt), where P is principal, r the annual rate, n the compounding frequency per year, and t the years. A negative r models decay. As n → ∞ we get continuous compounding: A = P e^(rt).'
  },
  ib_ai_i4: {
    enTitle: 'Error Propagation',
    enBody: 'For additive models, absolute errors add; for multiplicative models, relative errors add. Example: measuring length L = 10±0.1 cm and width W = 5±0.1 cm, the relative error of the perimeter is easier to compute than that of the area.'
  },
  ap_calc_i1: {
    enTitle: 'Taylor Series Expansion',
    enBody: 'A Taylor series expands a function about a point: f(x) = f(a) + f\'(a)(x-a) + f\'\'(a)(x-a)²/2! + ... The Maclaurin series is the special case a = 0. For smooth functions, more terms give a more accurate approximation.'
  },
  ap_calc_i2: {
    enTitle: 'Radius of Convergence',
    enBody: 'The radius of convergence R determines where a power series converges. Ratio test: R = lim |aₙ/aₙ₊₁|. The series converges absolutely for |x-a| < R, diverges for |x-a| > R, and the endpoints must be tested separately.'
  },
  ap_calc_i3: {
    enTitle: 'Special Maclaurin Expansions',
    enBody: 'Three must-know Maclaurin expansions: eˣ = Σxⁿ/n!, sin x = Σ(-1)ⁿx^(2n+1)/(2n+1)!, cos x = Σ(-1)ⁿx^(2n)/(2n)!. Watch for alternating signs and factorial denominators.'
  },
  ap_calc_i4: {
    enTitle: 'Remainder Estimation',
    enBody: 'The Taylor remainder Rₙ(x) measures the error of a polynomial approximation. Lagrange form: Rₙ(x) = f^(n+1)(c)(x-a)^(n+1)/(n+1)!, where c lies between a and x. Remainder estimates bound the truncation error.'
  },
  ap_stats_i1: {
    enTitle: 'Sampling Methods',
    enBody: 'Statistical inference relies on random sampling. Simple random sampling gives every individual equal probability. Stratified sampling divides by characteristic, then samples each stratum. Cluster sampling randomly selects groups and surveys them entirely. Convenience and voluntary samples are biased.'
  },
  ap_stats_i2: {
    enTitle: 'The Central Limit Theorem',
    enBody: 'The central limit theorem: when n is large enough, the sampling distribution of the sample mean is approximately normal, with mean equal to the population mean μ and standard deviation σ/√n. In practice n ≥ 30 suffices. It underpins confidence intervals.'
  },
  ap_stats_i3: {
    enTitle: 'Confidence Intervals',
    enBody: 'A confidence interval estimates a population parameter. For a mean: sample mean ± z* × σ/√n. A 95% confidence level uses z* = 1.96 (≈ 2). A narrower interval means a more precise estimate.'
  },
  ap_stats_i4: {
    enTitle: 'Significance Tests',
    enBody: 'Hypothesis testing: state H₀ and H₁, compute a test statistic, obtain the p-value, and compare it to the significance level α. If p < α, reject H₀. The p-value is the probability of observing such a result if H₀ were true.'
  },
  sat_math_i1: {
    enTitle: 'Linear Functions',
    enBody: 'A linear function is y = mx + b, where m is the slope and b the y-intercept. Slope = change ratio = (y₂-y₁)/(x₂-x₁). Parallel lines share a slope; perpendicular lines have slopes whose product is -1.'
  },
  sat_math_i2: {
    enTitle: 'Quadratic Functions',
    enBody: 'A quadratic function is y = ax² + bx + c, with vertex x = -b/2a. Vertex form y = a(x-h)² + k has vertex (h,k). The sign of a sets the opening direction (up for positive, down for negative). The discriminant determines the number of x-intercepts.'
  },
  sat_math_i3: {
    enTitle: 'Trigonometric Ratios',
    enBody: 'In a right triangle: sin θ = opposite/hypotenuse, cos θ = adjacent/hypotenuse, tan θ = opposite/adjacent. Remember SOH-CAH-TOA. Common values: sin 30° = 1/2, cos 60° = 1/2, tan 45° = 1.'
  },
  sat_math_i4: {
    enTitle: 'Data Analysis from Graphs',
    enBody: 'When reading graphs, check axis labels, units, and trends. The mean is sensitive to outliers while the median is more robust. In scatter plots, focus on correlation and outliers.'
  },
  sat_write_i1: {
    enTitle: 'Subject-Verb Agreement',
    enBody: 'Subject and verb must agree in number. Parenthetical phrases and appositives do not change the subject\'s number. Collective nouns like "team" take singular when treated as a unit, plural when emphasizing members. "Neither...nor" follows the nearest subject.'
  },
  sat_write_i2: {
    enTitle: 'Punctuation: Commas and Semicolons',
    enBody: 'Joining two independent clauses with a comma requires a FANBOYS conjunction. A semicolon (;) can join two related independent clauses without a conjunction. A colon (:) introduces an explanation or list. A dash (—) marks an insertion or emphasis.'
  },
  sat_write_i3: {
    enTitle: 'Tense Consistency',
    enBody: 'Keep tenses consistent unless the narrative time actually changes. Use past tense for past events and present for universal truths. In if-conditionals, present in the if-clause pairs with future in the main clause: If it rains, we will stay.'
  },
  sat_write_i4: {
    enTitle: 'Logical Transitions',
    enBody: 'however/nevertheless signal contrast; therefore/thus/consequently signal cause-effect; furthermore/moreover/in addition signal addition; for example/such as introduce examples. Choose the transition that matches the logical relationship.'
  },
  igcse_math_i5: {
    enTitle: 'Factorising Quadratics',
    enBody: 'To factor ax²+bx+c, find two numbers whose product is c and whose sum is b (when a = 1). Example: x²+5x+6 = (x+2)(x+3). When a ≠ 1, use grouping or splitting the middle term.'
  },
  igcse_math_i6: {
    enTitle: 'Basic Trigonometry',
    enBody: 'SOH-CAH-TOA. Use sin/cos/tan to find sides from an angle, and inverse trig to find angles. Check the angle mode (degrees). Sine rule a/sinA = b/sinB; cosine rule c² = a²+b²-2ab cosC.'
  },
  igcse_math_i7: {
    enTitle: 'Circle Theorems',
    enBody: 'The angle at the centre is twice the angle at the circumference on the same arc. An angle in a semicircle is 90°. Angles on the same arc are equal. A perpendicular from the centre to a chord bisects it.'
  },
  igcse_math_i8: {
    enTitle: 'Probability',
    enBody: 'P(A) = favourable outcomes / total outcomes. Mutually exclusive events: P(A∪B) = P(A)+P(B). Independent events: P(A∩B) = P(A)×P(B). Complement: P(not A) = 1 - P(A).'
  },
  igcse_phy_i1: {
    enTitle: 'Kinematics Equations',
    enBody: 'v = u + at, s = ut + ½at², v² = u² + 2as. For uniform motion v = s/t. Acceleration a = Δv/t. Units: metres, seconds, metres per second.'
  },
  igcse_phy_i2: {
    enTitle: 'Forces and Newton\'s Laws',
    enBody: 'F = ma. Zero net force means uniform motion or rest (first law). Action and reaction are equal and opposite (third law). Weight W = mg. Friction opposes motion.'
  },
  igcse_phy_i3: {
    enTitle: 'Conservation of Energy',
    enBody: 'Energy is neither created nor destroyed, only converted between forms. Kinetic energy KE = ½mv², potential energy PE = mgh. Power P = work/time = E/t, in watts.'
  },
  igcse_phy_i4: {
    enTitle: 'Basic Electricity',
    enBody: 'Ohm\'s law: V = IR. In series, current is the same and voltage divides; in parallel, voltage is the same and current divides. Power P = VI = I²R = V²/R.'
  },
  alevel_math_i1: {
    enTitle: 'Differentiation Rules',
    enBody: 'd/dx(xⁿ) = nxⁿ⁻¹. Chain rule: (f∘g)\' = f\'(g)g\'. Product rule: (uv)\' = u\'v + uv\'. Quotient rule: (u/v)\' = (u\'v - uv\')/v².'
  },
  alevel_math_i2: {
    enTitle: 'Integration Techniques',
    enBody: '∫xⁿdx = xⁿ⁺¹/(n+1) + C. Substitution (u-substitution); integration by parts ∫u dv = uv - ∫v du, choosing u by LIATE. A definite integral gives area.'
  },
  alevel_math_i3: {
    enTitle: 'Differential Equations',
    enBody: 'dy/dx = f(x,y). Separable: rearrange to dy/g(y) = f(x)dx and integrate both sides. The solution contains an arbitrary constant C, fixed by an initial value. First-order linear equations use the integrating factor e^∫P dx.'
  },
  alevel_math_i4: {
    enTitle: 'Complex Numbers and Polar Form',
    enBody: 'z = a+bi has modulus r = |z| = √(a²+b²) and argument θ = arg z. Polar form: z = r(cosθ + i sinθ) = re^{iθ}. De Moivre\'s theorem: (re^{iθ})ⁿ = rⁿe^{inθ}.'
  },
  alevel_phy_i1: {
    enTitle: 'Mechanics and Rotation',
    enBody: 'Torque τ = Fr sinθ. Moment of inertia I = Σmr². Angular acceleration α. Rotational analogue of F = ma: τ = Iα.'
  },
  alevel_phy_i2: {
    enTitle: 'Electromagnetic Fields',
    enBody: 'Lorentz force F = qv×B. A charge in a magnetic field moves in a circle of radius r = mv/qB. Magnetic flux Φ = BA cosθ. Faraday\'s law: ε = -dΦ/dt.'
  },
  alevel_phy_i3: {
    enTitle: 'Quantum Physics',
    enBody: 'Photon energy E = hf = hc/λ. The photoelectric effect has a threshold frequency. De Broglie wavelength λ = h/p. A transition between energy levels releases a photon hf = E₂ - E₁.'
  },
  alevel_phy_i4: {
    enTitle: 'Nuclear Physics',
    enBody: 'Alpha decay emits a helium nucleus; beta decay converts a neutron to a proton and emits an electron. Half-life T½. Binding energy is the energy needed to split a nucleus — the larger, the more stable. Mass defect: ΔE = Δmc².'
  },
  ib_math_i1: {
    enTitle: 'Vectors and Geometry',
    enBody: 'The dot product a·b = |a||b|cosθ tests perpendicularity (= 0) and finds angles. The magnitude of the cross product = |a||b|sinθ, the parallelogram area. A line has vector equation r = a + tb.'
  },
  ib_math_i2: {
    enTitle: 'Matrices and Transformations',
    enBody: 'Matrix multiplication is not commutative. The determinant measures area scaling; for 2×2, det = ad-bc. An inverse exists iff det ≠ 0. Rotations, scalings, and reflections correspond to specific matrices.'
  },
  ib_math_i3: {
    enTitle: 'Advanced Calculus',
    enBody: 'For implicit differentiation, differentiate both sides with respect to x and keep y\'. For parametric equations, dy/dx = (dy/dt)/(dx/dt). Taylor: f(a+h) = f(a) + hf\' + h²/2 f\'\' + ...'
  },
  ib_math_i4: {
    enTitle: 'Probability Distributions',
    enBody: 'Binomial X~B(n,p) has mean np and variance np(1-p). Poisson X~Po(λ) has mean = variance = λ. Normal: standardize with Z = (X-μ)/σ.'
  },
  ib_phy_i1: {
    enTitle: 'Measurement and Uncertainty',
    enBody: 'Absolute uncertainty ±δ, relative uncertainty = δ/value, percentage = relative × 100%. Repeated measurements reduce random error. Systematic error is a fixed bias. Significant figures follow the least precise datum.'
  },
  ib_phy_i2: {
    enTitle: 'Thermodynamics',
    enBody: 'First law ΔU = Q - W (heat in raises internal energy; work out lowers it). Ideal gas PV = nRT. Isothermal process: ΔU = 0 so Q = W. Entropy never decreases in an isolated system.'
  },
  ib_phy_i3: {
    enTitle: 'Waves and Interference',
    enBody: 'Constructive interference: path difference = nλ; destructive = (n+½)λ. Standing waves have nodes spaced λ/2 apart. Doppler shift: approaching source raises frequency. Refraction: n₁sinθ₁ = n₂sinθ₂.'
  },
  ib_phy_i4: {
    enTitle: 'Introduction to Relativity',
    enBody: 'The speed of light is invariant. Time dilation Δt = γΔt₀, length contraction L = L₀/γ, with γ = 1/√(1-v²/c²). Mass-energy E = mc²; total energy E = γmc².'
  },
  toefl_b1_i1: {
    enTitle: 'Main Idea Questions: Catch the Opening',
    enBody: 'The first sentence of a TOEFL lecture is usually the main idea. Professors often say "Today I want to talk about..." or "Let\'s begin with...", and what follows is the answer to the gist question. Practise noting the first sentence.'
  },
  toefl_b1_i2: {
    enTitle: 'Listening Connectives: Signals Are Answers',
    enBody: 'Content after "but / however / in contrast / on the other hand" is almost always tested. Test writers place answers after contrast markers — mark them immediately. Similarly, "first / second / finally" signal parallel structure, often matching table questions.'
  },
  toefl_b1_i3: {
    enTitle: 'Factual Information: Keyword Scanning',
    enBody: 'For factual information questions, take a proper noun or number from the question to locate the passage. The answer is usually a paraphrase rather than a verbatim match. If you cannot find the anchor, do not force an answer.'
  },
  toefl_b1_i4: {
    enTitle: 'Speaking Task 1: The 15-Second Plan',
    enBody: 'Independent speaking Task 1 gives only 15 seconds to prepare. Use a template: state your opinion ("I think...") + one reason + one specific example. Prefer simple, complete speech over complex sentences that cause hesitation.'
  },
  ielts_listening_i2: {
    enTitle: 'Form Completion: Predict Part of Speech',
    enBody: 'Before the audio, read the question and predict whether the blank needs a noun, a number, or an adjective, and whether it is countable. If you miss the plural "s" in the recording, use grammar to decide — omitting "s" is marked wrong.'
  },
  ielts_listening_i3: {
    enTitle: 'Map Questions: Direction Words',
    enBody: 'High-frequency map words: opposite, next to, at the end of, behind, between A and B. As soon as you hear a direction word, mark the position on the map; do not wait until the audio ends.'
  },
  ielts_listening_i4: {
    enTitle: 'Multiple Choice: Answers Are Spread Out',
    enBody: 'In IELTS multiple choice, correct answers are usually scattered across the recording, not grouped together. So select an answer as soon as you hear it rather than waiting for all options to be covered, or you will miss later ones.'
  },
  ielts_speaking_i1: {
    enTitle: 'Part 1: Always Give at Least 3 Sentences',
    enBody: 'The most common Part 1 mistake is answering only Yes/No. If asked "Do you like reading?", give opinion + reason + extra detail. Example: "Yes, I do, because it helps me relax. I usually read before bed, especially fiction." Aim for 15-20 seconds.'
  },
  ielts_speaking_i2: {
    enTitle: 'Part 2: Note Only Keywords',
    enBody: 'Do not write full sentences or memorise. One minute is only enough for cues: who, when, where, what you did, how you felt. Write 2-3 words per point and expand naturally as you speak.'
  },
  ielts_speaking_i3: {
    enTitle: 'Part 3: Point + Explanation + Example',
    enBody: 'Part 3 tests abstract discussion. Use the PEE structure: Point → Explanation → Example. When pressed, adjust your view and buy time with "That\'s interesting, I haven\'t thought about it that way..."'
  },
  ielts_speaking_i4: {
    enTitle: 'Fluency: Prefer Simple Words Over Hesitation',
    enBody: 'Fluency and Coherence carry the most weight in speaking. Rather than straining for an advanced word, use familiar words to speak smoothly. If a word escapes you, bridge with "It\'s a kind of..." or "You know..." to avoid long pauses.'
  },
  ielts_reading_i1: {
    enTitle: 'Headings: First and Last Sentence Method',
    enBody: 'For List of Headings, read the first and last sentence of each paragraph to summarise the topic. When one heading fits several paragraphs, distinguish them by transition words and repeated nouns. Do not read the options first — it wastes time.'
  },
  ielts_reading_i2: {
    enTitle: 'True/False/Not Given: Avoid Inference',
    enBody: 'The core of T/F/NG is strict reliance on the text. False means the passage explicitly contradicts; Not Given means the passage does not mention it or it cannot be inferred. Many test-takers mark Not Given as False because common sense says "wrong".'
  },
  ielts_reading_i3: {
    enTitle: 'Gap-Fill: Paraphrasing Is the Key',
    enBody: 'IELTS gap-fill rarely copies the passage verbatim — answers are paraphrased. For example "expensive" becomes "costly", "rise" becomes "increase". First locate the original sentence, then find the word that matches the question context.'
  },
  ielts_reading_i4: {
    enTitle: 'Heading Matching: Watch the NB Note',
    enBody: 'If the instructions say "NB You may use any heading more than once", at least one heading is used twice. Do not cross out headings you have already used; instead, watch which headings look like surplus items.'
  },
  ielts_writing_i1: {
    enTitle: 'Task 1: Describe Objective Data Only',
    enBody: 'Task 1 is data reporting, not an argumentative essay. Do not write "I think the reason is...". Structure: paraphrase the question, select the main trends, add detail, then compare. Match tense to the chart\'s years (past or present).'
  },
  ielts_writing_i2: {
    enTitle: 'Task 2: The Four-Paragraph Structure',
    enBody: 'Use four paragraphs: Introduction (paraphrase + stance); Body 1 (first argument); Body 2 (second argument, possibly a concession); Conclusion (summary). Open each paragraph with a topic sentence and support it with examples or cause-effect.'
  },
  ielts_writing_i3: {
    enTitle: 'Cohesion: Pronouns with Connectives',
    enBody: 'Coherence and Cohesion require natural links between sentences. Use this / these / such to refer back, and however / therefore / for example to signal logic — but do not start every sentence with a connective, or it feels mechanical.'
  },
  ielts_writing_i4: {
    enTitle: 'Grammatical Range: Using Clauses Correctly',
    enBody: 'For a 7+, show complex structures: relative clauses, adverbial clauses, subjunctive. But accuracy comes first. One correct "If I were you, I would agree" beats three broken long sentences. Check subject-verb agreement and tense when you finish.'
  }
};

// 应用补全
let filledEnTitle = 0, filledEnBody = 0, fixedBody = 0;
const updated = d.knowledge.map(k => {
  const e = EN[k.id];
  if (!e) return k;
  const out = Object.assign({}, k);
  if (e.enTitle) { out.enTitle = e.enTitle; filledEnTitle++; }
  if (e.enBody) { out.enBody = e.enBody; filledEnBody++; }
  if (e.body) { out.body = e.body; fixedBody++; }
  return out;
});

// 重写文件（保持结构不变，只改 knowledge 数组内容）
const fs2 = require('fs');
const DATA = fs2.readFileSync(DATA_FILE, 'utf8');

// 直接重新生成整个文件（沿用 fix 脚本产出的格式）
const courses = d.courses;
const chapters = d.chapters;
const systems = d.systems;

const header = `/**
 * 课程知识点数据全集（对象版）
 * knowledge: ${updated.length}条知识点 | courses: ${courses.length}门 | chapters: ${chapters.length}章
 * course.js 读 courses/chapters，teach.js 读 knowledge
 *
 * 数据一致性（由 _test/check-data.js 校验）：
 *   - 每个 knowledge.courseId 必须存在于 courses
 *   - 每个 knowledge.chapterId 必须存在于 chapters
 *   - 每个 chapters[].items[].id 必须能在 knowledge 里找到
 *   - 每个 course 至少有一个知识点
 */
`;

const body = [
  `const knowledge = ${JSON.stringify(updated, null, 2)};`,
  '',
  `const courses = ${JSON.stringify(courses, null, 2)};`,
  '',
  `const chapters = ${JSON.stringify(chapters, null, 2)};`,
  '',
  `const systems = ${JSON.stringify(systems, null, 2)};`,
  '',
  'module.exports = { courses, chapters, knowledge, systems };',
  ''
].join('\n');

fs2.writeFileSync(DATA_FILE, header + '\n' + body, 'utf8');

console.log('=== 双语补全完成 ===');
console.log('补 enTitle:', filledEnTitle, '/', updated.length);
console.log('补 enBody:', filledEnBody, '/', updated.length);
console.log('修复正文:', fixedBody, '条');
console.log('未覆盖的知识点 id:', updated.filter(k => !EN[k.id]).map(k => k.id).join(', ') || '无');
