// ==================== 职业技能理论刷题 App ====================

const FALLBACK_CATALOG = {
  schemaVersion: '1.0',
  banks: [
    { id: 'caqi-intermediate', title: '采气工-中级工理论', file: 'banks/caqi-intermediate.v1.json', version: 1 },
    { id: 'shuqigong-junior', title: '输气工-初级工理论', file: 'banks/shuqigong-junior.v1.json', version: 1 },
    { id: 'shuqigong-intermediate', title: '输气工-中级工理论', file: 'banks/shuqigong-intermediate.v1.json', version: 1 },
    { id: 'shuqigong-senior', title: '输气工-高级工理论', file: 'banks/shuqigong-senior.v1.json', version: 1 },
  ],
};
const APP_CACHE_NAME = 'theory-practice-v6';

// ========== GLOBAL STATE ==========
const APP = {
  catalog: FALLBACK_CATALOG,
  activeBank: null,
  questions: [],           // All questions from JSON
  currentMode: 'home',     // 'home' | 'practice' | 'exam' | 'section'
  currentList: [],         // Current question list (filtered)
  currentIndex: 0,         // Current question index
  userAnswers: {},         // { questionId: 'A' } for current session
  examConfig: { type: 'single', count: 20, timeLimit: 30 },
  examTimer: null,
  examTimeLeft: 0,
  wrongQuestions: new Set(), // Set of question IDs
  stats: {},               // { [questionId]: { correct: bool, timestamp } }
  selectedSection: '',     // Selected knowledge section
  aiKey: '',               // DeepSeek API key
  aiCache: {},            // { [questionId]: answerText } cached AI results
  examHistory: [],         // [{ timestamp, type, total, correct, details }]
  pendingMulti: [],
};

// ========== DOM REFS ==========
const $ = (id) => document.getElementById(id);

// ========== INIT ==========
async function init() {
  APP.aiKey = localStorage.getItem('caifu_api_key') || '';
  await loadCatalog();
  const savedBankId = localStorage.getItem('caifu_active_bank') || FALLBACK_CATALOG.banks[0].id;
  const selectedBank = APP.catalog.banks.find(bank => bank.id === savedBankId) || APP.catalog.banks[0];
  await loadBank(selectedBank, false);
  updateHomeStats();
  switchTab('home');
  updateSettingsInfo();
  $('loadingView').style.display = 'none';
}

async function loadCatalog() {
  try {
    const res = await fetch('catalog.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const catalog = await res.json();
    if (!catalog || !Array.isArray(catalog.banks) || catalog.banks.length === 0) {
      throw new Error('题库目录格式无效');
    }
    APP.catalog = catalog;
  } catch (e) {
    console.warn('Using fallback catalog:', e);
    APP.catalog = FALLBACK_CATALOG;
  }
}

function bankStorageKey(name) {
  return `caifu_bank_${APP.activeBank?.id || 'default'}_${name}`;
}

function normalizeBank(data, bank) {
  if (!data || !Array.isArray(data.questions)) throw new Error('题库中没有有效的 questions 数组');
  const supported = new Set(['single', 'multiple', 'judge']);
  const questions = data.questions.filter(q => supported.has(q.type)).map((q, index) => ({
    ...q,
    id: String(q.id ?? `${bank.id}-${index + 1}`),
    options: Array.isArray(q.options) ? q.options : [],
    answer: q.type === 'multiple'
      ? [...new Set(Array.isArray(q.answer) ? q.answer : String(q.answer || '').split(''))].sort()
      : String(q.answer || ''),
  }));
  if (questions.length === 0) throw new Error('题库中没有可练习的客观题');
  return { ...data, questions };
}

async function loadBank(bank, showLoading = true) {
  if (!bank) return;
  if (showLoading) {
    $('loadingView').style.display = 'flex';
    $('loadingView').innerHTML = '<div class="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mb-4"></div><p class="text-gray-500">加载题库中...</p>';
  }
  try {
    const res = await fetch(bank.file);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if ('caches' in window) {
      caches.open(APP_CACHE_NAME).then(cache => cache.put(bank.file, res.clone())).catch(() => {});
    }
    const data = normalizeBank(await res.json(), bank);
    if ('caches' in window) {
      const mediaFiles = [...new Set(data.questions.flatMap(q => Array.isArray(q.media) ? q.media : []))];
      if (mediaFiles.length) {
        caches.open(APP_CACHE_NAME).then(cache => cache.addAll(mediaFiles)).catch(() => {});
      }
    }
    APP.activeBank = { ...bank, source: data.source || '' };
    APP.questions = data.questions;
    localStorage.setItem('caifu_active_bank', bank.id);
    loadState();
    renderBankShelf();
    updateHomeStats();
    updateSettingsInfo();
    $('loadingView').style.display = 'none';
    console.log(`Loaded ${APP.questions.length} questions from ${bank.id}`);
  } catch (e) {
    console.error('Failed to load bank:', e);
    $('loadingView').innerHTML = `<p class="text-danger text-center py-20">题库加载失败</p>
      <p class="text-gray-400 text-sm text-center">${escapeHtml(e.message)}</p>
      <button onclick="location.reload()" class="mt-4 px-4 py-2 bg-primary text-white rounded-xl">重试</button>`;
  }
}

async function selectBank(bankId) {
  if (APP.activeBank?.id === bankId) return;
  const bank = APP.catalog.banks.find(item => item.id === bankId);
  if (!bank) return;
  await loadBank(bank);
  switchTab('home');
}

function renderBankShelf() {
  const shelf = $('bankShelf');
  if (!shelf) return;
  shelf.innerHTML = APP.catalog.banks.map(bank => {
    const active = bank.id === APP.activeBank?.id;
    return `<button onclick="selectBank('${escapeHtml(bank.id)}')" class="w-full text-left p-3 rounded-xl border ${active ? 'border-primary bg-blue-50' : 'border-gray-200 bg-white'}">
      <div class="flex items-center gap-2"><span>${active ? '📖' : '📘'}</span><span class="font-medium text-sm flex-1">${escapeHtml(bank.title)}</span>${active ? '<span class="text-xs text-primary">当前</span>' : ''}</div>
    </button>`;
  }).join('');
  $('activeBankTitle').textContent = APP.activeBank?.title || '请选择题库';
}

// ========== TAB NAVIGATION ==========
function switchTab(tab) {
  // Update tab bar
  document.querySelectorAll('[data-tab]').forEach(btn => {
    if (btn.dataset.tab === tab) {
      btn.classList.add('text-primary');
      btn.classList.remove('text-gray-400');
    } else {
      btn.classList.remove('text-primary');
      btn.classList.add('text-gray-400');
    }
  });

  // Hide all views
  document.querySelectorAll('.page-view').forEach(v => v.classList.remove('active'));

  // Show relevant view
  // Hide detail views
  $('historyDetailView').classList.add('hidden');
  $('historyDetailView').classList.remove('active');

  const viewMap = { home: 'homeView', stats: 'statsView', history: 'historyView', wrong: 'wrongView', settings: 'settingsView' };
  const viewId = viewMap[tab];
  if (viewId) {
    $(viewId).classList.add('active');
    APP.currentMode = 'home';
    if (APP.examTimer) { clearInterval(APP.examTimer); APP.examTimer = null; }
  }

  const titles = { home: APP.activeBank?.title || '理论刷题', stats: '学习统计', history: '考试记录', wrong: '错题集', settings: '设置' };
  $('headerTitle').textContent = titles[tab] || APP.activeBank?.title || '理论刷题';
  $('headerBackBtn').classList.add('hidden');
  $('headerBadge').textContent = '';

  // Update content
  if (tab === 'home') updateHomeStats();
  if (tab === 'stats') renderStats();
  if (tab === 'history') renderHistory();
  if (tab === 'wrong') renderWrongList();

  // If in practice/exam view, clear it
  $('practiceView').classList.remove('active');
}

function updateHomeStats() {
  const total = APP.questions.length;
  const answered = Object.keys(APP.stats).length;
  const correct = Object.values(APP.stats).filter(s => s.correct).length;
  $('homeTotalQ').textContent = total;
  $('homeSolved').textContent = answered;
  $('homeAccuracy').textContent = answered > 0 ? Math.round(correct / answered * 100) + '%' : '-';
  $('homeWrong').textContent = APP.wrongQuestions.size;
}

// ========== PRACTICE MODE ==========
function startFreePractice() {
  APP.currentMode = 'practice';

  // Restore saved practice state if available
  const saved = localStorage.getItem(bankStorageKey('practice_state'));
  if (saved) {
    try {
      const state = JSON.parse(saved);
      if (state && state.questionIds && state.questionIds.length > 0) {
        // Validate question IDs still exist
        const validIds = state.questionIds.map(String).filter(id => APP.questions.some(q => String(q.id) === id));
        if (validIds.length > 0) {
          APP.currentList = validIds.map(id => APP.questions.find(q => String(q.id) === id)).filter(Boolean);
          APP.currentIndex = Math.min(state.currentIndex || 0, APP.currentList.length - 1);
          APP.userAnswers = state.userAnswers || {};
          showPracticeView('自由练习');
          renderNavigator();
          renderQuestion();
          setTimeout(restoreAnswerState, 50);
          return;
        }
      }
    } catch (e) { /* ignore corrupt state */ }
  }

  // Fresh start
  APP.currentList = shuffleArray([...APP.questions]);
  APP.currentIndex = 0;
  APP.userAnswers = {};
  showPracticeView('自由练习');
  renderNavigator();
  renderQuestion();
}

function showPracticeView(title) {
  document.querySelectorAll('.page-view').forEach(v => v.classList.remove('active'));
  $('practiceView').classList.add('active');
  $('headerTitle').textContent = title;
  $('headerBackBtn').classList.remove('hidden');
  $('headerBackBtn').onclick = () => { stopPractice(); switchTab('home'); };
  $('examSubmitBtn').classList.add('hidden');
  $('examResult').classList.add('hidden');
  $('examResult').innerHTML = '';
  $('pracTimer').classList.add('hidden');
  if (APP.examTimer) { clearInterval(APP.examTimer); APP.examTimer = null; }
}

function renderNavigator() {
  const container = $('pracNavContainer');
  const nav = $('pracNavigator');
  if (APP.currentMode !== 'practice') {
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');
  const total = APP.currentList.length;
  const current = APP.currentIndex;
  const answered = Object.keys(APP.userAnswers).length;
  $('pracNavCount').textContent = `${answered}/${total}`;

  // Determine columns: 10 for wide, 8 for narrow screens
  const cols = window.innerWidth >= 420 ? 10 : window.innerWidth >= 360 ? 8 : 6;

  let html = `<div class="grid gap-1" style="grid-template-columns:repeat(${cols},1fr)">`;
  for (let i = 0; i < total; i++) {
    const q = APP.currentList[i];
    let cls = 'flex items-center justify-center rounded-lg text-xs font-medium py-1.5 cursor-pointer active:opacity-80 transition-all select-none';
    const ans = APP.userAnswers[q.id] !== undefined;
    if (i === current) {
      cls += ' bg-primary text-white shadow-sm font-bold';
    } else if (ans) {
      cls += answersEqual(APP.userAnswers[q.id], q.answer) ? ' bg-green-100 text-green-700' : ' bg-red-100 text-red-700';
    } else {
      cls += ' bg-gray-100 text-gray-500';
    }
    html += `<button onclick="goToQuestion(${i})" class="${cls}">${i + 1}</button>`;
  }
  html += '</div>';
  nav.innerHTML = html;

  // Scroll the current question into view
  const btns = nav.querySelectorAll('button');
  if (btns[current]) {
    btns[current].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function toggleNavigator() {
  const nav = $('pracNavigator');
  const icon = $('pracNavIcon');
  const label = $('pracNavLabel');
  const isOpen = !nav.classList.contains('hidden');
  nav.classList.toggle('hidden');
  icon.textContent = isOpen ? '▶' : '▼';
  label.textContent = isOpen ? '显示题号' : '隐藏题号';
}

function goToQuestion(index) {
  if (index < 0 || index >= APP.currentList.length) return;
  APP.currentIndex = index;
  renderNavigator();
  renderQuestion();
  setTimeout(restoreAnswerState, 50);
}

function savePracticeState() {
  if (APP.currentMode !== 'practice') return;
  try {
    const state = {
      questionIds: APP.currentList.map(q => q.id),
      currentIndex: APP.currentIndex,
      userAnswers: APP.userAnswers,
    };
    localStorage.setItem(bankStorageKey('practice_state'), JSON.stringify(state));
  } catch (e) { /* ignore quota exceeded */ }
}

function stopPractice() {
  APP.currentMode = 'home';
  APP.currentList = [];
  APP.currentIndex = 0;
  APP.userAnswers = {};
  $('pracNavContainer').classList.add('hidden');
  $('pracNavigator').innerHTML = '';
}

function renderQuestion() {
  if (APP.currentIndex >= APP.currentList.length) {
    finishPractice();
    return;
  }

  const q = APP.currentList[APP.currentIndex];
  const total = APP.currentList.length;

  // Progress
  $('pracProgress').textContent = `${APP.currentIndex + 1} / ${total}`;
  $('pracProgressBar').style.width = ((APP.currentIndex + 1) / total * 100) + '%';
  $('pracQuestionCard').classList.remove('fade-in');
  void $('pracQuestionCard').offsetWidth; // trigger reflow
  $('pracQuestionCard').classList.add('fade-in');

  // Update navigator highlight
  renderNavigator();

  // Type badge
  $('pracQType').style.display = 'inline-block';
  const typeInfo = questionTypeInfo(q.type);
  $('pracQType').textContent = typeInfo.label;
  $('pracQType').className = `inline-block text-xs px-2 py-0.5 rounded-full mb-2 ${typeInfo.className}`;

  // Question text
  $('pracQuestion').textContent = q.question;
  const mediaDiv = $('pracMedia');
  const media = Array.isArray(q.media) ? q.media : [];
  mediaDiv.classList.toggle('hidden', media.length === 0);
  mediaDiv.innerHTML = media.map((src, index) =>
    `<img src="${escapeHtml(src)}" alt="题目图片${index + 1}" class="w-full h-auto rounded-lg border border-gray-200" loading="lazy">`
  ).join('');

  // Options
  const optsDiv = $('pracOptions');
  optsDiv.innerHTML = '';
  const labels = optionLabels(q);
  const optionValues = q.options;

  for (let i = 0; i < optionValues.length; i++) {
    const opt = optionValues[i];
    const label = labels[i];
    const btn = document.createElement('button');
    btn.className = 'option-btn w-full text-left py-3 px-4 border border-gray-300 rounded-xl text-sm flex items-start gap-2';
    btn.innerHTML = `<span class="font-semibold text-gray-500 shrink-0">${label}.</span><span>${opt}</span>`;
    btn.onclick = () => selectOption(q.id, label, btn);
    optsDiv.appendChild(btn);
  }

  // Hide feedback
  $('pracFeedback').classList.add('hidden');
  $('multiConfirmBtn').classList.add('hidden');
  APP.pendingMulti = [];

  // Navigation buttons
  $('pracPrevBtn').classList.toggle('hidden', APP.currentIndex === 0);

  // In exam mode, allow free navigation (skip questions)
  // In practice mode, force user to answer before proceeding
  if (APP.currentMode === 'exam') {
    $('pracNextBtn').classList.toggle('hidden', APP.currentIndex + 1 >= total);
    $('pracPrevBtn').classList.toggle('hidden', APP.currentIndex === 0);
  } else {
    $('pracNextBtn').classList.add('hidden'); // Show only after answering
  }

  // Show action buttons
  $('pracActions').classList.remove('hidden');
  if (APP.currentMode === 'exam') {
    $('examSubmitBtn').classList.remove('hidden');
  } else {
    $('examSubmitBtn').classList.add('hidden');
  }
}

function selectOption(questionId, selectedLabel, clickedBtn) {
  const q = APP.currentList[APP.currentIndex];
  if (!q) return;

  if (q.type === 'multiple') {
    if (APP.currentMode !== 'exam' && APP.userAnswers[questionId] !== undefined) return;
    const selected = APP.currentMode === 'exam'
      ? [...(Array.isArray(APP.userAnswers[questionId]) ? APP.userAnswers[questionId] : [])]
      : [...APP.pendingMulti];
    const position = selected.indexOf(selectedLabel);
    if (position >= 0) selected.splice(position, 1);
    else selected.push(selectedLabel);
    selected.sort();
    clickedBtn.classList.toggle('border-primary', position < 0);
    clickedBtn.classList.toggle('bg-blue-50', position < 0);
    if (APP.currentMode === 'exam') {
      if (selected.length) APP.userAnswers[questionId] = selected;
      else delete APP.userAnswers[questionId];
    } else {
      APP.pendingMulti = selected;
      $('multiConfirmBtn').classList.toggle('hidden', selected.length === 0);
    }
    renderNavigator();
    return;
  }

  if (APP.currentMode === 'exam') {
    APP.userAnswers[questionId] = selectedLabel;
    $('pracOptions').querySelectorAll('button').forEach(btn => {
      btn.classList.remove('border-primary', 'bg-blue-50');
    });
    clickedBtn.classList.add('border-primary', 'bg-blue-50');
    renderNavigator();
    return;
  }

  if (APP.userAnswers[questionId] !== undefined) return;
  finalizePracticeAnswer(q, selectedLabel);
}

function confirmMultipleAnswer() {
  const q = APP.currentList[APP.currentIndex];
  if (!q || q.type !== 'multiple' || APP.pendingMulti.length === 0) return;
  finalizePracticeAnswer(q, [...APP.pendingMulti]);
}

function finalizePracticeAnswer(q, selectedAnswer) {
  const questionId = q.id;
  APP.userAnswers[questionId] = selectedAnswer;
  const correct = answersEqual(selectedAnswer, q.answer);

  // Update stats
  APP.stats[questionId] = { correct, answer: selectedAnswer, timestamp: Date.now() };

  // For practice/section mode, update wrong set immediately
  // For exam mode, defer until submission
  if (APP.currentMode !== 'exam') {
    if (correct) {
      APP.wrongQuestions.delete(questionId);
    } else {
      APP.wrongQuestions.add(questionId);
    }
    saveState();
  }

  // Visual feedback
  const allBtns = $('pracOptions').querySelectorAll('button');
  const labels = optionLabels(q);
  const selectedLabels = answerArray(selectedAnswer);
  const correctLabels = answerArray(q.answer);

  allBtns.forEach((btn, i) => {
    btn.disabled = true;
    if (correctLabels.includes(labels[i])) {
      btn.classList.add('correct');
    } else if (selectedLabels.includes(labels[i]) && !correct) {
      btn.classList.add('wrong');
    } else {
      btn.classList.add('revealed');
      btn.style.opacity = '0.6';
    }
  });

  // Show feedback
  const fb = $('pracFeedback');
  fb.classList.remove('hidden');
  if (correct) {
    fb.innerHTML = '<div class="text-success font-medium text-sm">✅ 回答正确！</div>';
  } else {
    fb.innerHTML = `<div class="text-danger font-medium text-sm">❌ 回答错误</div><div class="text-gray-500 text-xs mt-1">正确答案：${formatAnswer(q.answer)}</div>`;
    // Show explanation for judge questions
    if (q.type === 'judge' && q.explanation) {
      fb.innerHTML += `<div class="text-gray-500 text-xs mt-1">解析：${q.explanation}</div>`;
    }
  }

  // Show next button
  $('pracNextBtn').classList.remove('hidden');
  $('multiConfirmBtn').classList.add('hidden');

  saveState();
  savePracticeState();
  updateHomeStats();
}

function nextQuestion() {
  APP.currentIndex++;
  if (APP.currentIndex >= APP.currentList.length) {
    if (APP.currentMode === 'exam') {
      submitExam();
    } else {
      finishPractice();
    }
  } else {
    renderQuestion();
    setTimeout(restoreAnswerState, 50);
    savePracticeState();
  }
}

function prevQuestion() {
  if (APP.currentIndex > 0) {
    APP.currentIndex--;
    renderQuestion();
    setTimeout(restoreAnswerState, 50);
  }
}

function restoreAnswerState() {
  const q = APP.currentList[APP.currentIndex];
  if (!q) return;
  const prevAnswer = APP.userAnswers[q.id];
  if (prevAnswer !== undefined) {
    const labels = optionLabels(q);
    const allBtns = $('pracOptions').querySelectorAll('button');
    if (APP.currentMode === 'exam') {
      const selected = answerArray(prevAnswer);
      allBtns.forEach((btn, i) => {
        if (selected.includes(labels[i])) btn.classList.add('border-primary', 'bg-blue-50');
      });
      return;
    }
    const correct = answersEqual(prevAnswer, q.answer);
    const selected = answerArray(prevAnswer);
    const expected = answerArray(q.answer);
    allBtns.forEach((btn, i) => {
      btn.disabled = true;
      if (expected.includes(labels[i])) btn.classList.add('correct');
      else if (selected.includes(labels[i]) && !correct) btn.classList.add('wrong');
      else { btn.classList.add('revealed'); btn.style.opacity = '0.6'; }
    });
    // Show feedback
    const fb = $('pracFeedback');
    fb.classList.remove('hidden');
    if (correct) {
      fb.innerHTML = '<div class="text-success font-medium text-sm">✅ 回答正确！</div>';
    } else {
      fb.innerHTML = `<div class="text-danger font-medium text-sm">❌ 回答错误</div><div class="text-gray-500 text-xs mt-1">正确答案：${formatAnswer(q.answer)}</div>`;
      if (q.type === 'judge' && q.explanation) {
        fb.innerHTML += `<div class="text-gray-500 text-xs mt-1">解析：${q.explanation}</div>`;
      }
    }
    $('pracNextBtn').classList.remove('hidden');
  }
}

function finishPractice() {
  const total = APP.currentList.length;
  const correct = APP.currentList.filter(q => answersEqual(APP.userAnswers[q.id], q.answer)).length;
  const allAnswered = APP.currentList.every(q => APP.userAnswers[q.id] !== undefined);

  if (APP.currentMode === 'practice') {
    if (allAnswered) {
      // All questions answered → full reset to round 1
      APP.currentIndex = 0;
      APP.userAnswers = {};
      const card = $('pracQuestionCard');
      card.style.opacity = '0.5';
      setTimeout(() => { card.style.opacity = '1'; }, 300);
    } else {
      // Still unanswered → jump to first unanswered question
      APP.currentIndex = APP.currentList.findIndex(q => APP.userAnswers[q.id] === undefined);
      if (APP.currentIndex < 0) APP.currentIndex = 0;
    }
    renderNavigator();
    renderQuestion();
    savePracticeState();
    saveState();
    updateHomeStats();
    return;
  }

  // Exam mode: show summary
  $('pracQType').style.display = 'none';
  $('pracQuestion').innerHTML = `
    <div class="text-center py-8">
      <div class="text-4xl mb-3">${correct === total ? '🎉' : '📝'}</div>
      <p class="text-lg font-semibold">考试结束</p>
      <p class="text-sm text-gray-500 mt-1">答对 ${correct} / ${total} 题</p>
      <p class="text-xl font-bold text-primary mt-2">${total > 0 ? Math.round(correct / total * 100) : 0}%</p>
    </div>`;
  $('pracOptions').innerHTML = '';
  $('pracFeedback').classList.add('hidden');
  $('pracNextBtn').classList.add('hidden');
  $('pracPrevBtn').classList.add('hidden');
  $('pracProgress').textContent = '';
  $('pracNavContainer').classList.add('hidden');
  $('pracNavigator').innerHTML = '';

  saveState();
  updateHomeStats();
}
function showExamConfig() {
  $('examModal').classList.add('open');
  onExamTypeChange();
}

function onExamTypeChange() {
  const type = $('examType').value;
  if (type === 'mixed') {
    $('examCountMixed').classList.remove('hidden');
    $('examCountSimple').classList.add('hidden');
  } else {
    $('examCountMixed').classList.add('hidden');
    $('examCountSimple').classList.remove('hidden');
    setExamCount(20);
    document.querySelector('[data-exam-ct="20"]').classList.add('bg-primary', 'text-white');
  }
}

function closeExamConfig() {
  $('examModal').classList.remove('open');
}

function setExamCount(n) {
  APP.examConfig.count = n;
  document.querySelectorAll('[data-exam-ct]').forEach(b => {
    if (parseInt(b.dataset.examCt) === n) {
      b.classList.add('bg-primary', 'text-white');
      b.classList.remove('border-gray-300');
    } else {
      b.classList.remove('bg-primary', 'text-white');
      b.classList.add('border-gray-300');
    }
  });
  $('examCountCustom').value = '';
}

function startExam() {
  const type = $('examType').value;
  const timeLimit = parseInt($('examTime').value) || 0;

  closeExamConfig();

  // Build question pool based on type
  let selected;
  let examTitle;

  if (type === 'mixed') {
    const singleCount = parseInt($('examSingleCount').value) || 0;
    const multipleCount = parseInt($('examMultipleCount').value) || 0;
    const judgeCount = parseInt($('examJudgeCount').value) || 0;
    const singlePool = shuffleArray([...APP.questions.filter(q => q.type === 'single')]);
    const multiplePool = shuffleArray([...APP.questions.filter(q => q.type === 'multiple')]);
    const judgePool = shuffleArray([...APP.questions.filter(q => q.type === 'judge')]);
    selected = [
      ...singlePool.slice(0, Math.min(singleCount, singlePool.length)),
      ...multiplePool.slice(0, Math.min(multipleCount, multiplePool.length)),
      ...judgePool.slice(0, Math.min(judgeCount, judgePool.length)),
    ];
    // Shuffle the mixed set
    selected = shuffleArray(selected);
    examTitle = `模拟考试 · 单选${singleCount}+多选${multipleCount}+判断${judgeCount}`;
  } else {
    const customCount = parseInt($('examCountCustom').value);
    const count = customCount > 0 ? customCount : APP.examConfig.count;
    const pool = APP.questions.filter(q => q.type === type);
    if (pool.length === 0) {
      alert('没有该类型的题目');
      return;
    }
    selected = shuffleArray([...pool]).slice(0, Math.min(count, pool.length));
    examTitle = `模拟考试 · ${questionTypeInfo(type).label}`;
  }

  if (selected.length === 0) {
    alert('请设置至少一项题量大于 0');
    return;
  }

  APP.currentMode = 'exam';
  APP.currentList = selected;
  APP.currentIndex = 0;
  APP.userAnswers = {};

  showPracticeView(examTitle);
  $('examSubmitBtn').classList.remove('hidden');
  $('examSubmitBtn').disabled = false;

  // Timer
  APP.examTimeLeft = timeLimit * 60;
  if (APP.examTimeLeft > 0) {
    $('pracTimer').classList.remove('hidden');
    updateTimerDisplay();
    if (APP.examTimer) clearInterval(APP.examTimer);
    APP.examTimer = setInterval(() => {
      APP.examTimeLeft--;
      updateTimerDisplay();
      if (APP.examTimeLeft <= 0) {
        submitExam();
      }
    }, 1000);
  }

  renderQuestion();
}

function updateTimerDisplay() {
  const mins = Math.floor(APP.examTimeLeft / 60);
  const secs = APP.examTimeLeft % 60;
  $('pracTimer').textContent = `⏱ ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  if (APP.examTimeLeft <= 300) {
    $('pracTimer').classList.add('timer-warning');
  }
}

function submitExam() {
  if (APP.examTimer) { clearInterval(APP.examTimer); APP.examTimer = null; }

  // Count stats for this exam
  const total = APP.currentList.length;
  const answered = APP.currentList.filter(q => APP.userAnswers[q.id] !== undefined).length;
  const correct = APP.currentList.filter(q => answersEqual(APP.userAnswers[q.id], q.answer)).length;
  const timeUsed = APP.examTimeLeft > 0 ? (parseInt($('examTime').value) || 0) * 60 - APP.examTimeLeft : 0;

  // Record answers and update stats/wrong set
  for (const q of APP.currentList) {
    if (APP.userAnswers[q.id] !== undefined) {
      const isCorrect = answersEqual(APP.userAnswers[q.id], q.answer);
      APP.stats[q.id] = { correct: isCorrect, answer: APP.userAnswers[q.id], timestamp: Date.now() };
      if (isCorrect) {
        APP.wrongQuestions.delete(q.id);
      } else {
        APP.wrongQuestions.add(q.id);
      }
    }
  }

  // Save to exam history
  const details = APP.currentList.map(q => ({
    id: q.id,
    code: q.code,
    type: q.type,
    question: q.question,
    options: q.options,
    correctAnswer: q.answer,
    userAnswer: APP.userAnswers[q.id] || null,
    correct: answersEqual(APP.userAnswers[q.id], q.answer),
  }));
  const historyEntry = {
    timestamp: Date.now(),
    type: $('examType').value,
    total,
    answered,
    correct,
    timeUsed,
    details,
  };
  APP.examHistory.unshift(historyEntry);
  // Keep max 50 records
  if (APP.examHistory.length > 50) APP.examHistory.length = 50;

  const percentage = total > 0 ? Math.round(correct / total * 100) : 0;
  let emoji = '🎉';
  if (percentage < 60) emoji = '😢';
  else if (percentage < 80) emoji = '📚';
  else if (percentage < 95) emoji = '👍';

  $('examResult').classList.remove('hidden');
  $('examResult').innerHTML = `
    <div class="text-3xl mb-2">${emoji}</div>
    <p class="font-semibold text-lg">考试结束</p>
    <p class="text-sm text-gray-500">已答 ${answered} / ${total} 题</p>
    <p class="text-sm text-gray-500">答对 ${correct} 题</p>
    <p class="text-xl font-bold text-primary mt-1">${percentage}%</p>
    <button onclick="switchTab('history')" class="mt-2 py-2 px-4 bg-gray-100 text-gray-600 rounded-xl text-sm">查看考试记录</button>
    <button onclick="switchTab('home')" class="mt-2 py-2 px-4 bg-primary text-white rounded-xl text-sm">返回首页</button>
  `;

  $('examSubmitBtn').classList.add('hidden');
  $('pracOptions').innerHTML = '';
  $('pracFeedback').classList.add('hidden');
  $('pracNextBtn').classList.add('hidden');
  $('pracPrevBtn').classList.add('hidden');
  $('pracTimer').classList.add('hidden');

  saveState();
  updateHomeStats();
}

// ========== SECTION PRACTICE ==========
function showSectionPicker() {
  buildSectionTree();
  $('sectionDrawer').classList.add('open');
  APP.selectedSection = '';
  $('sectionStartBtn').disabled = true;
  $('sectionStartBtn').textContent = '开始刷题（请先选择）';
  $('sectionCount').textContent = '';
}

function closeSectionDrawer() {
  $('sectionDrawer').classList.remove('open');
}

function buildSectionTree() {
  const tree = $('sectionTree');
  tree.innerHTML = '';

  // Build section map from questions
  const sectionMap = {};
  for (const q of APP.questions) {
    if (!sectionMap[q.section]) sectionMap[q.section] = { name: q.sectionName || q.section || '其他', subs: {} };
    if (!sectionMap[q.section].subs[q.code]) {
      sectionMap[q.section].subs[q.code] = { name: q.subsectionName || q.code, count: 0 };
    }
    sectionMap[q.section].subs[q.code].count++;
  }

  for (const [secCode, sec] of Object.entries(sectionMap)) {
    const sectionDiv = document.createElement('div');
    sectionDiv.className = 'mb-2';
    const header = document.createElement('button');
    header.className = 'w-full text-left py-2 px-3 rounded-lg font-medium text-sm flex items-center gap-2';
    header.innerHTML = `<span class="text-xs">▶</span><span>${sec.name}</span><span class="text-xs text-gray-400 ml-auto">${Object.values(sec.subs).reduce((a,b) => a + b.count, 0)}题</span>`;
    header.onclick = function() {
      const subsDiv = this.nextElementSibling;
      const arrow = this.querySelector('span');
      if (subsDiv.classList.contains('hidden')) {
        subsDiv.classList.remove('hidden');
        arrow.textContent = '▼';
      } else {
        subsDiv.classList.add('hidden');
        arrow.textContent = '▶';
      }
    };
    sectionDiv.appendChild(header);

    const subsDiv = document.createElement('div');
    subsDiv.className = 'hidden ml-4 space-y-1 mt-1';
    for (const [subCode, sub] of Object.entries(sec.subs)) {
      const subBtn = document.createElement('button');
      subBtn.className = 'w-full text-left py-1.5 px-3 rounded-lg text-sm hover:bg-gray-100 flex items-center gap-2';
      subBtn.innerHTML = `<span class="text-xs text-gray-400">${subCode}</span><span>${sub.name}</span><span class="text-xs text-gray-400 ml-auto">${sub.count}题</span>`;
      subBtn.onclick = () => selectSection(subCode, sub.name, subBtn);
      subsDiv.appendChild(subBtn);
    }
    sectionDiv.appendChild(subsDiv);
    tree.appendChild(sectionDiv);
  }
}

function selectSection(code, name, btn) {
  // Highlight selection
  document.querySelectorAll('#sectionTree button').forEach(b => {
    b.classList.remove('bg-primary/10', 'text-primary', 'font-semibold');
  });
  btn.classList.add('bg-primary/10', 'text-primary', 'font-semibold');

  APP.selectedSection = code;
  const count = APP.questions.filter(q => q.code === code).length;
  $('sectionStartBtn').disabled = false;
  $('sectionStartBtn').textContent = `开始刷题（${name}·${count}题）`;
  $('sectionCount').textContent = '';
}

function startSectionPractice() {
  if (!APP.selectedSection) return;
  const pool = APP.questions.filter(q => q.code === APP.selectedSection);
  if (pool.length === 0) return;

  closeSectionDrawer();
  APP.currentMode = 'section';
  APP.currentList = shuffleArray([...pool]);
  APP.currentIndex = 0;
  APP.userAnswers = {};

  const subName = pool[0].subsectionName || APP.selectedSection;
  showPracticeView(`知识点 · ${subName}`);
  renderQuestion();
}

// ========== WRONG QUESTIONS ==========
function goToWrongQuestions() {
  switchTab('wrong');
}

function renderWrongList() {
  const list = $('wrongList');
  const empty = $('wrongEmpty');
  list.innerHTML = '';

  if (APP.wrongQuestions.size === 0) {
    empty.style.display = 'block';
    list.style.display = 'none';
    $('wrongDetail').classList.add('hidden');
    return;
  }

  empty.style.display = 'none';
  list.style.display = 'block';

  const wrongIds = [...APP.wrongQuestions];
  const wrongQs = wrongIds.map(id => APP.questions.find(q => q.id === id)).filter(Boolean);

  for (const q of wrongQs) {
    const card = document.createElement('div');
    card.className = 'border border-gray-200 rounded-xl p-3 active:bg-gray-50';
    card.onclick = () => showWrongDetail(q);
    const info = questionTypeInfo(q.type);
    const typeLabel = info.shortLabel;
    const typeColor = info.className;
    card.innerHTML = `
      <div class="flex items-start gap-2">
        <span class="text-xs px-1.5 py-0.5 rounded ${typeColor} shrink-0 mt-0.5">${typeLabel}</span>
        <div class="flex-1 min-w-0">
          <p class="text-sm line-clamp-2">${q.question}</p>
          <p class="text-xs text-gray-400 mt-1">${q.code} ${q.subsectionName || ''}</p>
        </div>
        <span class="text-xs text-gray-300 shrink-0">›</span>
      </div>`;
    list.appendChild(card);
  }

  $('wrongDetail').classList.add('hidden');
}

let currentWrongQ = null;

function showWrongDetail(q) {
  currentWrongQ = q;
  $('wrongDetail').classList.remove('hidden');
  $('wrongDetailQ').textContent = q.question;

  const optsDiv = $('wrongDetailOpts');
  optsDiv.innerHTML = '';
  const labels = optionLabels(q);
  const correctLabels = answerArray(q.answer);
  for (let i = 0; i < q.options.length; i++) {
    const isCorrect = correctLabels.includes(labels[i]);
    optsDiv.innerHTML += `<div class="${isCorrect ? 'text-success font-medium' : 'text-gray-500'}">${labels[i]}. ${q.options[i]} ${isCorrect ? '✓' : ''}</div>`;
  }

  $('wrongDetailCorrect').textContent = formatAnswer(q.answer);
  const stat = APP.stats[q.id];
  $('wrongDetailYour').textContent = stat?.answer ? formatAnswer(stat.answer) : '未作答';

  $('wrongAiResult').classList.add('hidden');
  $('wrongAiResult').innerHTML = '';
  $('wrongAiLoading').classList.add('hidden');
  $('wrongAiBtn').classList.remove('hidden');

  // Scroll to detail
  $('wrongDetail').scrollIntoView({ behavior: 'smooth' });
}

async function requestAiAnalysis() {
  if (!currentWrongQ) return;

  const apiKey = APP.aiKey || $('apiKeyInput').value;

  // Check cache first
  const cached = APP.aiCache[currentWrongQ.id];
  if (cached) {
    $('wrongAiLoading').classList.add('hidden');
    $('wrongAiBtn').classList.add('hidden');
    $('wrongAiResult').classList.remove('hidden');
    $('wrongAiResult').innerHTML = `<div class="font-medium text-sm mb-1">🤖 AI 解析 <span class="text-xs text-gray-400">（已缓存）</span></div><div class="text-sm leading-relaxed">${escapeHtml(cached)}</div>`;
    return;
  }

  if (!apiKey) {
    alert('请先在设置页面填写 DeepSeek API Key');
    switchTab('settings');
    return;
  }
  // Save key from input
  if (!APP.aiKey) APP.aiKey = apiKey;

  $('wrongAiBtn').classList.add('hidden');
  $('wrongAiLoading').classList.remove('hidden');
  $('wrongAiResult').classList.add('hidden');

  try {
    const q = currentWrongQ;
    const labels = optionLabels(q);
    const correctText = answerArray(q.answer).map(letter => q.options[labels.indexOf(letter)] || letter).join('；');
    const yourAnswer = APP.stats[q.id]?.answer || '未知';

    const prompt = `你是采气工考试辅导专家。请解析以下题目：

题目：[${questionTypeInfo(q.type).label}] ${q.question}
选项：${q.options.map((o, i) => labels[i] + '. ' + o).join('；')}
正确答案：${formatAnswer(q.answer)}. ${correctText}
${q.explanation ? '题目自带解析：' + q.explanation : ''}

请用100-200字简要解析为什么正确答案是对的。`;

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: '你是采气工考试辅导专家。请用简洁清晰的中文回答，每次回复不超过200字。' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 500,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `API错误 ${response.status}`);
    }

    const data = await response.json();
    const aiText = data.choices?.[0]?.message?.content || '未获取到解析';

    // Save to cache
    APP.aiCache[currentWrongQ.id] = aiText;
    saveState();

    $('wrongAiLoading').classList.add('hidden');
    $('wrongAiResult').classList.remove('hidden');
    $('wrongAiResult').innerHTML = `<div class="font-medium text-sm mb-1">🤖 AI 解析</div><div class="text-sm leading-relaxed">${escapeHtml(aiText)}</div>`;
  } catch (e) {
    $('wrongAiLoading').classList.add('hidden');
    $('wrongAiResult').classList.remove('hidden');
    $('wrongAiResult').innerHTML = `<div class="text-danger text-sm">❌ 请求失败：${escapeHtml(e.message)}</div>`;
    $('wrongAiBtn').classList.remove('hidden');
  }
}

function clearWrongQuestions() {
  if (confirm('确定清空所有错题记录吗？')) {
    APP.wrongQuestions.clear();
    renderWrongList();
    saveState();
    updateHomeStats();
  }
}

// ========== STATS ==========
function renderStats() {
  const answered = Object.keys(APP.stats).length;
  const correct = Object.values(APP.stats).filter(s => s.correct).length;
  const wrong = answered - correct;
  const accuracy = answered > 0 ? Math.round(correct / answered * 100) + '%' : '-';

  $('statsSolved').textContent = answered;
  $('statsCorrect').textContent = correct;
  $('statsWrong').textContent = wrong;
  $('statsAccuracy').textContent = accuracy;

  // Per-section accuracy
  const sectionStats = {};
  for (const [qId, stat] of Object.entries(APP.stats)) {
    const q = APP.questions.find(q => String(q.id) === String(qId));
    if (!q) continue;
    if (!sectionStats[q.section]) sectionStats[q.section] = { name: q.sectionName || q.section || '其他', total: 0, correct: 0 };
    sectionStats[q.section].total++;
    if (stat.correct) sectionStats[q.section].correct++;
  }

  const secDiv = $('statsBySection');
  secDiv.innerHTML = '';
  for (const [code, s] of Object.entries(sectionStats)) {
    const pct = Math.round(s.correct / s.total * 100);
    const barWidth = s.total > 0 ? pct : 0;
    secDiv.innerHTML += `
      <div class="bg-gray-50 rounded-lg p-3">
        <div class="flex justify-between text-xs mb-1">
          <span>${s.name}</span>
          <span class="text-gray-500">${s.correct}/${s.total} (${pct}%)</span>
        </div>
        <div class="bg-gray-200 rounded-full h-2">
          <div class="rounded-full h-2" style="width:${barWidth}%; background-color: ${pct >= 80 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444'}"></div>
        </div>
      </div>`;
  }

  if (Object.keys(sectionStats).length === 0) {
    secDiv.innerHTML = '<p class="text-gray-400 text-sm text-center py-4">还没有学习记录，开始刷题吧！</p>';
  }
}

function resetStats() {
  if (confirm('确定要重置所有学习记录吗？这将清除所有答题记录、错题集和统计数据。此操作不可恢复。')) {
    APP.stats = {};
    APP.wrongQuestions.clear();
    APP.aiCache = {};
    APP.examHistory = [];
    saveState();
    updateHomeStats();
    renderStats();
    renderWrongList();
  }
}

// ========== EXAM HISTORY ==========
function renderHistory() {
  const list = $('historyList');
  if (APP.examHistory.length === 0) {
    list.innerHTML = '<p class="text-gray-400 text-sm text-center py-10">还没有考试记录<br>去「模拟考试」做一套题吧</p>';
    return;
  }
  let html = '';
  for (let i = 0; i < APP.examHistory.length; i++) {
    const h = APP.examHistory[i];
    const date = new Date(h.timestamp);
    const dateStr = `${date.getMonth()+1}/${date.getDate()} ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
    const typeLabels = { mixed: '混合', single: '单选', multiple: '多选', judge: '判断' };
    const typeStr = typeLabels[h.type] || h.type;
    const pct = h.total > 0 ? Math.round(h.correct / h.total * 100) : 0;
    const timeStr = h.timeUsed > 0 ? `${Math.floor(h.timeUsed / 60)}分${h.timeUsed % 60}秒` : '不限时';
    let emoji = pct >= 90 ? '🏆' : pct >= 70 ? '👍' : pct >= 50 ? '📚' : '😢';
    html += `
      <div onclick="showExamDetail(${i})" class="flex items-center gap-3 bg-white border border-gray-200 rounded-xl p-3 active:bg-gray-50 cursor-pointer transition-all">
        <span class="text-2xl">${emoji}</span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-medium text-sm">${typeStr}</span>
            <span class="text-xs text-gray-400">${dateStr}</span>
          </div>
          <div class="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span>${pct}%</span>
            <span>${h.correct}/${h.total}</span>
            <span>${timeStr}</span>
          </div>
        </div>
        <span class="text-lg text-gray-300">›</span>
      </div>`;
  }
  list.innerHTML = html;
}

function showExamDetail(index) {
  const h = APP.examHistory[index];
  if (!h) return;

  const typeLabels = { mixed: '混合出题', single: '单选题', multiple: '多选题', judge: '判断题' };
  const pct = h.total > 0 ? Math.round(h.correct / h.total * 100) : 0;
  const timeStr = h.timeUsed > 0 ? `${Math.floor(h.timeUsed / 60)}分${h.timeUsed % 60}秒` : '不限时';
  const date = new Date(h.timestamp);
  const dateStr = `${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()} ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;

  $('historyDetailTitle').textContent = `考试详情 · ${dateStr}`;

  let qHtml = '';
  for (const d of h.details) {
    const labels = d.options.map((_, i) => String.fromCharCode(65 + i));
    const isCorrect = d.correct;
    const userAnswers = answerArray(d.userAnswer);
    const correctAnswers = answerArray(d.correctAnswer);

    let optHtml = '<div class="space-y-1 mt-2">';
    for (let i = 0; i < d.options.length; i++) {
      const letter = labels[i] || '';
      const optText = d.options[i] || '';
      let cls = 'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ';
      const isUser = userAnswers.includes(letter);
      const isCorrectOpt = correctAnswers.includes(letter);
      if (isCorrectOpt) cls += ' bg-green-50 text-green-700 font-medium';
      else if (isUser && !isCorrect) cls += ' bg-red-50 text-red-700';
      else cls += ' text-gray-600';
      const mark = isCorrectOpt ? ' ✓' : isUser && !isCorrect ? ' ✗' : '';
      optHtml += `<div class="${cls}">${letter}. ${optText}${mark}</div>`;
    }
    optHtml += '</div>';

    const detailType = questionTypeInfo(d.type);
    const typeTag = `<span class="inline-block text-xs px-2 py-0.5 rounded-full ${detailType.className}">${detailType.shortLabel}</span>`;

    const statusIcon = isCorrect ? '✅' : '❌';

    qHtml += `
      <div class="border border-gray-200 rounded-xl p-3">
        <div class="flex items-start gap-2">
          <span>${statusIcon}</span>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              ${typeTag}
              <span class="text-xs text-gray-400">${d.code}</span>
            </div>
            <p class="text-sm leading-relaxed">${d.question}</p>
            ${optHtml}
          </div>
        </div>
      </div>`;
  }

  $('historyDetailContent').innerHTML = `
    <div class="bg-gray-50 rounded-xl p-3 text-center">
      <div class="text-2xl font-bold ${pct >= 70 ? 'text-primary' : 'text-danger'}">${pct}%</div>
      <div class="text-xs text-gray-500 mt-1">${h.correct}/${h.total} 正确 · ${h.answered} 已答 · ${timeStr}</div>
      <div class="text-xs text-gray-400 mt-1">${typeLabels[h.type] || h.type}</div>
    </div>
    ${qHtml}`;

  $('historyView').classList.remove('active');
  $('historyDetailView').classList.remove('hidden');
  $('historyDetailView').classList.add('active');
  $('headerTitle').textContent = '考试详情';
  $('headerBackBtn').classList.remove('hidden');
  $('headerBackBtn').onclick = () => { switchTab('history'); };
}

// ========== SETTINGS ==========
function updateSettingsInfo() {
  $('settingsTotalQ').textContent = APP.questions.length;
  if ($('settingsBankTitle')) $('settingsBankTitle').textContent = APP.activeBank?.title || '-';
  if ($('settingsBankSource')) $('settingsBankSource').textContent = APP.activeBank?.source || APP.activeBank?.file || '-';
  if (APP.aiKey) $('apiKeyInput').value = APP.aiKey;
}

function saveApiKey() {
  const key = $('apiKeyInput').value.trim();
  APP.aiKey = key;
  localStorage.setItem('caifu_api_key', key);
  alert('API Key 已保存');
}

// ========== PERSISTENCE ==========
function saveState() {
  try {
    localStorage.setItem(bankStorageKey('stats'), JSON.stringify(APP.stats));
    localStorage.setItem(bankStorageKey('wrong'), JSON.stringify([...APP.wrongQuestions]));
    localStorage.setItem('caifu_api_key', APP.aiKey);
    localStorage.setItem(bankStorageKey('ai_cache'), JSON.stringify(APP.aiCache));
    localStorage.setItem(bankStorageKey('exam_history'), JSON.stringify(APP.examHistory));
  } catch (e) {
    console.warn('Failed to save state:', e);
  }
}

function loadState() {
  APP.stats = {};
  APP.wrongQuestions = new Set();
  APP.aiCache = {};
  APP.examHistory = [];
  try {
    // One-time compatibility migration for records created by the old
    // single-bank app.
    if (APP.activeBank?.id === 'caqi-intermediate' && !localStorage.getItem(bankStorageKey('migrated'))) {
      const legacyNames = ['stats', 'wrong', 'ai_cache', 'exam_history', 'practice_state'];
      legacyNames.forEach(name => {
        const legacy = localStorage.getItem(`caifu_${name}`);
        if (legacy && !localStorage.getItem(bankStorageKey(name))) {
          localStorage.setItem(bankStorageKey(name), legacy);
        }
      });
      localStorage.setItem(bankStorageKey('migrated'), '1');
    }

    const stats = localStorage.getItem(bankStorageKey('stats'));
    if (stats) APP.stats = JSON.parse(stats);

    const wrong = localStorage.getItem(bankStorageKey('wrong'));
    if (wrong) APP.wrongQuestions = new Set(JSON.parse(wrong).map(String));

    const key = localStorage.getItem('caifu_api_key');
    if (key) APP.aiKey = key;

    const aiCache = localStorage.getItem(bankStorageKey('ai_cache'));
    if (aiCache) APP.aiCache = JSON.parse(aiCache);

    const history = localStorage.getItem(bankStorageKey('exam_history'));
    if (history) APP.examHistory = JSON.parse(history);
  } catch (e) {
    console.warn('Failed to load state:', e);
    APP.stats = {};
    APP.wrongQuestions = new Set();
    APP.aiKey = '';
    APP.aiCache = {};
    APP.examHistory = [];
  }
}

// ========== UTILS ==========
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function answerArray(answer) {
  if (answer === undefined || answer === null || answer === '') return [];
  return (Array.isArray(answer) ? answer : [answer]).map(String).sort();
}

function answersEqual(left, right) {
  return JSON.stringify(answerArray(left)) === JSON.stringify(answerArray(right));
}

function formatAnswer(answer) {
  return answerArray(answer).join('、');
}

function optionLabels(question) {
  return question.options.map((_, index) => String.fromCharCode(65 + index));
}

function questionTypeInfo(type) {
  const map = {
    single: { label: '单选题', shortLabel: '单选', className: 'text-blue-600 bg-blue-50' },
    multiple: { label: '多选题', shortLabel: '多选', className: 'text-purple-600 bg-purple-50' },
    judge: { label: '判断题', shortLabel: '判断', className: 'text-amber-600 bg-amber-50' },
  };
  return map[type] || { label: '题目', shortLabel: '题目', className: 'text-gray-600 bg-gray-100' };
}

// ========== START ==========
document.addEventListener('DOMContentLoaded', init);

// Register Service Worker for PWA offline support
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // Silently fail — app still works without SW
  });
}

// ========== BACK BUTTON (HEADER) ==========
// Already handled inline
