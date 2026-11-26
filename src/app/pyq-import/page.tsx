'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type TaxonomyRow = { id: string; name: string; subject_id?: string; topic_id?: string };
type Taxonomy = { subjects: TaxonomyRow[]; topics: TaxonomyRow[]; subtopics: TaxonomyRow[] };
type PreparedQuestion = {
  question: string; options: any; correct_answer: any; solution_explanation: string | null;
  difficulty: string | null; subject_name: string | null; subject_id: string | null;
  topic_name: string | null; topic_id: string | null; subtopic_name: string | null;
  subtopic_id: string | null; learning_unit_name: string | null; learning_unit_id: string | null;
  question_pattern_name: string | null; question_pattern_id: string | null;
  exam_name: string; exam_year: number;
};

const norm = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase().replace(/\\s+/g, ' ');
const asObject = (value: any) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export default function PyqImportPage() {
  const [jsonText, setJsonText] = useState('');
  const [examName, setExamName] = useState('');
  const [examYear, setExamYear] = useState('');

  useEffect(() => {
    setExamYear(String(new Date().getFullYear()));
  }, []);
  const [taxonomy, setTaxonomy] = useState<Taxonomy>({ subjects: [], topics: [], subtopics: [] });
  const [prepared, setPrepared] = useState<PreparedQuestion[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [parsed, setParsed] = useState(false);
  const [importedCount, setImportedCount] = useState(0);

  async function fetchAll(table: 'subjects' | 'topics' | 'subtopics', columns: string) {
    const all: any[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase.from(table).select(columns).order('name').range(from, from + pageSize - 1);
      if (error) throw error;
      all.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return all;
  }

  async function loadTaxonomy() {
    const [subjects, topics, subtopics] = await Promise.all([
      fetchAll('subjects', 'id,name'),
      fetchAll('topics', 'id,name,subject_id'),
      fetchAll('subtopics', 'id,name,topic_id'),
    ]);
    setTaxonomy({ subjects, topics, subtopics });
    return { subjects, topics, subtopics };
  }

  function resolveByName(rows: TaxonomyRow[], name: unknown, suppliedId?: unknown) {
    const cleanName = String(name ?? '').trim();
    if (!cleanName && !suppliedId) return { row: null as TaxonomyRow | null, error: null as string | null };
    if (suppliedId) {
      const byId = rows.find(row => row.id === suppliedId);
      if (!byId) return { row: null, error: `Unknown taxonomy ID: ${suppliedId}` };
      if (cleanName && norm(byId.name) !== norm(cleanName)) return { row: null, error: `Name/ID mismatch: "${cleanName}" does not match "${byId.name}"` };
      return { row: byId, error: null };
    }
    const matches = rows.filter(row => norm(row.name) === norm(cleanName));
    if (matches.length === 1) return { row: matches[0], error: null };
    if (matches.length > 1) return { row: null, error: `Ambiguous taxonomy name: "${cleanName}"` };
    return { row: null, error: `Not found in taxonomy: "${cleanName}"` };
  }

  function parseAndValidate() {
    setIssues([]);
    setStatus('');
    setImportedCount(0);
    try {
      const cleaned = jsonText.trim().replace(/^\x60\x60\x60(?:json)?\s*/i, '').replace(/\s*\x60\x60\x60$/, '');
      const root = JSON.parse(cleaned);
      const meta = asObject(root.metadata || root.exam || root);
      const finalExamName = String(meta.exam_name || meta.examName || examName).trim();
      const rawYear = meta.exam_year ?? meta.examYear ?? examYear;
      const finalYear = Number(rawYear);
      if (!finalExamName) throw new Error('Exam name is required. Add metadata.exam_name or enter it above.');
      if (!Number.isInteger(finalYear) || finalYear < 1900 || finalYear > 2100) throw new Error('Exam year must be a valid four-digit year.');
      const rows = Array.isArray(root) ? root : (root.questions || root.pyqs || root.data);
      if (!Array.isArray(rows) || rows.length === 0) throw new Error('JSON must contain a non-empty questions array.');
      setExamName(finalExamName);
      setExamYear(String(finalYear));

      const localIssues: string[] = [];
      const staged: PreparedQuestion[] = rows.map((raw: any, index: number) => {
        const item = asObject(raw);
        const taxonomyObj = asObject(item.taxonomy);
        const subjectName = item.subject_name ?? item.subject ?? taxonomyObj.subject_name ?? taxonomyObj.subject;
        const topicName = item.topic_name ?? item.topic ?? taxonomyObj.topic_name ?? taxonomyObj.topic;
        const subtopicName = item.subtopic_name ?? item.subtopic ?? taxonomyObj.subtopic_name ?? taxonomyObj.subtopic;
        const subject = resolveByName(taxonomy.subjects, subjectName, item.subject_id ?? taxonomyObj.subject_id);
        const topic = resolveByName(taxonomy.topics, topicName, item.topic_id ?? taxonomyObj.topic_id);
        const subtopic = resolveByName(taxonomy.subtopics, subtopicName, item.subtopic_id ?? taxonomyObj.subtopic_id);
        const prefix = `Question ${index + 1}`;
        if (subject.error) localIssues.push(`${prefix}: ${subject.error}`);
        if (topic.error) localIssues.push(`${prefix}: ${topic.error}`);
        if (subtopic.error) localIssues.push(`${prefix}: ${subtopic.error}`);
        if (subject.row && topic.row && topic.row.subject_id !== subject.row.id) localIssues.push(`${prefix}: topic does not belong to selected subject.`);
        if (topic.row && subtopic.row && subtopic.row.topic_id !== topic.row.id) localIssues.push(`${prefix}: subtopic does not belong to selected topic.`);
        const question = String(item.question ?? item.question_text ?? '').trim();
        if (!question) localIssues.push(`${prefix}: question text is missing.`);
        const options = item.options ?? [];
        if (!Array.isArray(options) && (typeof options !== 'object' || options === null)) localIssues.push(`${prefix}: options must be an array or object.`);
        return {
          question, options, correct_answer: item.correct_answer ?? item.answer ?? null,
          solution_explanation: item.solution_explanation ?? item.explanation ?? item.solution ?? null,
          difficulty: item.difficulty ?? null,
          subject_name: subject.row?.name ?? (subjectName ? String(subjectName).trim() : null), subject_id: subject.row?.id ?? null,
          topic_name: topic.row?.name ?? (topicName ? String(topicName).trim() : null), topic_id: topic.row?.id ?? null,
          subtopic_name: subtopic.row?.name ?? (subtopicName ? String(subtopicName).trim() : null), subtopic_id: subtopic.row?.id ?? null,
          learning_unit_name: item.learning_unit_name ?? item.learning_unit ?? null,
          learning_unit_id: item.learning_unit_id ?? null,
          question_pattern_name: item.question_pattern_name ?? item.question_pattern ?? null,
          question_pattern_id: item.question_pattern_id ?? null,
          exam_name: finalExamName, exam_year: finalYear,
        };
      });
      const seen = new Set<string>();
      staged.forEach((q, index) => {
        const key = norm(q.question);
        if (seen.has(key)) localIssues.push(`Question ${index + 1}: duplicate question inside this JSON payload.`);
        seen.add(key);
      });
      setPrepared(staged);
      setIssues(localIssues);
      setParsed(true);
      setStatus(localIssues.length ? 'Review required: resolve all mapping and validation issues before importing.' : `Validated ${staged.length} questions. Review the preview, then import.`);
    } catch (error: any) {
      setPrepared([]);
      setParsed(false);
      setStatus(error.message || 'Could not parse JSON.');
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
          .select('question').eq('exam_name', examName).eq('exam_year', Number(examYear)).in('question', chunk);
        if (error) throw error;
        existing.push(...(data || []).map((row: any) => row.question));
      }
      const existingSet = new Set(existing.map(norm));
      const toInsert = prepared.filter(q => !existingSet.has(norm(q.question)));
      if (!toInsert.length) {
        setStatus('Nothing imported: all questions already exist for this exam and year.');
        setImportedCount(0);
        return;
      }
      let inserted = 0;
      for (let i = 0; i < toInsert.length; i += 100) {
        const { error } = await supabase.from('previous_year_questions').insert(toInsert.slice(i, i + 100));
        if (error) throw error;
        inserted += Math.min(100, toInsert.length - i);
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

  const summary = useMemo(() => ({
    total: prepared.length,
    mapped: prepared.filter(q => q.subject_id && q.topic_id && q.subtopic_id).length,
    missing: prepared.filter(q => !q.subject_id || !q.topic_id || !q.subtopic_id).length,
  }), [prepared]);

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-800 md:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-wider text-blue-700">SSC Knowledge Studio</p>
          <h1 className="mt-1 text-3xl font-extrabold text-slate-900">PYQ JSON Import</h1>
          <p className="mt-2 text-slate-600">Paste Gemini's structured output, validate taxonomy mapping, preview records, and import them into Previous Year Questions.</p>
        </div>

        <section className="mb-6 grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-3">
          <label className="text-sm font-semibold text-slate-700">Exam name
            <input value={examName} onChange={e => setExamName(e.target.value)} placeholder="e.g. SSC CHSL Tier-I" className="mt-2 w-full rounded-lg border border-slate-300 p-3 font-normal outline-none focus:border-blue-500" />
          </label>
          <label className="text-sm font-semibold text-slate-700">Exam year
            <input type="number" min="1900" max="2100" value={examYear} onChange={e => setExamYear(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 p-3 font-normal outline-none focus:border-blue-500" />
          </label>
          <div className="flex flex-col justify-end">
            <button onClick={async () => { setLoading(true); try { await loadTaxonomy(); setStatus('Taxonomy refreshed from Supabase.'); } catch (e: any) { setStatus(e.message); } finally { setLoading(false); } }} disabled={loading} className="rounded-lg border border-slate-300 px-4 py-3 font-semibold hover:bg-slate-50 disabled:opacity-50">
              {loading ? 'Loading…' : 'Refresh taxonomy'}
            </button>
          </div>
        </section>

        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">1. Gemini JSON</h2>
            <span className="text-xs text-slate-500">Accepts a JSON object with metadata and questions[]</span>
          </div>
          <textarea value={jsonText} onChange={e => { setJsonText(e.target.value); setParsed(false); setPrepared([]); setIssues([]); }} placeholder={'Paste Gemini response here…\n\n{\n  "metadata": { "exam_name": "SSC CHSL Tier-I", "exam_year": 2024 },\n  "questions": [\n    { "question": "...", "options": ["A", "B", "C", "D"], "correct_answer": "B", "subject": "Mathematics", "topic": "Number System", "subtopic": "..." }\n  ]\n}'} className="min-h-[320px] w-full rounded-lg border border-slate-300 bg-slate-50 p-4 font-mono text-sm outline-none focus:border-blue-500" />
          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={async () => { setLoading(true); try { await loadTaxonomy(); setStatus('Taxonomy loaded.'); } catch (e: any) { setStatus(e.message); } finally { setLoading(false); } }} disabled={loading} className="rounded-lg border border-slate-300 px-5 py-3 font-semibold hover:bg-slate-50 disabled:opacity-50">Load taxonomy</button>
            <button onClick={parseAndValidate} disabled={loading || !jsonText.trim()} className="rounded-lg bg-blue-700 px-5 py-3 font-semibold text-white hover:bg-blue-800 disabled:opacity-50">Parse & validate</button>
          </div>
        </section>

        {status && <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">{status}</div>}

        {parsed && <>
          <section className="mb-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-white p-4"><p className="text-sm text-slate-500">Questions parsed</p><p className="text-2xl font-bold">{summary.total}</p></div>
            <div className="rounded-xl border bg-white p-4"><p className="text-sm text-slate-500">Fully taxonomy mapped</p><p className="text-2xl font-bold text-emerald-700">{summary.mapped}</p></div>
            <div className="rounded-xl border bg-white p-4"><p className="text-sm text-slate-500">Incomplete mappings</p><p className="text-2xl font-bold text-amber-700">{summary.missing}</p></div>
          </section>
          {issues.length > 0 && <section className="mb-6 rounded-xl border border-red-200 bg-red-50 p-5">
            <h2 className="mb-2 font-bold text-red-900">Validation issues ({issues.length})</h2>
            <ul className="max-h-64 list-disc space-y-1 overflow-auto pl-5 text-sm text-red-800">{issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>
            <p className="mt-3 text-xs text-red-700">No records will be imported until every issue is resolved. Names must match the existing taxonomy; this tool does not invent or silently create taxonomy entries.</p>
          </section>}
          <section className="mb-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
              <div><h2 className="text-lg font-bold">2. Import preview</h2><p className="text-sm text-slate-500">{examName} · {examYear}</p></div>
              <button onClick={handleImport} disabled={loading || issues.length > 0 || prepared.length === 0} className="rounded-lg bg-emerald-700 px-6 py-3 font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300">{loading ? 'Importing…' : 'Confirm & import PYQs'}</button>
            </div>
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full min-w-[1050px] text-left text-sm">
                <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-600"><tr><th className="p-3">#</th><th className="p-3">Question</th><th className="p-3">Subject</th><th className="p-3">Topic</th><th className="p-3">Subtopic</th><th className="p-3">Answer</th><th className="p-3">Difficulty</th></tr></thead>
                <tbody>{prepared.map((q, i) => <tr key={i} className="border-t align-top"><td className="p-3">{i + 1}</td><td className="max-w-md whitespace-pre-wrap p-3">{q.question}</td><td className="p-3">{q.subject_name || '—'}</td><td className="p-3">{q.topic_name || '—'}</td><td className="p-3">{q.subtopic_name || '—'}</td><td className="p-3">{typeof q.correct_answer === 'string' ? q.correct_answer : JSON.stringify(q.correct_answer)}</td><td className="p-3">{q.difficulty || '—'}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        </>}
      </div>
    </main>
  );
}
