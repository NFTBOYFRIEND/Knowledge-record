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

const norm = (value: unknown) => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const asObject = (value: any) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

const EXTRACTION_PROMPT = "ROLE: SSC PREVIOUS YEAR QUESTION PAPER (PYQ) — COMPLETE EXTRACTION AND TAXONOMY MAPPING ENGINE\nYou are an expert SSC examination analyst, question-paper extraction specialist, taxonomy mapper, and structured database data-preparation engine.\nYour task is to examine the ENTIRE uploaded Previous Year Question Paper PDF and the uploaded Mock_Madness_Taxonomy.xlsx workbook.\nYou must extract EVERY question from the PDF, classify every question using the existing taxonomy, and produce complete, accurate, database-ready JSON for my SSC Knowledge Studio / Mock Madness application.\nTHIS IS A COMPLETE PAPER EXTRACTION TASK, NOT A SAMPLE EXTRACTION TASK.\nDo not extract only 10, 20, 50, or any arbitrary number of questions. Process the entire PDF from the first page to the last page, including every section, question, and continuation page.\nExtraction completeness is mandatory.\n\n1. SOURCE DOCUMENTS\nYou MUST use both uploaded files.\nSOURCE A — PREVIOUS YEAR QUESTION PAPER PDF\nThis is the authoritative source for:\n- Original question wording\n- Question numbers\n- Answer options\n- Passages and comprehension material\n- Mathematical expressions and diagrams\n- Tables, sequences, and visual information\n- Exam name and year\n- Tier, shift, exam date, and paper details\n- Answer key, if included\n- Source page numbers\nRead the complete PDF, not just the first few pages.\nSOURCE B — Mock_Madness_Taxonomy.xlsx\nThis is the authoritative source for question classification.\nIt contains:\n- Subjects\n- Topics\n- Subtopics\n- Complete Hierarchy\n- Summary\nUse the Complete Hierarchy sheet to understand the exact relationship:\nSUBJECT → TOPIC → SUBTOPIC\nUse the individual taxonomy sheets to verify exact names.\nNever create a new subject, topic, or subtopic.\nNever invent a taxonomy UUID.\n\n2. COMPLETE PDF EXTRACTION — HIGHEST PRIORITY\nYou MUST process every page of the uploaded PDF.\nFollow this procedure:\nStep 1: Inspect the entire document\n- Determine the total number of PDF pages.\n- Identify all examination sections.\n- Identify the first and last question numbers.\n- Identify section-wise question numbering.\n- Identify whether any questions continue onto another page.\n- Identify passages, shared data, diagrams, tables, and image-based questions.\nStep 2: Extract every question\nExtract every actual examination question, including:\n- Mathematics / Quantitative Aptitude\n- General Intelligence and Reasoning\n- English Language\n- General Awareness / General Studies\n- Computer Knowledge\n- Odia Language\n- Any other section present in the supplied paper\nDo not assume the paper contains only four subjects.\nDo not skip questions because they appear difficult, repetitive, lengthy, or image-based.\nDo not skip questions appearing at the bottom of pages.\nDo not skip questions in tables or passages.\nStep 3: Preserve question numbering\n- Preserve the original question number.\n- Do not restart numbering between batches.\n- If different sections have separate numbering, preserve both section and original question number.\n- Do not renumber questions simply to make the JSON sequential.\nStep 4: Preserve source content\n- Preserve the original wording as accurately as possible.\n- Preserve numerical values and mathematical symbols.\n- Preserve units, percentages, fractions, ratios, equations, and dates.\n- Preserve all answer options.\n- For passage-based questions, include the necessary passage context so that each question remains understandable independently.\n- For image-based questions, describe the relevant visual information only when it can be reliably interpreted.\n- If something is unreadable, mark it as uncertain. Never guess.\nStep 5: Count everything\nBefore generating the final JSON, establish:\n- Total number of actual questions present in the PDF.\n- Total number of questions extracted.\n- Number of questions extracted from each section.\n- Number of questions that could not be fully interpreted.\nYour extracted question count MUST match the actual question count in the source document.\nIf the PDF contains 100 questions, the output must account for all 100 questions.\nIf the PDF contains 200 questions, the output must account for all 200 questions.\nDo not stop at 20 questions.\nDo not return a partial sample as if it were the complete paper.\n\n3. TAXONOMY MAPPING\nFor every question, identify:\n- subject_name\n- topic_name\n- subtopic_name\nUse exact names from the uploaded Excel workbook.\nFollow this hierarchy:\nSUBJECT → TOPIC → SUBTOPIC\nMandatory rules\n1. The topic must belong to the selected subject.\n2. The subtopic must belong to the selected topic.\n3. Use exact spelling and capitalization from the workbook.\n4. Prefer active taxonomy entries (*_active = TRUE) when a suitable match exists.\n5. Do not select an inactive entry when an active equivalent exists.\n6. Use the most specific matching subtopic.\n7. Do not force an incorrect mapping.\n8. If a reliable mapping is unavailable, use null for the uncertain taxonomy name and explain why in mapping_notes.\n9. If multiple mappings are possible, choose the best-supported one and explain the ambiguity.\n10. Never invent taxonomy entries.\nCRITICAL: DO NOT GENERATE UUIDS\nThe application retrieves the actual taxonomy UUIDs directly from Supabase using the taxonomy names.\nTherefore:\n- DO NOT generate subject_id.\n- DO NOT generate topic_id.\n- DO NOT generate subtopic_id.\n- DO NOT copy imaginary UUIDs from examples.\n- DO NOT fabricate UUIDs that look realistic.\n- DO NOT use placeholder UUIDs.\n- DO NOT attempt to calculate or reconstruct IDs.\nOnly return the exact taxonomy names.\nFor example:\n\"subject_name\": \"Mathematics\",\n\"topic_name\": \"HCF & LCM\",\n\"subtopic_name\": \"Grouping & Distribution Applications\"\nThese names must be verified against the uploaded workbook.\n\n4. ANSWERS AND EXPLANATIONS\nFor every question:\nCorrect answer\nUse the following priority:\n1. Official answer key included in the uploaded source.\n2. Independently solve the question if the answer key is unavailable.\n3. If the answer cannot be determined confidently, use null.\nUse these answer_source values:\n- source_answer_key\n- independently_solved\n- uncertain\nNever fabricate a correct answer.\nSolution explanation\nProvide a clear and concise explanation whenever the answer is known.\nFor Mathematics:\n- Show the relevant formula.\n- Show calculations step by step.\n- Explain the final answer.\nFor Reasoning:\n- Explain the logical sequence.\n- Show the relevant deduction.\nFor English:\n- Explain the applicable grammar, vocabulary, or comprehension rule.\nFor General Studies:\n- Explain the factual basis.\n- Do not add unsupported historical or scientific claims.\nFor Computer Knowledge:\n- Explain the relevant technical concept.\nFor Odia Language:\n- Explain the applicable language or grammar concept where possible.\n### Difficulty\n\nUse only these exact values:\n\n- easy\n- moderate\n- hard\n\nDo not use \"medium\". The database accepts \"moderate\" instead.\n\nIf difficulty cannot be reasonably assessed, use null.\n\n5. EXAM METADATA\nAt the root of the JSON, include a metadata object.\nExtract all available information:\n- exam_name\n- exam_year\n- exam_tier\n- exam_date\n- shift\n- paper_name\n- source_file\n- source_pages\n- language\nRules:\n- Use the exact examination identity.\n- Use a numeric value for exam_year.\n- Use null when information is unavailable.\n- Never guess the exam year or shift.\n- Do not combine different examination papers under one identity.\n- If the PDF contains multiple distinct papers or shifts, keep their identities separate. Produce separate JSON objects if necessary.\n\n6. REQUIRED JSON STRUCTURE\nReturn one valid JSON object in the following structure:\n{\n\"metadata\": {\n\"exam_name\": \"OSSSC Combined Recruitment Examination 2023 IV\",\n\"exam_year\": 2023,\n\"exam_tier\": null,\n\"exam_date\": null,\n\"shift\": null,\n\"paper_name\": null,\n\"source_file\": \"uploaded_question_paper.pdf\",\n\"source_pages\": [],\n\"language\": \"English\"\n},\n\"questions\": [\n{\n\"question_number\": 1,\n\"question\": \"Full original question text\",\n\"options\": [\n\"Option A\",\n\"Option B\",\n\"Option C\",\n\"Option D\"\n],\n\"correct_answer\": \"Option B\",\n\"answer_source\": \"source_answer_key\",\n\"solution_explanation\": \"Step-by-step explanation.\",\n\"difficulty\": \"medium\",\n  \"subject_name\": \"Mathematics\",\n  \"topic_name\": \"HCF & LCM\",\n  \"subtopic_name\": \"Exact subtopic name from workbook\",\n\n  \"learning_unit_name\": null,\n  \"learning_unit_id\": null,\n\n  \"question_pattern_name\": null,\n  \"question_pattern_id\": null,\n\n  \"mapping_confidence\": \"high\",\n  \"mapping_notes\": null,\n\n  \"source_page\": 1,\n  \"source_question_number\": \"1\",\n  \"extraction_status\": \"verified\"\n}\n],\n\"extraction_summary\": {\n\"pdf_total_pages\": 0,\n\"total_questions_found\": 0,\n\"total_questions_extracted\": 0,\n\"successfully_mapped\": 0,\n\"unmapped_questions\": 0,\n\"uncertain_questions\": 0,\n\"answer_key_available\": false,\n\"extraction_complete\": true\n}\n}\nRepeat the question object for EVERY question in the PDF.\nThe example above is only a schema example. It does not limit the number of questions.\nDo not copy example values unless they are supported by the actual uploaded documents.\n\n7. DATABASE COMPATIBILITY RULES\nThe JSON will be pasted into my application's PYQ JSON Import page.\nThe importer recognizes:\n- metadata.exam_name\n- metadata.exam_year\n- questions[]\n- question\n- options\n- correct_answer\n- solution_explanation\n- difficulty\n- subject_name\n- topic_name\n- subtopic_name\n- learning_unit_name\n- learning_unit_id\n- question_pattern_name\n- question_pattern_id\nFollow these rules:\n1. Keep field names exactly as written.\n2. Keep options as an array.\n3. Use numeric exam_year.\n4. Use valid JSON.\n5. Use null for unavailable optional fields.\n6. Do not use empty strings for missing values.\n7. Do not generate taxonomy IDs.\n8. Keep learning unit and question pattern fields null unless their exact authoritative names and IDs are available.\n9. Do not rename required fields.\n10. Do not include comments inside JSON.\n11. Do not include Markdown fences around the final JSON.\nAdditional metadata may be included, but do not replace the required fields.\n\n8. COMPLETE EXTRACTION QUALITY CONTROL\nBefore returning the result, perform all checks below.\nPDF completeness\n- Every PDF page has been inspected.\n- Every examination section has been processed.\n- Every actual question has been extracted.\n- Question numbering has been checked.\n- Questions at page boundaries have not been skipped.\n- Passage-based questions have been included.\n- Image-based questions have been checked.\n- Total extracted questions match the PDF's actual question count.\nTaxonomy validation\n- Every subject name exists in the workbook.\n- Every topic name exists in the workbook.\n- Every subtopic name exists in the workbook.\n- Every topic belongs to its selected subject.\n- Every subtopic belongs to its selected topic.\n- No taxonomy UUID has been invented.\n- Uncertain mappings are explicitly marked.\nQuestion validation\n- Every question has non-empty question text.\n- All available options are preserved.\n- Correct answers are supported.\n- Explanations are logically correct.\n- Difficulty values use the permitted values.\n- No duplicate extraction has occurred.\nJSON validation\n- The output is syntactically valid JSON.\n- All questions use the same schema.\n- Exam metadata is consistent.\n- Summary counts match the actual extracted data.\n- extraction_complete is true only when the entire PDF has been processed.\n\n9. VERY IMPORTANT: OUTPUT LENGTH AND BATCH PROCESSING\nA large PDF may contain more questions than can fit in one response.\nIf you encounter response-length limitations, DO NOT silently truncate the output.\nInstead, process the complete paper in sequential batches.\nFor example:\n- Batch 1: Questions 1–40\n- Batch 2: Questions 41–80\n- Batch 3: Questions 81–120\n- Continue until the final question.\nThe batch size is flexible. It must be determined by the actual output capacity, not by an arbitrary limit.\nBatch rules\n1. Process all questions in the PDF.\n2. Preserve the original question numbering.\n3. Never restart numbering.\n4. Keep the same exam metadata in every batch.\n5. Keep exactly the same question-object schema.\n6. Never repeat questions from previous batches.\n7. Maintain a running extraction count.\n8. Clearly state the first and last question number in each batch.\n9. State how many questions remain.\n10. Do not claim the extraction is complete until the final batch has been generated.\nEach batch must be valid JSON.\nUse this batch wrapper:\n{\n\"metadata\": {\n\"exam_name\": \"Exact exam name\",\n\"exam_year\": 2023,\n\"exam_tier\": null,\n\"exam_date\": null,\n\"shift\": null,\n\"paper_name\": null,\n\"source_file\": \"uploaded_question_paper.pdf\",\n\"source_pages\": [],\n\"language\": \"English\"\n},\n\"batch_info\": {\n\"batch_number\": 1,\n\"first_question_number\": 1,\n\"last_question_number\": 40,\n\"questions_in_batch\": 40,\n\"total_questions_in_pdf\": 120,\n\"remaining_questions\": 80,\n\"final_batch\": false\n},\n\"questions\": []\n}\nThe questions array must contain the complete question objects described above.\nFor the final batch:\n- Set final_batch to true.\n- Set remaining_questions to 0.\n- Include the final extraction summary.\n- Set extraction_complete to true only after verifying that every question has been accounted for.\nIf the interface supports continuing the response, continue automatically until all batches are delivered. Otherwise, explicitly ask me to continue with the next batch. Never pretend that a partial batch is the complete paper.\n\n10. FINAL OBJECTIVE\nYour task is to convert the entire SSC previous-year question paper into an accurate, complete, taxonomy-mapped dataset.\nYou are NOT generating new practice questions.\nYou are NOT producing a sample.\nYou are NOT extracting only the first 20 questions.\nYou MUST account for EVERY question in the uploaded PDF.\nSource accuracy, complete extraction, correct taxonomy mapping, and valid JSON are more important than response speed.\nBegin by inspecting the entire PDF and taxonomy workbook. Determine the actual question count before extraction.\nThen process the paper from beginning to end, in sequential batches if necessary.\nDo not claim completion until the final question has been extracted and checked.";

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

  // Resolve each taxonomy level inside its selected parent. Names can repeat
  // under different parents, so never look up topics/subtopics globally.
  // Missing taxonomy entries remain publishable with null IDs for manual
  // creation in Supabase; only a supplied but contradictory hierarchy blocks.
  function resolveSubject(rows: TaxonomyRow[], name: unknown) {
    const cleanName = String(name ?? '').trim();
    if (!cleanName) return { row: null as TaxonomyRow | null, error: null as string | null };
    const matches = rows.filter(row => norm(row.name) === norm(cleanName));
    if (matches.length === 1) return { row: matches[0], error: null as string | null };
    if (matches.length > 1) return { row: null, error: `Ambiguous subject name: "${cleanName}"` };
    return { row: null, error: null };
  }

  function resolveChild(rows: TaxonomyRow[], name: unknown, parentId: string | null, parentField: 'subject_id' | 'topic_id', label: string) {
    const cleanName = String(name ?? '').trim();
    if (!cleanName || !parentId) return { row: null as TaxonomyRow | null, error: null as string | null };
    const matches = rows.filter(row => row[parentField] === parentId && norm(row.name) === norm(cleanName));
    if (matches.length === 1) return { row: matches[0], error: null as string | null };
    if (matches.length > 1) return { row: null, error: `Ambiguous ${label} "${cleanName}" under the selected parent.` };
    return { row: null, error: null };
  }

  async function parseAndValidate() {
    setIssues([]);
    setStatus('');
    setImportedCount(0);
    setLoading(true);
    setStatus('Checking Supabase taxonomy…');
    try {
      const activeTaxonomy = taxonomy.subjects.length && taxonomy.topics.length && taxonomy.subtopics.length
        ? taxonomy
        : await loadTaxonomy();
      if (!activeTaxonomy.subjects.length || !activeTaxonomy.topics.length || !activeTaxonomy.subtopics.length) {
        throw new Error(`Taxonomy load incomplete: subjects ${activeTaxonomy.subjects.length}, topics ${activeTaxonomy.topics.length}, subtopics ${activeTaxonomy.subtopics.length}. Check Supabase read access.`);
      }
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
        const subject = resolveSubject(activeTaxonomy.subjects, subjectName);
        const topic = resolveChild(activeTaxonomy.topics, topicName, subject.row?.id ?? null, 'subject_id', 'topic');
        const subtopic = resolveChild(activeTaxonomy.subtopics, subtopicName, topic.row?.id ?? null, 'topic_id', 'subtopic');
        const prefix = `Question ${index + 1}`;
        if (subject.error) localIssues.push(`${prefix}: ${subject.error}`);
        if (topic.error) localIssues.push(`${prefix}: ${topic.error}`);
        if (subtopic.error) localIssues.push(`${prefix}: ${subtopic.error}`);
        const question = String(item.question ?? item.question_text ?? '').trim();
        if (!question) localIssues.push(`${prefix}: question text is missing.`);
        const rawDifficulty = item.difficulty == null ? null : norm(item.difficulty);
        const difficulty = rawDifficulty === 'medium' ? 'moderate' : rawDifficulty;
        if (difficulty !== null && !['easy', 'moderate', 'hard'].includes(difficulty)) {
          localIssues.push(`${prefix}: invalid difficulty "${item.difficulty}". Use easy, moderate, hard, or null.`);
        }
        const options = item.options ?? [];
        if (!Array.isArray(options) && (typeof options !== 'object' || options === null)) localIssues.push(`${prefix}: options must be an array or object.`);
        return {
          question, options, correct_answer: item.correct_answer ?? item.answer ?? null,
          solution_explanation: item.solution_explanation ?? item.explanation ?? item.solution ?? null,
          difficulty: difficulty,
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
      setStatus(localIssues.length ? `Taxonomy loaded (${activeTaxonomy.subjects.length} subjects, ${activeTaxonomy.topics.length} topics, ${activeTaxonomy.subtopics.length} subtopics). Some taxonomy names are not yet in Supabase. Those questions can still be imported with their names preserved and null taxonomy IDs for manual mapping.` : `Validated ${staged.length} questions using ${activeTaxonomy.subjects.length} subjects, ${activeTaxonomy.topics.length} topics, and ${activeTaxonomy.subtopics.length} subtopics. Review the preview, then import.`);
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
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider text-blue-700">SSC Knowledge Studio</p>
              <h1 className="mt-1 text-3xl font-extrabold text-slate-900">PYQ JSON Import</h1>
            </div>
            <button onClick={copyExtractionPrompt} className="rounded-lg bg-indigo-700 px-5 py-3 font-semibold text-white shadow-sm hover:bg-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">
              {promptCopied ? 'Copied to clipboard ✓' : 'Copy complete extraction prompt'}
            </button>
          </div>
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
            <p className="mt-3 text-xs text-red-700">Only data-validation issues block import. Missing topic/subtopic names are preserved in the imported record with null IDs so you can create and map them manually in Supabase.</p>
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
