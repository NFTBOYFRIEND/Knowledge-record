'use client';

import { useEffect, useState } from 'react';
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

const EXTRACTION_PROMPT = `ROLE: PRECISION QUESTION PAPER AND ANSWER KEY EXTRACTOR

You are an expert PDF question-paper extraction system. Your task is to inspect the attached PDF and extract every question, all its answer options, and its officially indicated correct answer.

1. OUTPUT REQUIREMENTS

Return ONLY these three fields for every question:

- "question"
- "options"
- "correct_answer"

Do not include exam name, exam year, question number, subject, topic, subtopic, learning unit, question pattern, difficulty, solution, explanation, or any other metadata.

The importer will add exam name and exam year separately.

2. CRITICAL: VISUAL ANSWER MARKING DETECTION

You MUST inspect the actual visual appearance of every PDF page. Do not rely exclusively on extracted text or OCR.

The PDF may contain answer indicators represented by graphical symbols, colours, or annotations that are not captured by text extraction.

Use these rules to identify the correct answer:

1. A green tick (✓) beside an option indicates the officially marked correct answer.
2. A red cross (✗) beside an option indicates an incorrect answer.
3. Identify the green tick visually and associate it with the exact option belonging to that question.
4. Return the complete text of the green-ticked option as "correct_answer".
5. Do not mistake a red cross, candidate-selected response, handwritten mark, or unrelated symbol for an official correct-answer indicator.
6. If a question has multiple options with visible markings, inspect the markings carefully and identify the officially indicated correct option.
7. If the green tick is visible but OCR fails to recognise it, trust the visual PDF evidence.
8. If the marking is genuinely missing, obscured, ambiguous, or unreadable, use "null".

IMPORTANT: Do not return null merely because the answer marking is missing from extracted text. Inspect the rendered PDF page before deciding that an answer is unavailable.

3. QUESTION EXTRACTION RULES

- Extract every visible question in the original page order.
- Do not omit, duplicate, merge, or rearrange questions.
- Preserve the exact original wording, spelling, punctuation, mathematical expressions, symbols, numbers, units, and sequences.
- Extract every answer option exactly as printed.
- Preserve the original option order.
- Include tables, diagrams, statements, and other question-specific information in the question text whenever necessary to understand the question independently.
- For passage-based questions, include the relevant passage context with each question.
- Preserve the original language. Do not translate or paraphrase questions or options.
- Do not correct spelling or grammatical errors in the source.

4. CORRECT ANSWER RULES

The "correct_answer" value must contain the exact text of the officially marked correct option.

Example:

If the PDF visually shows:

- A. 100
- B. 200
- C. 300 ✓
- D. 400

Return:

"correct_answer": "300"

Do not return "C" unless the option itself consists only of the letter C.

Never calculate, solve, infer, or guess an answer to fill a missing official marking.

Never use general knowledge or an external answer key to replace the PDF's markings.

If no official correct-answer marking can be confidently identified, return:

"correct_answer": null

5. PAGE-BY-PAGE VERIFICATION

Follow this mandatory workflow:

1. Determine the total number of PDF pages.
2. Inspect every page in its original visual form.
3. Extract the question text and all options.
4. Visually inspect the answer indicators beside each option.
5. Match every green tick to the correct question and option.
6. Verify that red crosses have not been interpreted as correct answers.
7. Check question order and ensure no question is missing or duplicated.
8. Validate the final JSON syntax.

Do not skip pages because their text extraction appears empty or incomplete. Render and inspect those pages visually.

6. OUTPUT FORMAT

Return valid JSON with exactly this structure:

{
"questions": [
{
"question": "Complete original question text",
"options": [
"Option A text",
"Option B text",
"Option C text",
"Option D text"
],
"correct_answer": "Exact text of the officially green-ticked option"
},
{
"question": "Next complete original question",
"options": [
"Option A text",
"Option B text",
"Option C text",
"Option D text"
],
"correct_answer": null
}
]
}

7. JSON VALIDATION

Before returning the result, verify:

- The output is valid, parseable JSON.
- There are no Markdown code fences or explanatory comments.
- All strings use valid JSON escaping.
- No unnecessary backslashes appear before square brackets or other characters.
- Every question has exactly three fields: "question", "options", and "correct_answer".
- "options" is always an array of strings.
- "correct_answer" is either an exact option string or "null".
- No additional fields are present.

8. LARGE PDF HANDLING

If the PDF is too large for one response:

- Extract questions in sequential batches.
- Maintain the original page and question order.
- Continue from the exact point where the previous batch ended.
- Never repeat questions from earlier batches.
- Use the same JSON structure for every batch.
- Do not sacrifice visual answer-marking verification to increase extraction speed.

FINAL PRIORITY

Accuracy and source fidelity are more important than speed.

Every question must be extracted from the PDF, and every available official green-tick answer must be captured. Do not leave a correct answer as null when its green tick is visibly identifiable in the PDF.

Return ONLY valid JSON. No commentary, no explanations, and no Markdown fences.`;

export default function PyqImportPage() {
  const [jsonText, setJsonText] = useState('');
  const [examName, setExamName] = useState('');
  const [examYear, setExamYear] = useState('');

  useEffect(() => {
    setExamYear(String(new Date().getFullYear()));
  }, []);
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

        if (!question) localIssues.push(`Question ${index + 1}: question text is missing.`);
        if (!Array.isArray(rawOptions)) {
          localIssues.push(`Question ${index + 1}: options must be a JSON array.`);
        } else if (options.length === 0 || options.some((option: string) => !option)) {
          localIssues.push(`Question ${index + 1}: options are empty or contain blank entries.`);
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
        if (key && seen.has(key)) localIssues.push(`Question ${index + 1}: duplicate question inside this JSON payload.`);
        seen.add(key);
      });

      setExamName(finalExamName);
      setExamYear(String(finalYear));
      setPrepared(staged);
      setIssues(localIssues);
      setParsed(true);
      setStatus(localIssues.length
        ? 'Validation found issues. Correct the JSON before importing.'
        : `Validated ${staged.length} questions. Only exam_name, exam_year, question, options and correct_answer will be inserted.`);
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

      setStatus(`Import complete: ${inserted} questions saved. ${prepared.length - toInsert.length} duplicates skipped.`);
      setJsonText('');
      setPrepared([]);
      setParsed(false);
    } catch (error: any) {
      setStatus(`Import stopped after ${importedCount} inserted rows: ${error.message}. Check the table before retrying to avoid duplicate imports.`);
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
