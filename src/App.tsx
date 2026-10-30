import { useEffect, useRef, useState } from 'react'

type Mode = 'explain' | 'simplify' | 'summarize' | 'quiz'
type Msg = { role: 'user' | 'bot'; text: string }
const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'explain', label: 'شرح درس', hint: 'اكتب الدرس أو المفهوم' },
  { id: 'simplify', label: 'تبسيط', hint: 'الصق نصًا معقدًا' },
  { id: 'summarize', label: 'تلخيص', hint: 'الصق النص المراد تلخيصه' },
  { id: 'quiz', label: 'أسئلة تدريبية', hint: 'الصق المادة لتوليد أسئلة' },
]
const ENDPOINT = import.meta.env.VITE_AI_ENDPOINT as string | undefined
const KEY = 'ilg_ai_history'

const sentences = (t: string) => t.split(/(?<=[.!؟?])\s+|\n+/).map(s => s.trim()).filter(Boolean)

// Demo mode: simple text rules only. This is NOT artificial intelligence.
function demo(mode: Mode, text: string): string {
  const s = sentences(text)
  if (mode === 'summarize') {
    if (s.length <= 2) return 'النص قصير بالفعل:\n' + text
    const pick = [s[0], s[Math.floor(s.length / 2)], s[s.length - 1]].filter((x, i, a) => a.indexOf(x) === i)
    return 'ملخص آلي بسيط (اختيار جمل من النص):\n' + pick.map(x => '• ' + x).join('\n')
  }
  if (mode === 'simplify') {
    return 'تقسيم النص إلى نقاط قصيرة:\n' + s.flatMap(x => x.split(/[،,;؛]/)).map(x => x.trim()).filter(Boolean).map(x => '• ' + x).join('\n')
  }
  if (mode === 'quiz') {
    const qs = s.filter(x => x.split(' ').length > 4).slice(0, 5).map((x, i) => {
      const w = x.split(' ').reduce((a, b) => (b.length > a.length ? b : a))
      return `${i + 1}) ${x.replace(w, '_____')}\n   الإجابة: ${w}`
    })
    return qs.length ? 'أسئلة أكمل الفراغ (مولّدة آليًا):\n' + qs.join('\n') : 'النص قصير لتوليد أسئلة.'
  }
  return 'الشرح الحقيقي يحتاج ربط نموذج ذكاء اصطناعي، وهو غير مفعّل الآن.\nيمكنك تجربة التلخيص أو التبسيط أو الأسئلة، وهي تعمل بقواعد نصية بسيطة.'
}

async function ask(mode: Mode, text: string): Promise<string> {
  if (!ENDPOINT) return demo(mode, text)
  const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, text }) })
  if (!r.ok) throw new Error('فشل الاتصال بالخدمة')
  return (await r.json()).reply
}

export default function App() {
  const [mode, setMode] = useState<Mode>('summarize')
  const [input, setInput] = useState('')
  const [save, setSave] = useState(() => localStorage.getItem(KEY + '_on') === '1')
  const [msgs, setMsgs] = useState<Msg[]>(() => { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] } })
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])
  useEffect(() => {
    localStorage.setItem(KEY + '_on', save ? '1' : '0')
    save ? localStorage.setItem(KEY, JSON.stringify(msgs)) : localStorage.removeItem(KEY)
  }, [save, msgs])

  async function send() {
    const t = input.trim(); if (!t || busy) return
    setInput(''); setBusy(true); setMsgs(m => [...m, { role: 'user', text: t }])
    try { const r = await ask(mode, t); setMsgs(m => [...m, { role: 'bot', text: r }]) }
    catch (e) { setMsgs(m => [...m, { role: 'bot', text: (e as Error).message }]) }
    setBusy(false)
  }

  return (
    <div className="min-h-screen flex flex-col max-w-3xl mx-auto p-4 gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">iLogia <span className="text-gold">AI</span></h1>
        <a className="text-sm underline" href="https://app.ilogia-eg.com">العودة للوحة التحكم</a>
      </header>
      <div className={`rounded-xl px-4 py-2 text-sm ${ENDPOINT ? 'bg-green-50 text-green-800' : 'bg-gold-soft text-navy'}`}>
        {ENDPOINT ? 'متصل بخدمة الذكاء الاصطناعي' : 'وضع تجريبي: لا يوجد ذكاء اصطناعي حقيقي، النتائج بقواعد نصية بسيطة.'}
      </div>
      <nav className="flex flex-wrap gap-2">
        {MODES.map(m => (
          <button key={m.id} onClick={() => setMode(m.id)}
            className={`px-4 py-2 rounded-full text-sm transition ${mode === m.id ? 'bg-navy text-white' : 'bg-white border border-navy/10 hover:border-gold'}`}>{m.label}</button>
        ))}
      </nav>
      <main className="card flex-1 min-h-[320px] overflow-y-auto space-y-3">
        {msgs.length === 0 && <p className="text-navy/50">ابدأ بكتابة نص. الوضع الحالي: {MODES.find(m => m.id === mode)?.hint}</p>}
        {msgs.map((m, i) => (
          <div key={i} className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 ${m.role === 'user' ? 'bg-navy text-white me-auto' : 'bg-gold-soft ms-auto'}`}>{m.text}</div>
        ))}
        {busy && <div className="text-navy/50 animate-pulse">جارٍ المعالجة...</div>}
        <div ref={end} />
      </main>
      <footer className="space-y-2">
        <textarea value={input} onChange={e => setInput(e.target.value)} rows={3} placeholder={MODES.find(m => m.id === mode)?.hint}
          className="w-full rounded-xl border border-navy/10 p-3 focus:outline-none focus:ring-2 focus:ring-gold" />
        <div className="flex items-center justify-between">
          <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={save} onChange={e => setSave(e.target.checked)} />حفظ سجل المحادثة على هذا الجهاز</label>
          <button className="btn-gold" onClick={send} disabled={busy}>إرسال</button>
        </div>
      </footer>
    </div>
  )
}
