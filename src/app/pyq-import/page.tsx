'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { parseQuestionJson, stripJsonFence, validateQuestionJson, type ImportIssue } from '@/lib/question-json-validation';

type PreparedQuestion = {
  exam_name: string;
  exam_year: number;
  question: string;
  options: string[];
  correct_answer: string | null;
};

const norm = (value: unknown) =>
  String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');

const EXTRACTION_PROMPT = `ROLE: PRECISION QUESTION PAPER AND ANSWER KEY EXTRACTOR

You are an expert PDF question-paper extraction system. Inspect the attached PDF and extract every question, all answer options, and its officially indicated correct answer.

1. OUTPUT REQUIREMENTS

Return exactly these three fields for every question:
- "question"
- "options"
- "correct_answer"

Do not include exam name, exam year, question number, subject, topic, subtopic, learning unit, question pattern, difficulty, solution, explanation, or any other metadata. The importer adds exam name and exam year separately.

2. CRITICAL: VISUAL ANSWER MARKING DETECTION

You MUST inspect the actual visual appearance of every PDF page. Do not rely exclusively on extracted text or OCR.

1. A green tick (✓) beside an option indicates the officially marked correct answer.
2. A red cross (✗) beside an option indicates an incorrect answer.
3. Visually associate each green tick with the exact option and question.
4. Return the complete text of the green-ticked option as "correct_answer".
5. Do not mistake a red cross, candidate-selected response, handwritten mark, or unrelated symbol for an official correct-answer indicator.
6. If multiple options have markings, inspect them carefully and identify the officially indicated correct option.
7. If the green tick is visible but OCR fails to recognise it, trust the visual PDF evidence.
8. If the marking is genuinely missing, obscured, ambiguous, or unreadable, use null.

IMPORTANT: Never return null merely because the marking is missing from extracted text. Render and inspect the PDF page.

3. QUESTION EXTRACTION RULES

- Extract every visible question in original page order. Do not omit, duplicate, merge, or rearrange questions.
- Preserve exact original wording, spelling, punctuation, mathematical expressions, symbols, numbers, units, tables, sequences, and option order.
- Extract every answer option exactly as printed.
- Include tables, diagrams, statements, and question-specific information when necessary to understand the question independently.
- For passage-based questions, include the relevant passage context with each question.
- Preserve the original language. Do not translate, paraphrase, or correct the source.

4. CORRECT ANSWER RULES

The "correct_answer" value must contain the exact text of the officially marked correct option, not its option letter unless the option itself consists only of that letter.

Example: If option C is "300" and has the green tick, return "correct_answer": "300".

Never calculate, solve, infer, or guess an answer. Never use general knowledge or an external answer key to replace the PDF's markings. If no official marking can be confidently identified, return "correct_answer": null.

5. PAGE-BY-PAGE VERIFICATION

Before producing the output:
1. Determine the total number of PDF pages.
2. Inspect every page in its original visual form.
3. Extract the question text and all options.
4. Visually inspect answer indicators beside every option.
5. Match every green tick to the correct question and option.
6. Ensure red crosses are not interpreted as correct answers.
7. Check question order and ensure no question is missing or duplicated.
8. Validate the complete JSON using strict JSON syntax.

Do not skip pages because their text extraction appears empty or incomplete. Render and inspect those pages visually.

6. STRICT JSON OUTPUT — MANDATORY

The final response MUST contain exactly ONE JSON object, formatted inside ONE fenced JSON code block so the interface displays a copy button.

Follow this exact response layout:

\`\`\`json
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
\`\`\`

ABSOLUTE OUTPUT RULES:
- Output one opening \`\`\`json fence and one closing \`\`\` fence only.
- Put the entire JSON object inside that single code block.
- Do not write ANY greeting, introduction, heading, explanation, note, warning, summary, or commentary outside the code block.
- Do not put comments inside the JSON.
- Do not output multiple JSON objects or multiple code blocks in one response.
- Do not append question counts, batch labels, citations, or any other text after the closing code fence.
- The first character inside the code block must be { and the last character must be }.
- Use double quotes for all JSON keys and string values.
- Use null as the unquoted JSON value null, never as the string "null".
- Use valid JSON escaping for quotation marks, backslashes, and control characters.
- Do not use trailing commas.
- Do not use JavaScript syntax, single-quoted strings, or Markdown formatting inside the JSON.

7. JSON SELF-VALIDATION — MANDATORY

Before sending the response, internally validate the JSON object:
- Parse the JSON mentally or with an available JSON validator. Do not send it unless it is valid strict JSON.
- Confirm the root is one object containing exactly one "questions" array.
- Confirm every question object contains exactly "question", "options", and "correct_answer".
- Confirm "question" is a string.
- Confirm "options" is an array containing only non-empty strings.
- Confirm "correct_answer" is either an exact option string or null.
- Confirm there are no extra keys, missing commas, trailing commas, unmatched braces, unmatched brackets, or unescaped quotation marks.
- Confirm there is no content before or after the JSON code block.

8. LARGE PDF HANDLING

If the entire PDF cannot fit in one response:
- Return one sequential batch per response.
- Each response must independently contain exactly one complete JSON object inside one \`\`\`json code block.
- Maintain original page and question order across batches.
- Continue from the exact point where the previous batch ended. Never repeat earlier questions.
- Do not combine multiple batches into one response and do not append continuation notes outside the code block.
- Do not sacrifice visual answer-marking verification to increase extraction speed.

FINAL PRIORITY

Accuracy, source fidelity, and syntactically valid JSON are mandatory. Every visible official green-tick answer must be captured. Never leave a correct_answer as null when its green tick is visibly identifiable.

Return ONLY the single fenced JSON code block. The code block must contain valid JSON and nothing else.`;

export default function PyqImportPage() {
  const [jsonText, setJsonText] = useState('');
  const [examName, setExamName] = useState('');
  const [examYear, setExamYear] = useState('');

  useEffect(() => {
    setExamYear(String(new Date().getFullYear()));
  }, []);
  const [prepared, setPrepared] = useState<PreparedQuestion[]>([]);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [repairPreview, setRepairPreview] = useState<string | null>(null);
  const [needsCorrection, setNeedsCorrection] = useState(false);
  const [syntaxError, setSyntaxError] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [parsed, setParsed] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [promptCopied, setPromptCopied] = useState(false);\n  const [editIndex, setEditIndex] = useState<number | null>(null);\n  const [editDraft, setEditDraft] = useState('');

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
    setPrepared([]);
    setParsed(false);
    setRepairPreview(null);
    setSyntaxError('');
    setLoading(true);

    try {
      const parsedResult = parseQuestionJson(jsonText);
      setNeedsCorrection(false);
      if (parsedResult.syntaxError) setSyntaxError(parsedResult.syntaxError);
      if (parsedResult.repaired && parsedResult.correctedText) {
        setRepairPreview(parsedResult.correctedText);
        setJsonText(parsedResult.correctedText);
      }

      const finalExamName = examName.trim();
      const finalYear = Number(examYear);
      const metadataIssues: ImportIssue[] = [];
      if (!finalExamName) metadataIssues.push({ path: 'exam_name', message: 'Enter the exam name in the form above.' });
      if (!Number.isInteger(finalYear) || finalYear < 1900 || finalYear > 2100) {
        metadataIssues.push({ path: 'exam_year', message: 'Enter a valid four-digit exam year.' });
      }

      const validationIssues = [...metadataIssues, ...validateQuestionJson(parsedResult.value)];
      setIssues(validationIssues);
      setParsed(true);
      if (validationIssues.length) {
        setStatus('Validation found blocking issues. Fix the listed items and validate again.');
        return;
      }

      const root = parsedResult.value as { questions: Array<{ question: string; options: string[]; correct_answer: string | null }> };
      const staged: PreparedQuestion[] = root.questions.map(item => ({
        exam_name: finalExamName,
        exam_year: finalYear,
        question: item.question.trim(),
        options: item.options.map(option => option.trim()),
        correct_answer: item.correct_answer,
      }));

      setExamName(finalExamName);
      setExamYear(String(finalYear));
      setPrepared(staged);
      setParsed(true);
      if (parsedResult.repaired) {
        setStatus(`JSON corrected successfully. ${staged.length} questions passed validation. Confirm the import below.`);
      } else {
        setStatus(`Validated ${staged.length} questions. Ready for review and import.`);
      }
    } catch (error) {
      setStatus(`Could not parse or repair JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }

  function removeQuestion(index: number) {
    try {
      const current = parseQuestionJson(jsonText).value as { questions: unknown[] };
      const nextQuestions = current.questions.filter((_, i) => i !== index);
      const nextText = JSON.stringify({ questions: nextQuestions }, null, 2);
      setJsonText(nextText);
      setRepairPreview(null);
      setPrepared([]);
      setParsed(false);
      setEditIndex(null);
      setStatus(`Removed question ${index + 1}. Validate again to refresh the import preview.`);
      const nextIssues = [...validateQuestionJson({ questions: nextQuestions })];
      setIssues(nextIssues);
      setParsed(true);
      if (nextIssues.length === 0) {
        const finalExamName = examName.trim();
        const finalYear = Number(examYear);
        const metadataIssues: ImportIssue[] = [];
        if (!finalExamName) metadataIssues.push({ path: 'exam_name', message: 'Enter the exam name in the form above.' });
        if (!Number.isInteger(finalYear) || finalYear < 1900 || finalYear > 2100) metadataIssues.push({ path: 'exam_year', message: 'Enter a valid four-digit exam year.' });
        setIssues(metadataIssues);
        if (!metadataIssues.length) {
          setPrepared(nextQuestions.map((raw: any) => ({
            exam_name: finalExamName,
            exam_year: finalYear,
            question: raw.question.trim(),
            options: raw.options.map((option: string) => option.trim()),
            correct_answer: raw.correct_answer,
          })));
        }
      }
    } catch (error) {
      setStatus(`Could not remove question: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  function startEditQuestion(index: number) {
    try {
      const current = parseQuestionJson(jsonText).value as { questions: Array<{ question: string; options: string[]; correct_answer: string | null }> };
      setEditIndex(index);
      setEditDraft(JSON.stringify(current.questions[index], null, 2));
    } catch {
      setStatus('Could not load this question for editing. Correct JSON syntax first.');
    }
  }

  function saveEditedQuestion() {
    if (editIndex === null) return;
    try {
      const edited = JSON.parse(editDraft) as { question: string; options: string[]; correct_answer: string | null };
      const current = parseQuestionJson(jsonText).value as { questions: unknown[] };
      const nextQuestions = [...current.questions];
      nextQuestions[editIndex] = edited;
      const nextText = JSON.stringify({ questions: nextQuestions }, null, 2);
      setJsonText(nextText);
      setEditIndex(null);
      setEditDraft('');
      setPrepared([]);
      setParsed(false);
      setRepairPreview(null);
      setStatus(`Saved changes to question ${editIndex + 1}. Validate again to refresh the import preview.`);
    } catch (error) {
      setStatus(`Edited question is not valid JSON: ${error instanceof Error ? error.message : 'Invalid JSON'}`);
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
      setRepairPreview(null);
      setNeedsCorrection(false);
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
          <textarea value={jsonText} onChange={e => { const value = e.target.value; setJsonText(value); setParsed(false); setPrepared([]); setIssues([]); setRepairPreview(null); setSyntaxError(''); setStatus(''); try { JSON.parse(stripJsonFence(value)); setNeedsCorrection(false); } catch { setNeedsCorrection(Boolean(value.trim())); } }} placeholder={'Paste Gemini JSON here…\n\n{\n  "questions": [\n    { "question": "...", "options": ["A", "B", "C", "D"], "correct_answer": "Exact option text" }\n  ]\n}'} className="min-h-[320px] w-full rounded-lg border border-slate-300 bg-slate-50 p-4 font-mono text-sm outline-none focus:border-blue-500" />
          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={parseAndValidate} disabled={loading || !jsonText.trim()} className="rounded-lg bg-blue-700 px-5 py-3 font-semibold text-white hover:bg-blue-800 disabled:opacity-50">{loading ? 'Processing…' : needsCorrection ? 'Correct JSON' : 'Validate JSON'}</button>
          </div>
        </section>

        {syntaxError && <p className="mb-3 text-sm text-amber-800">Initial strict JSON parser error: {syntaxError}</p>}
        {repairPreview && <section className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-bold text-amber-950">Automatic syntax repair applied</h2><p className="text-sm text-amber-900">Review the corrected JSON before importing. Syntax repair does not verify the correctness of the extracted questions.</p></div>
          </div>
          <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-amber-950">Show corrected JSON</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-3 text-xs">{repairPreview}</pre></details>
        </section>}
        {editIndex !== null && <section className="mb-6 rounded-xl border border-blue-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">Edit question {editIndex + 1}</h2><button onClick={() => setEditIndex(null)} className="text-sm text-slate-500">Cancel</button></div>
          <p className="mb-2 text-xs text-slate-500">Edit this complete question object as JSON. The editor checks syntax before saving.</p>
          <textarea value={editDraft} onChange={e => setEditDraft(e.target.value)} className="min-h-56 w-full rounded border border-slate-300 p-3 font-mono text-sm" />
          <button onClick={saveEditedQuestion} className="mt-3 rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white">Save question changes</button>
        </section>}
        {status && <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">{status}</div>}

        {parsed && <>
          <section className="mb-6 rounded-xl border bg-white p-4">
            <p className="text-sm text-slate-500">Questions ready for import</p>
            <p className="text-2xl font-bold">{prepared.length}</p>
            <p className="mt-1 text-xs text-slate-500">Database payload is restricted to exam_name, exam_year, question, options and correct_answer.</p>
          </section>

          {issues.length > 0 && <section className="mb-6 rounded-xl border border-red-200 bg-red-50 p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-bold text-red-900">Question Issue Manager ({issues.length})</h2>
              <span className="text-xs text-red-800">Resolve each issue before import</span>
            </div>
            <div className="space-y-3">
              {issues.map((issue, i) => {
                const index = issue.questionIndex;
                const duplicateIndex = issue.duplicateOfIndex;
                let questions: any[] = [];
                try { questions = (parseQuestionJson(jsonText).value as { questions: any[] }).questions; } catch { /* syntax issue has no question preview */ }
                const question = index !== undefined ? questions[index] : null;
                const duplicate = duplicateIndex !== undefined ? questions[duplicateIndex] : null;
                return <div key={`${issue.path}-${i}`} className="rounded-lg border border-red-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-red-900">{issue.code === 'duplicate_question' ? 'Duplicate question' : issue.code === 'invalid_correct_answer' ? 'Correct answer mismatch' : issue.code === 'invalid_options' ? 'Options need attention' : issue.code === 'missing_question' ? 'Question text missing' : 'Data validation issue'}</p>
                      <p className="mt-1 text-xs text-slate-500">{issue.path}{index !== undefined ? ` · Question ${index + 1}` : ''}</p>
                    </div>
                    {index !== undefined && <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-800">Q{index + 1}</span>}
                  </div>
                  <p className="mt-2 text-sm text-slate-800">{issue.message}</p>
                  {question && <div className="mt-3 rounded bg-slate-50 p-3 text-sm">
                    <p className="font-medium">{question.question || '(Empty question text)'}</p>
                    {duplicate && <div className="mt-2 border-t pt-2"><p className="text-xs font-semibold text-slate-500">Matches Q{duplicateIndex! + 1}</p><p className="mt-1">{duplicate.question}</p></div>}
                  </div>}
                  {index !== undefined && <div className="mt-3 flex flex-wrap gap-2">
                    {issue.code === 'duplicate_question' && <button onClick={() => removeQuestion(index)} className="rounded bg-red-700 px-3 py-2 text-xs font-semibold text-white hover:bg-red-800">Remove Q{index + 1}</button>}
                    <button onClick={() => startEditQuestion(index)} className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Edit Q{index + 1}</button>
                  </div>}
                </div>;
              })}
            </div>
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
