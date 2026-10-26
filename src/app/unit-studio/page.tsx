'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// Bulletproof helper to fetch every single row, stabilize pagination, and deduplicate
async function fetchAllRows(table: string, select: string, orderBy: string = 'id') {
  let allData: any[] = [];
  let from = 0;
  const limit = 1000;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order(orderBy)
      .order('id', { ascending: true }) 
      .range(from, from + limit - 1);

    if (error) throw new Error(`Error fetching ${table}: ${error.message}`);
    
    allData = allData.concat(data || []);
    
    if (!data || data.length < limit) {
      break; 
    }
    from += limit;
  }
  
  // Deduplicator requires the 'id' field to be present in the select string
  const uniqueData = Array.from(new Map(allData.map(item => [item.id, item])).values());
  return uniqueData;
}

export default function SingleUnitStudio() {
  // Master Filtered Data
  const [allSubjects, setAllSubjects] = useState<any[]>([]);
  const [allTopics, setAllTopics] = useState<any[]>([]);
  const [allSubtopics, setAllSubtopics] = useState<any[]>([]);
  const [allUnits, setAllUnits] = useState<any[]>([]);

  // Active Dropdown Options
  const [activeSubjects, setActiveSubjects] = useState<any[]>([]);
  const [activeTopics, setActiveTopics] = useState<any[]>([]);
  const [activeSubtopics, setActiveSubtopics] = useState<any[]>([]);
  const [activeUnits, setActiveUnits] = useState<any[]>([]);

  // Selection States
  const [subjectId, setSubjectId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [subtopicId, setSubtopicId] = useState('');
  const [unitId, setUnitId] = useState('');

  // Passage & Processing States
  const [passage, setPassage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [loadingTree, setLoadingTree] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // AI Proposed States
  const [proposedRecords, setProposedRecords] = useState<any[]>([]);
  const [proposedPatterns, setProposedPatterns] = useState<any[]>([]);
  const [proposedProfiles, setProposedProfiles] = useState<any[]>([]);

  async function fetchPendencyTree() {
    setLoadingTree(true);
    try {
      // 1. Fetch absolutely everything. CRITICAL FIX: Include 'id' in knowledge_records select.
      const [krRes, uRes, stRes, tRes, sRes] = await Promise.all([
        fetchAllRows('knowledge_records', 'id, learning_unit_id'), // <-- Fixed here
        fetchAllRows('learning_units', 'id, name, subtopic_id', 'sequence'),
        fetchAllRows('subtopics', 'id, name, topic_id', 'sequence'),
        fetchAllRows('topics', 'id, name, subject_id', 'sequence'),
        fetchAllRows('subjects', 'id, name', 'name')
      ]);

      // 2. Identify occupied units
      const occupiedIds = new Set(krRes.map(r => r.learning_unit_id));

      // 3. Filter units to keep ONLY empty ones
      const emptyUnits = uRes.filter(u => !occupiedIds.has(u.id));
      const validSubtopicIds = new Set(emptyUnits.map(u => u.subtopic_id));

      // 4. Keep Subtopics that have at least one empty unit
      const validSubtopics = stRes.filter(s => validSubtopicIds.has(s.id));
      const validTopicIds = new Set(validSubtopics.map(s => s.topic_id));

      // 5. Keep Topics that have at least one valid subtopic
      const validTopics = tRes.filter(t => validTopicIds.has(t.id));
      const validSubjectIds = new Set(validTopics.map(t => t.subject_id));

      // 6. Keep Subjects that have at least one valid topic
      const validSubjects = sRes.filter(s => validSubjectIds.has(s.id));

      setAllSubjects(validSubjects);
      setAllTopics(validTopics);
      setAllSubtopics(validSubtopics);
      setAllUnits(emptyUnits);

      setActiveSubjects(validSubjects);

      // Clear invalid selections
      if (!validTopicIds.has(topicId)) setTopicId('');
      if (!validSubtopicIds.has(subtopicId)) setSubtopicId('');
      if (!emptyUnits.find(u => u.id === unitId)) setUnitId('');

    } catch (err: any) {
      setError(`Error loading curriculum: ${err.message}`);
    } finally {
      setLoadingTree(false);
    }
  }

  useEffect(() => {
    fetchPendencyTree();
  }, []);

  // Client-side cascading dropdown logic
  useEffect(() => {
    if (subjectId) setActiveTopics(allTopics.filter(t => t.subject_id === subjectId));
    else { setActiveTopics([]); setTopicId(''); }
  }, [subjectId, allTopics]);

  useEffect(() => {
    if (topicId) setActiveSubtopics(allSubtopics.filter(s => s.topic_id === topicId));
    else { setActiveSubtopics([]); setSubtopicId(''); }
  }, [topicId, allSubtopics]);

  useEffect(() => {
    if (subtopicId) setActiveUnits(allUnits.filter(u => u.subtopic_id === subtopicId));
    else { setActiveUnits([]); setUnitId(''); }
  }, [subtopicId, allUnits]);

  
const handleCopyPrompt = async () => {
  const topicName =
    activeTopics.find(t => t.id === topicId)?.name || "Selected Topic";

  const subtopicName =
    activeSubtopics.find(s => s.id === subtopicId)?.name || "Selected Subtopic";

  const unitName =
    activeUnits.find(u => u.id === unitId)?.name || "Selected Unit";

  if (!unitId) {
    alert("Please select a Learning Unit first.");
    return;
  }

  const promptText = `You are an expert SSC CHSL curriculum knowledge extractor and MCQ pattern designer.

YOUR TASK
Analyze all supplied textbook images and extract concise, high-yield, source-supported information for the selected Learning Unit only.

TARGET CURRICULUM
- Examination: SSC_CHSL
- Topic: ${topicName}
- Subtopic: ${subtopicName}
- Target Learning Unit: ${unitName}
- Target Learning Unit ID: ${unitId}

1. STRICT RELEVANCE FILTER

First determine the intended scope of the selected Learning Unit from its name, topic and subtopic.

Extract only facts that genuinely belong to this unit.

Do not summarize the entire chapter.
Do not force unrelated facts into this unit.
Do not include information merely because it contains similar keywords.
Do not create new Learning Units.
Do not invent Learning Unit IDs.

If a fact primarily belongs to another Learning Unit, exclude it.

If no relevant facts exist, return empty arrays for all three output collections.

2. SOURCE ACCURACY

- Read every supplied image, including paragraphs, headings, tables, diagrams, maps, captions and footnotes.
- Use only information supported by the supplied images.
- Do not guess illegible text or fill missing information using memory or outside knowledge.
- Preserve exact names, dates, locations, terminology, numerical values and relationships.
- Preserve qualifications when the textbook presents an interpretation as uncertain or disputed.
- Distinguish explicit facts from interpretations.
- Do not invent people, events, texts, institutions, dates or archaeological findings.
- Remove duplicate facts.
- Do not claim that a fact is from an SSC previous-year question unless evidence is provided.

3. KNOWLEDGE RECORDS

Create one record containing the relevant high-yield bullet points for the selected Learning Unit.

Every record must use this exact ID:
"${unitId}"

Allowed record_type values:
formula, definition, fact, rule, method, example, explanation, other.

Use "fact" for ordinary historical facts.

Each bullet must be:
- Concise and self-contained.
- Accurate and supported by the source.
- Useful for answering an objective examination question.
- Specific enough to distinguish the correct answer from plausible alternatives.
- Free from repetition and unsupported claims.

Do not create empty records. If no relevant information exists, return an empty proposedRecords array.

4. MCQ PATTERNS

Generate only question patterns supported by the extracted facts.

Use suitable patterns such as:
- Direct factual recall.
- Identification.
- Matching.
- Chronological ordering.
- Classification.
- Correct or incorrect statement identification.
- Multiple-statement evaluation.
- Comparison or evidence-based interpretation.

Generate only distinct, useful patterns. Do not create redundant patterns merely to increase their number.

Every pattern must:
- Use learning_unit_id "${unitId}".
- Have a unique mock_id, such as p1, p2 or p3.
- Include name, description, easy_definition, moderate_definition, hard_definition and example_pattern.
- Include generation_rules.pattern_type.
- Include generation_rules.target_exams as ["SSC_CHSL"].
- Include required_operations as an array of relevant operations.
- Be answerable using the extracted source-supported knowledge.

Do not invent facts or unsupported distractors.

If no valid patterns can be generated, return an empty proposedPatterns array.

5. DIFFICULTY PROFILES

For every generated pattern, create exactly three profiles:
- easy
- moderate
- hard

Every profile's pattern_mock_id must match an existing pattern's mock_id exactly.

Difficulty guidance:
- easy: Direct recall of one explicit fact.
- moderate: Contextual recall, matching or comparison of supported facts.
- hard: Multi-statement evaluation or evidence-based reasoning supported by the source.

Every profile must include:
pattern_mock_id, level, steps_required, concept_count,
calculation_complexity, wording_complexity, decoding_complexity,
target_time_seconds and generation_constraints.

Database constraints:
- level must be exactly easy, moderate or hard.
- steps_required, concept_count and target_time_seconds must be positive integers.
- calculation_complexity, wording_complexity and decoding_complexity must be integers from 1 to 5.
- Use calculation_complexity 1 for ordinary history questions.
- Increase difficulty through reasoning, not confusing wording.
- Do not create profiles for nonexistent patterns.

If proposedPatterns is empty, proposedProfiles must also be empty.

6. REQUIRED OUTPUT FORMAT

Return only one valid JSON object with exactly these three top-level keys:

{
  "proposedRecords": [
    {
      "learning_unit_id": "${unitId}",
      "record_type": "fact",
      "title": "Specific High-Yield Record Title",
      "content": {
        "bullet_points": [
          "A precise, source-supported fact."
        ]
      }
    }
  ],
  "proposedPatterns": [
    {
      "learning_unit_id": "${unitId}",
      "mock_id": "p1",
      "name": "Identification and Recall",
      "description": "Identify a correct answer using the extracted facts.",
      "easy_definition": "Direct recall of one fact.",
      "moderate_definition": "Contextual recall of related facts.",
      "hard_definition": "Evaluate multiple supported statements.",
      "example_pattern": "Which statement about the extracted topic is correct?",
      "generation_rules": {
        "pattern_type": "Fact Retrieval",
        "target_exams": ["SSC_CHSL"],
        "factual_grounding": "Use only extracted source-supported facts."
      },
      "required_operations": ["recall_fact"]
    }
  ],
  "proposedProfiles": [
    {
      "pattern_mock_id": "p1",
      "level": "easy",
      "steps_required": 1,
      "concept_count": 1,
      "calculation_complexity": 1,
      "wording_complexity": 1,
      "decoding_complexity": 1,
      "target_time_seconds": 30,
      "generation_constraints": {
        "wording": "direct",
        "factual_grounding": "Use only extracted source-supported facts."
      }
    },
    {
      "pattern_mock_id": "p1",
      "level": "moderate",
      "steps_required": 2,
      "concept_count": 2,
      "calculation_complexity": 1,
      "wording_complexity": 2,
      "decoding_complexity": 2,
      "target_time_seconds": 45,
      "generation_constraints": {
        "wording": "contextual",
        "factual_grounding": "Use only extracted source-supported facts."
      }
    },
    {
      "pattern_mock_id": "p1",
      "level": "hard",
      "steps_required": 3,
      "concept_count": 3,
      "calculation_complexity": 1,
      "wording_complexity": 3,
      "decoding_complexity": 3,
      "target_time_seconds": 60,
      "generation_constraints": {
        "wording": "analytical",
        "factual_grounding": "Use only extracted source-supported facts."
      }
    }
  ]
}

The object above illustrates the schema. Generate as many records and distinct patterns as the source justifies. Every actual pattern must have exactly three corresponding profiles. Do not copy example facts that are not present in the source.

7. FINAL VALIDATION

Before returning the JSON:
- Confirm all extracted facts belong to the selected Learning Unit.
- Confirm every record and pattern uses the exact target ID "${unitId}".
- Confirm all record_type and level values are valid.
- Confirm every pattern has exactly three profiles.
- Confirm each profile references an existing pattern mock_id.
- Confirm all complexity scores are integers from 1 to 5.
- Confirm all JSON strings and arrays are correctly formatted.
- Confirm the JSON parses successfully.
- Do not include Markdown, code fences, explanations or text outside the JSON object.

Return only the completed JSON object.`;

  try {
    await navigator.clipboard.writeText(promptText);
    alert("Prompt copied successfully!");
  } catch (error) {
    console.error("Failed to copy prompt:", error);
    alert("Could not copy the prompt. Please check browser clipboard permissions.");
  }
};


  async function handleProcessAI() {
    if (!unitId || !passage.trim()) {
      setError("Please select a Learning Unit and paste the JSON payload.");
      return;
    }
    
    setIsProcessing(true);
    setError(null);

    try {
      let cleanedPassage = passage.replace(/\\$/gm, '').replace(/\\\n/g, '\n').replace(/&#x20;/g, ' ').replace(/&nbsp;/g, ' ').trim();
      cleanedPassage = cleanedPassage.replace(/^```(json)?\n?/i, '').replace(/\n?```$/i, '').trim();
      
      if (cleanedPassage.startsWith('{') && cleanedPassage.endsWith('}')) {
        const parsedData = JSON.parse(cleanedPassage);
        setProposedRecords(parsedData.proposedRecords || []);
        setProposedPatterns(parsedData.proposedPatterns || []);
        setProposedProfiles(parsedData.proposedProfiles || []);
        setIsProcessing(false);
      } else {
         throw new Error("Input does not appear to be valid JSON.");
      }
    } catch (err: any) {
      setError(`Parsing Error: ${err.message}`);
      setIsProcessing(false);
    }
  }

  const getEditableText = (content: any) => {
    if (content?.bullet_points && Array.isArray(content.bullet_points)) return content.bullet_points.join('\n');
    return JSON.stringify(content, null, 2);
  };

  const handleRecordUpdate = (index: number, newText: string) => {
    const updated = [...proposedRecords];
    updated[index].content = { bullet_points: newText.split('\n').filter(l => l.trim() !== '') };
    setProposedRecords(updated);
  };

  async function handleApproveAndSave() {
    if (proposedRecords.length === 0 && proposedPatterns.length === 0) return;
    setIsProcessing(true);
    setError(null);
    
    try {
      if (proposedRecords.length > 0) {
        const recordsToInsert = proposedRecords.map(r => ({ ...r, verification_status: 'verified' }));
        const { error: krError } = await supabase.from('knowledge_records').insert(recordsToInsert);
        if (krError) throw krError;
      }

      for (const pattern of proposedPatterns) {
        const { mock_id, ...patternData } = pattern;
        const { data: newPattern, error: pError } = await supabase
          .from('question_patterns')
          .insert({ ...patternData, active: true })
          .select()
          .single();
        if (pError) throw pError;

        const profilesToInsert = proposedProfiles
          .filter(prof => prof.pattern_mock_id === mock_id)
          .map(({ pattern_mock_id, ...profData }) => ({ ...profData, question_pattern_id: newPattern.id }));

        if (profilesToInsert.length > 0) {
          const { error: dpError } = await supabase.from('difficulty_profiles').insert(profilesToInsert);
          if (dpError) throw dpError;
        }
      }

      alert("Successfully saved data to the targeted Learning Unit!");
      setProposedRecords([]);
      setProposedPatterns([]);
      setProposedProfiles([]);
      setPassage('');
      setUnitId('');
      
      // Refresh the tree to instantly hide the completed unit
      await fetchPendencyTree();
      
    } catch (err: any) {
      setError(`Save failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <main className="p-8 max-w-7xl mx-auto text-slate-800 bg-slate-50 min-h-screen">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900">Single Unit Studio</h1>
          <p className="text-slate-500 mt-1">Extract and map textbook passages strictly to pending learning units.</p>
        </div>
      </div>

      {error && <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-6 border border-red-200">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-1 flex flex-col gap-4 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <h2 className="font-semibold text-lg border-b border-slate-100 pb-3 mb-2 flex justify-between items-center">
            1. Target Unit
            {loadingTree && <span className="text-xs text-blue-600 font-normal animate-pulse">Syncing DB...</span>}
          </h2>
          <select className="border border-slate-300 p-2.5 rounded-lg bg-slate-50 disabled:opacity-50" value={subjectId} onChange={e => setSubjectId(e.target.value)} disabled={loadingTree}>
            <option value="">Select Pending Subject...</option>
            {activeSubjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="border border-slate-300 p-2.5 rounded-lg bg-slate-50 disabled:opacity-50" value={topicId} onChange={e => setTopicId(e.target.value)} disabled={!subjectId || loadingTree}>
            <option value="">Select Pending Topic...</option>
            {activeTopics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className="border border-slate-300 p-2.5 rounded-lg bg-slate-50 disabled:opacity-50" value={subtopicId} onChange={e => setSubtopicId(e.target.value)} disabled={!topicId || loadingTree}>
            <option value="">Select Pending Subtopic...</option>
            {activeSubtopics.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="border-2 border-blue-200 p-2.5 rounded-lg bg-blue-50 font-semibold text-blue-900 disabled:opacity-50" value={unitId} onChange={e => setUnitId(e.target.value)} disabled={!subtopicId || loadingTree}>
            <option value="">Select Empty Learning Unit...</option>
            {activeUnits.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>

        <div className="lg:col-span-2 flex flex-col gap-4 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-2">
            <h2 className="font-semibold text-lg">2. Source Material</h2>
            <button onClick={handleCopyPrompt} disabled={!unitId} className="text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded disabled:opacity-50">
              Copy Target Prompt
            </button>
          </div>
          <textarea className="flex-1 border border-slate-300 p-4 rounded-lg bg-slate-50 font-mono text-sm min-h-[220px]" placeholder="Paste sanitized JSON from AI..." value={passage} onChange={e => setPassage(e.target.value)} disabled={!unitId || isProcessing} />
          <button onClick={handleProcessAI} disabled={!unitId || !passage.trim() || isProcessing} className="py-3.5 bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-800 disabled:bg-slate-300">
            {isProcessing ? 'Parsing...' : 'Parse JSON Content'}
          </button>
        </div>
      </div>

      {(proposedRecords.length > 0 || proposedPatterns.length > 0) && (
        <div className="bg-white p-6 rounded-xl shadow-lg border-2 border-emerald-500/20 mb-12">
          <div className="flex justify-between items-center border-b border-slate-100 pb-4 mb-6">
            <h2 className="font-bold text-2xl text-slate-800">3. Review & Approve</h2>
            <button onClick={handleApproveAndSave} disabled={isProcessing} className="px-8 py-3 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700">
              Confirm and Save
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-slate-50 p-5 rounded-lg border border-slate-200">
              <h3 className="font-bold text-lg mb-4">Extracted Knowledge</h3>
              {proposedRecords.map((rec, idx) => (
                <div key={idx} className="mb-4 bg-white rounded-lg border border-slate-200 shadow-sm">
                  <div className="bg-slate-100 px-4 py-2 border-b border-slate-200 flex justify-between items-center">
                    <input type="text" className="font-bold text-slate-800 bg-transparent border-none p-0 w-full" value={rec.title} onChange={e => { const u = [...proposedRecords]; u[idx].title = e.target.value; setProposedRecords(u); }} />
                  </div>
                  <textarea className="w-full p-4 text-sm text-slate-700 bg-white border-none min-h-[120px]" value={getEditableText(rec.content)} onChange={e => handleRecordUpdate(idx, e.target.value)} />
                </div>
              ))}
            </div>

            <div className="bg-slate-50 p-5 rounded-lg border border-slate-200">
              <h3 className="font-bold text-lg mb-4">Generated Patterns</h3>
              {proposedPatterns.map((pat, idx) => (
                <div key={idx} className="mb-4 bg-white p-4 border border-slate-200 rounded-lg shadow-sm">
                  <div className="font-bold text-slate-800 text-lg mb-2">{pat.name}</div>
                  <div className="text-sm text-slate-600 mb-4">{pat.description}</div>
                  <div className="space-y-2">
                    {proposedProfiles.filter(prof => prof.pattern_mock_id === pat.mock_id).map((prof, pIdx) => (
                      <div key={pIdx} className="flex justify-between text-xs border border-slate-100 p-2 rounded bg-slate-50">
                        <span className="font-bold uppercase">{prof.level}</span>
                        <span>Steps: {prof.steps_required} | Decoding: {prof.decoding_complexity}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}