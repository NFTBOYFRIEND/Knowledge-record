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

const EXTRACTION_PROMPT = \`# ROLE: PREVIOUS YEAR QUESTION PAPER JSON EXTRACTOR

Read the uploaded question-paper PDF and extract its questions accurately.

YOUR ONLY TASK IS TO EXTRACT:
1. Exam name
2. Exam year
3. Complete question text
4. All answer options
5. Official correct answer, only when it is explicitly marked in the source

Do NOT classify questions. Do NOT generate subject, topic, subtopic, learning unit, question pattern, difficulty, solution, explanation, taxonomy IDs, or any other fields.

## EXTRACTION RULES

- Inspect every page of the supplied PDF.
- Extract every actual question; do not silently skip or duplicate questions.
- Preserve the original question wording, numbering, mathematical symbols, values, units, tables, sequences, and option order.
- Include all options visible in the source.
- For passage-based questions, include the necessary passage context so each question can be understood independently.
- Read diagrams or image-based content carefully. Describe essential visual information in the question text only when it can be read reliably.
- Identify the correct answer only from an explicit official answer marking, such as the green tick used by this paper.
- Do not confuse a candidate's selected response with the official correct answer.
- Do not solve a question to guess the official answer.
- If no official answer is shown, use null.
- If text, options, or answer marking are unclear, do not guess. Preserve what is readable and use null for an uncertain correct answer.
- Preserve the original question number in question_number for checking, but do not add it to the question text unless it is part of the printed wording.

## OUTPUT REQUIREMENTS

Return valid JSON only. Do not include Markdown fences, commentary, explanations, or text outside the JSON.

Use exactly this structure:

{
  "metadata": {
    "exam_name": "Exact examination name",
    "exam_year": 2025
  },
  "questions": [
    {
      "question_number": "Q.1",
      "question": "Complete original question text",
      "options": [
        "Option A text",
        "Option B text",
        "Option C text",
        "Option D text"
      ],
      "correct_answer": "Exact text of the officially marked option"
    }
  ]
}

## STRICT FIELD RULES

- metadata.exam_name must be a string.
- metadata.exam_year must be a four-digit number.
- questions must be an array.
- Every question must contain question, options, and correct_answer.
- options must be an array of strings in the original order.
- correct_answer must be the exact option text or null.
- question_number is retained for source auditing; the importer will not store it in the database.
- Do not add any other fields.

## LARGE PDF / RESPONSE LIMITS

If the entire PDF cannot fit in one response, process it in sequential batches. Return the same JSON structure for each batch. Preserve original question numbers and never repeat questions from earlier batches. Do not claim the entire paper is complete when only a batch has been processed. State the page or question range in metadata only if it can be represented without adding fields; otherwise keep the JSON schema unchanged.

Accuracy and source fidelity are more important than speed. Never invent missing information.\`;

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
      const meta = asObject(root.metadata || root.exam || root);
      const finalExamName = String(meta.exam_name || meta.examName || examName).trim();
      const rawYear = meta.exam_year ?? meta.examYear ?? examYear;
      const finalYear = Number(rawYear);

      if (!finalExamName) throw new Error('Exam name is required. Add metadata.exam_name or enter it above.');
      if (!Number.isInteger(finalYear) || finalYear < 1900 || finalYear > 2100) {
        throw new Error('Exam year must be a valid four-digit year.');
      }

      const rows = Array.isArray(root) ? root : (root.questions || root.pyqs || root.data);
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
      const toInsert = prepared
        .filter(q => !existingSet.has(norm(q.question)))
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
            <span className="text-xs text-slate-500">Required: metadata + questions[]</span>
          </div>
          <textarea value={jsonText} onChange={e => { setJsonText(e.target.value); setParsed(false); setPrepared([]); setIssues([]); }} placeholder={'Paste Gemini response here…\n\n{\n  "metadata": { "exam_name": "SSC CHSL Tier-I", "exam_year": 2024 },\n  "questions": [\n    { "question_number": "Q.1", "question": "...", "options": ["A", "B", "C", "D"], "correct_answer": "B" }\n  ]\n}'} className="min-h-[320px] w-full rounded-lg border border-slate-300 bg-slate-50 p-4 font-mono text-sm outline-none focus:border-blue-500" />
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
