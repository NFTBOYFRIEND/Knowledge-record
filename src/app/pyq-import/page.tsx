'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

type PreparedQuestion = {
  exam_name: string;
  exam_year: number;
  question: string;
  options: string[];
  correct_answer: string | null;
};

const norm = (value: unknown) =>
  String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');

const asObject = (value: any) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

const EXTRACTION_PROMPT = `# ROLE: QUESTION PAPER JSON EXTRACTOR

Inspect the attached question-paper PDF and extract every question exactly as printed.

Return ONLY these fields for each question:
- question
- options
- correct_answer

Do NOT extract exam name or exam year. The user enters both in the Knowledge Studio form; the importer adds them to every database row.

RULES:
- Extract every visible question in page order; do not omit or duplicate questions.
- Preserve original wording, mathematical symbols, numbers, units, tables, sequences, and option order.
- Include all answer options exactly as printed.
- Set correct_answer only when an official answer key or official marking is explicitly visible in the PDF (for example, the official green tick).
- Never solve a question to guess its answer. Never confuse a candidate's selected response with the official answer.
- If the official answer is not explicitly visible or cannot be read confidently, set correct_answer to null.
- Do not return question numbers, metadata, subject, topic, subtopic, learning unit, question pattern, difficulty, solution, explanation, or any other fields.
- For passage-based questions, include necessary passage context so each question can be understood independently.
- If the PDF is too large for one response, return sequential batches in the same JSON structure without repeating earlier questions.

Return valid JSON only, with exactly this structure:

{
  \"questions\": [
    {
      \"question\": \"Complete original question text\",
      \"options\": [\"Option A text\", \"Option B text\", \"Option C text\", \"Option D text\"],
      \"correct_answer\": \"Exact official option text\"
    },
    {
      \"question\": \"Next question text\",
      \"options\": [\"Option A\", \"Option B\", \"Option C\", \"Option D\"],
      \"correct_answer\": null
    }
  ]
}

No Markdown fences or commentary. Accuracy and source fidelity are more important than speed.`;

export default function PyqImportPage() {
  const [jsonText, setJsonText] = useState('');
  const [examName, setExamName] = useState('');
  const [examYear, setExamYear] = useState(String(new Date().getFullYear()));
  const [prepared, setPrepared] = useState<PreparedQuestion[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [parsed, setParsed] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [promptCopied, setPromptCopied] = useState(false);

  async function copyExtractionPrompt() {
    try {
      await navigator.clipboard.writeText(EXTRACTION_PROMPT);
      setPromptCopied(true);
      window.setTimeout(() => setPromptCopied(false), 2200);
    } catch {
      setStatus('Could not copy automatically. Check browser clipboard permissions and try again.');
    }
  }

  function parseAndValidate() {
    setIssues([]);
    setStatus('');
    setImportedCount(0);
    setLoading(true);
    try {
      const cleaned = jsonText.trim()
        .replace(/^\x60\x60\x60(?:json)?\s*/i, '')
        .replace(/\s*\x60\x60\x60$/, '');
      const root = JSON.parse(cleaned);
      // Exam identity is authoritative from the frontend form, never from AI JSON.
      const finalExamName = examName.trim();
      const finalYear = Number(examYear);

      if (!finalExamName) throw new Error('Enter the exam name in the form above.');
      if (!Number.isInteger(finalYear) || finalYear < 1900 || finalYear > 2100) {
        throw new Error('Enter a valid four-digit exam year in the form above.');
      }

      const rows = Array.isArray(root) ? root : root.questions;
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error('JSON must contain a non-empty questions array.');
      }

      const localIssues: string[] = [];
      const staged: PreparedQuestion[] = rows.map((raw: any, index: number) => {
        const item = asObject(raw);
        const question = String(item.question ?? item.question_text ?? '').trim();
        const rawOptions = item.options;
        const options = Array.isArray(rawOptions)
          ? rawOptions.map((option: any) => String(option ?? '').trim())
          : [];

        if (!question) localIssues.push(\`Question \${index + 1}: question text is missing.\`);
        if (!Array.isArray(rawOptions)) {
          localIssues.push(\`Question \${index + 1}: options must be a JSON array.\`);
        } else if (options.length === 0 || options.some((option: string) => !option)) {
          localIssues.push(\`Question \${index + 1}: options are empty or contain blank entries.\`);
        }

        const rawAnswer = item.correct_answer ?? item.answer ?? null;
        const correctAnswer = rawAnswer == null || String(rawAnswer).trim() === ''
          ? null
          : String(rawAnswer).trim();

        return {
          exam_name: finalExamName,
          exam_year: finalYear,
          question,
          options,
          correct_answer: correctAnswer,
        };
      });

      const seen = new Set<string>();
      staged.forEach((q, index) => {
        const key = norm(q.question);
        if (key && seen.has(key)) localIssues.push(\`Question \${index + 1}: duplicate question inside this JSON payload.\`);
        seen.add(key);
      });

      setExamName(finalExamName);
      setExamYear(String(finalYear));
      setPrepared(staged);
      setIssues(localIssues);
      setParsed(true);
      setStatus(localIssues.length
        ? 'Validation found issues. Correct the JSON before importing.'
        : \`Validated \${staged.length} questions. Only exam_name, exam_year, question, options and correct_answer will be inserted.\`);
    } catch (error: any) {
      setPrepared([]);
      setParsed(false);
      setStatus(error.message || 'Could not parse JSON.');
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (!parsed || !prepared.length || issues.length) return;
    setLoading(true);
    setStatus('');
    try {
      const uniqueQuestions = [...new Set(prepared.map(q => q.question))];
      const existing: string[] = [];
      for (let i = 0; i < uniqueQuestions.length; i += 100) {
        const chunk = uniqueQuestions.slice(i, i + 100);
        const { data, error } = await supabase.from('previous_year_questions')
          .select('question')
          .eq('exam_name', examName)
          .eq('exam_year', Number(examYear))
          .in('question', chunk);
        if (error) throw error;
        existing.push(...(data || []).map((row: any) => row.question));
      }

      const existingSet = new Set(existing.map(norm));
      const batchSeen = new Set<string>();
      const toInsert = prepared
        .filter(q => {
          const key = norm(q.question);
          if (existingSet.has(key) || batchSeen.has(key)) return false;
          batchSeen.add(key);
          return true;
        })
        .map(q => ({
          exam_name: q.exam_name,
          exam_year: q.exam_year,
          question: q.question,
          options: q.options,
          correct_answer: q.correct_answer,
        }));

      if (!toInsert.length) {
        setStatus('Nothing imported: all questions already exist for this exam and year.');
        setImportedCount(0);
        return;
      }

      let inserted = 0;
      for (let i = 0; i < toInsert.length; i += 100) {
        const batch = toInsert.slice(i, i + 100);
        const { error } = await supabase.from('previous_year_questions').insert(batch);
        if (error) throw error;
        inserted += batch.length;
        setImportedCount(inserted);
      }

      setStatus(\`Import complete: \${inserted} questions saved. \${prepared.length - toInsert.length} duplicates skipped.\`);
      setJsonText('');
      setPrepared([]);
      setParsed(false);
    } catch (error: any) {
      setStatus(\`Import stopped after \${importedCount} inserted rows: \${error.message}. Check the table before retrying to avoid duplicate imports.\`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-800 md:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider text-blue-700">SSC Knowledge Studio</p>
              <h1 className="mt-1 text-3xl font-extrabold text-slate-900">PYQ JSON Import</h1>
            </div>
            <button onClick={copyExtractionPrompt} className="rounded-lg bg-indigo-700 px-5 py-3 font-semibold text-white shadow-sm hover:bg-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">
              {promptCopied ? 'Copied extraction prompt ✓' : 'Copy extraction prompt'}
            </button>
          </div>
          <p className="mt-2 text-slate-600">Paste Gemini's structured extraction, validate the question data, preview records, and import only the five initial PYQ fields. Academic mapping will be handled later.</p>
        </div>

        <section className="mb-6 grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">Exam name
            <input value={examName} onChange={e => setExamName(e.target.value)} placeholder="e.g. SSC CHSL Tier-I" className="mt-2 w-full rounded-lg border border-slate-300 p-3 font-normal outline-none focus:border-blue-500" />
          </label>
          <label className="text-sm font-semibold text-slate-700">Exam year
            <input type="number" min="1900" max="2100" value={examYear} onChange={e => setExamYear(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 p-3 font-normal outline-none focus:border-blue-500" />
          </label>
        </section>

        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">1. Gemini JSON</h2>
            <span className="text-xs text-slate-500">Required: questions[]</span>
          </div>
          <textarea value={jsonText} onChange={e => { setJsonText(e.target.value); setParsed(false); setPrepared([]); setIssues([]); }} placeholder={'Paste Gemini JSON here…\n\n{\n  "questions": [\n    { "question": "...", "options": ["A", "B", "C", "D"], "correct_answer": "Exact option text" }\n  ]\n}'} className="min-h-[320px] w-full rounded-lg border border-slate-300 bg-slate-50 p-4 font-mono text-sm outline-none focus:border-blue-500" />
          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={parseAndValidate} disabled={loading || !jsonText.trim()} className="rounded-lg bg-blue-700 px-5 py-3 font-semibold text-white hover:bg-blue-800 disabled:opacity-50">Parse & validate</button>
          </div>
        </section>

        {status && <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">{status}</div>}

        {parsed && <>
          <section className="mb-6 rounded-xl border bg-white p-4">
            <p className="text-sm text-slate-500">Questions ready for import</p>
            <p className="text-2xl font-bold">{prepared.length}</p>
            <p className="mt-1 text-xs text-slate-500">Database payload is restricted to exam_name, exam_year, question, options and correct_answer.</p>
          </section>

          {issues.length > 0 && <section className="mb-6 rounded-xl border border-red-200 bg-red-50 p-5">
            <h2 className="mb-2 font-bold text-red-900">Validation issues ({issues.length})</h2>
            <ul className="max-h-64 list-disc space-y-1 overflow-auto pl-5 text-sm text-red-800">{issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>
          </section>}

          <section className="mb-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
              <div><h2 className="text-lg font-bold">2. Import preview</h2><p className="text-sm text-slate-500">{examName} · {examYear}</p></div>
              <button onClick={handleImport} disabled={loading || issues.length > 0 || prepared.length === 0} className="rounded-lg bg-emerald-700 px-6 py-3 font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300">{loading ? 'Importing…' : 'Confirm & import PYQs'}</button>
            </div>
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full min-w-[850px] text-left text-sm">
                <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-600"><tr><th className="p-3">#</th><th className="p-3">Question</th><th className="p-3">Options</th><th className="p-3">Correct answer</th></tr></thead>
                <tbody>{prepared.map((q, i) => <tr key={i} className="border-t align-top"><td className="p-3">{i + 1}</td><td className="max-w-md whitespace-pre-wrap p-3">{q.question}</td><td className="whitespace-pre-wrap p-3">{q.options.join('\n')}</td><td className="p-3">{q.correct_answer || '—'}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        </>}
      </div>
    </main>
  );
}
